// ─── buildSnapshot — assemble the full /api/snapshot payload ─────────────────
// Pure function: ingest data in → computed dashboard payload out. No I/O.
import { createHash } from 'node:crypto'
import { computeHealth, healthColor } from './health.js'
import { computeEffort } from './effort.js'
import { computeSprint, computeCeremonies } from './sprint.js'
import { classifySla } from './sla.js'
import { buildLifecycle } from '../map/deriveLifecycle.js'
import { deriveInitiatives } from '../map/deriveInitiatives.js'
import { computeQueueDepth } from './queueDepth.js'
import { computeCycleTime } from './cycleTime.js'

const avgDays = (tickets = []) => {
  const ds = tickets.map(t => t.days).filter(n => Number.isFinite(n))
  return ds.length ? ds.reduce((a, b) => a + b, 0) / ds.length : 0
}

/** @param {{source, teams, epics, kpi}} ingest */
export function buildSnapshot(ingest) {
  const rawTeams = ingest.teams || []

  // 1. Flatten cross-team blockers (every blocker points at an INFRA ticket).
  const infraBlockers = rawTeams
    .filter(t => !t.isCenter)
    .flatMap(t => (t.blockers || []).map(b => {
      const { slaState } = classifySla(b.age)
      // escalate = source flag OR hard breach by age. Preserves a flagged 28h
      // ticket while still catching anything past the 32h window.
      const escalate = Boolean(b.escalate) || slaState === 'breach'
      return { ...b, escalate, slaState, teamId: t.id, teamName: t.name }
    }))
    .sort((a, b) => b.age - a.age)

  const infraTicketIds = new Set(infraBlockers.map(b => b.infraTicket))

  // 2. Score every team.
  const teams = rawTeams.map(t => {
    const isInfra = Boolean(t.isCenter)
    const blockers = (t.blockers || []).map(b => {
      const { slaState } = classifySla(b.age)
      return { ...b, escalate: Boolean(b.escalate) || slaState === 'breach', slaState }
    })
    const avgInFlightDays = avgDays(t.inFlightTickets)

    // Infra's "work" is being the dependency — its health reflects the backlog
    // of cross-team tickets it is holding up, not its own (empty) blocker list.
    const healthInput = isInfra
      ? {
          shipped: t.shipped, shippedPrev: t.shippedPrev, inFlight: t.inFlight,
          stalled: Math.min(infraBlockers.length, t.inFlight),
          blockers: [], avgInFlightDays,
        }
      : {
          shipped: t.shipped, shippedPrev: t.shippedPrev, inFlight: t.inFlight,
          stalled: t.stalled, blockers, avgInFlightDays,
        }

    const { score, health, breakdown } = computeHealth(healthInput)
    const { effortScore, effortLabel } = computeEffort({
      shipped: t.shipped, shippedPrev: t.shippedPrev, inFlight: t.inFlight, stalled: t.stalled,
    })
    const queueDepth = computeQueueDepth(t.inFlightTickets)
    const cycleTime = computeCycleTime(t.inFlightTickets, t.shippedTickets)

    return {
      id: t.id, name: t.name, shortName: t.shortName, board: t.board, pm: t.pm,
      systems: t.systems, isCenter: isInfra,
      color: healthColor(health), hexColor: t.hexColor,
      health, healthScore: score, healthBreakdown: breakdown,
      shipped: t.shipped, inFlight: t.inFlight, stalled: t.stalled,
      backlog: t.backlog ?? 0,
      activeSprint: t.activeSprint ?? null,
      queueDepth, cycleTime,
      // Sprint burn-up time-series (issue count vs time) + 90-day flow cycle
      // time. The Jira path supplies these from real sprint history; mock/local
      // falls back to a synthesized series so the chart always renders.
      burnup: t.burnup ?? synthBurnup(t),
      flowCycle: t.flowCycle ?? deriveFlowCycle(t),
      effortScore, effortLabel,
      standup: t.standup, sprintPlanning: t.sprintPlanning,
      blockers,
      inFlightTickets: t.inFlightTickets || [],
      backlogTickets: t.backlogTickets || [],
      shippedTickets: t.shippedTickets || [],
      // infra-only extras for its special card
      ...(isInfra ? { teamsWaiting: new Set(infraBlockers.map(b => b.teamId)).size, openTickets: t.inFlight } : {}),
    }
  })

  // 3. Derived panels.
  const ceremonies = computeCeremonies(teams)
  const lifecycle = buildLifecycle(teams, 4)
  const initiatives = deriveInitiatives(ingest.epics || [])
  // Prev-sprint velocity must come from the RAW teams — the scored payload
  // intentionally drops `shippedPrev`, so deriving it there would always be +0.
  const prevTotalShipped = rawTeams.reduce((s, t) => s + (t.shippedPrev ?? t.shipped ?? 0), 0)
  const sprint = computeSprint(teams, infraBlockers, ingest.kpi, prevTotalShipped)
  const ticker = buildTicker(teams, infraBlockers, sprint)
  const leadership = buildLeadership(initiatives, sprint)

  const payload = {
    source: ingest.source || 'mock',
    generatedAt: new Date().toISOString(),
    sprint,
    teams,
    infraBlockers,
    ceremonies,
    lifecycle,
    initiatives,
    leadership,
    ticker,
  }
  payload.hash = hashPayload(payload)
  return payload
}

// Synthesize a burn-up series when the source didn't supply one (mock/local).
// Real Jira ingest provides t.burnup from sprint history; this keeps the chart
// alive for demos. Shape: { start, end, points:[{ t, scope, done }] } daily.
function synthBurnup(t) {
  const total = (t.shipped || 0) + (t.inFlight || 0)
  const doneTotal = t.shipped || 0
  if (!total) return null
  const DAY = 86_400_000, N = 14, todayIdx = 9   // day 9 of a 14-day sprint
  const now = Date.now()
  const startMs = now - todayIdx * DAY
  const points = []
  for (let i = 0; i <= todayIdx; i++) {
    const f = i / todayIdx
    const scope = Math.round(total * (0.72 + 0.28 * Math.min(1, f * 1.6)))
    const done = Math.round(doneTotal * Math.pow(f, 1.3))
    points.push({ t: new Date(startMs + i * DAY).toISOString(), scope, done })
  }
  return { start: new Date(startMs).toISOString(), end: new Date(startMs + N * DAY).toISOString(), points }
}

// Fallback 90-day flow cycle time from in-flight ticket ages (mock/local). The
// Jira path computes the real created→resolved cycle time over the window.
function deriveFlowCycle(t) {
  const days = (t.inFlightTickets || []).map(k => Number(k.days) || 0).filter(d => d <= 90)
  if (!days.length) return null
  const s = [...days].sort((a, b) => a - b), mid = Math.floor(s.length / 2)
  const median = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
  const r = n => Math.round(n * 10) / 10
  return { avg: r(days.reduce((a, b) => a + b, 0) / days.length), median: r(median), max: r(s[s.length - 1]), windowDays: 90, sampleSize: days.length }
}

// Company-level rollup over all initiatives — the leadership "health check"
// every PM asked for. Completion is story-weighted (a 1/39 epic shouldn't count
// the same as a 1/2 epic), so the headline % reflects real delivered work.
function buildLeadership(initiatives, sprint) {
  const total = initiatives.length
  const byStatus = { onTrack: 0, atRisk: 0, blocked: 0 }
  const byKind = { tech: 0, ops: 0 }
  let doneChildren = 0, totalChildren = 0

  for (const i of initiatives) {
    if (i.status === 'blocked') byStatus.blocked++
    else if (i.status === 'at-risk') byStatus.atRisk++
    else byStatus.onTrack++
    byKind[i.kind === 'ops' ? 'ops' : 'tech']++
    doneChildren += i.doneChildren || 0
    totalChildren += i.totalChildren || 0
  }

  return {
    totalInitiatives: total,
    byStatus,
    byKind,
    onTrackPct: total ? Math.round((100 * byStatus.onTrack) / total) : 0,
    completionPct: totalChildren ? Math.round((100 * doneChildren) / totalChildren) : 0,
    doneChildren,
    totalChildren,
    trend: sprint.trend,              // delivery momentum vs last sprint
    // Strategic metrics the PMs want but Jira can't yet supply — surfaced as
    // pending so leadership sees the shape and knows what fields to populate.
    pending: {
      outcomeHitRate: null,           // needs a "Success Metric" field + post-ship review
      stakeholderAlignment: null,     // needs a sign-off field/checklist on each epic
      discoveryToDelivery: null,      // needs Discovery vs Delivery tagging
      dateCommitted: null,            // needs a business-sign-off date field
      roi: null,                      // needs $ / business value input
    },
  }
}

// Build the looping ticker feed from live signals.
function buildTicker(teams, infraBlockers, sprint) {
  const out = []
  for (const b of infraBlockers) {
    if (b.escalate) out.push(`${b.teamName}: ${b.ticketId} blocked on ${b.infraTicket} — ${b.age}h, exceeds SLA`)
    else out.push(`${b.ticketId} waiting on ${b.infraTicket} — ${b.age}h`)
  }
  const top = [...teams].sort((a, b) => b.shipped - a.shipped)[0]
  if (top) out.push(`${top.name} leads with ${top.shipped} shipped this sprint`)
  out.push(`Sprint ${sprint.number}: ${sprint.totalShipped} shipped (${sprint.trend} vs last)`)
  out.push(`Infra avg response ${sprint.infraAvgResponse}h · ${sprint.blockersPastSla} past SLA`)
  out.push(`ACH success rate ${sprint.achSuccessRate}%`)
  for (const t of teams) {
    if (t.health === 'blocked') out.push(`${t.name} flagged BLOCKED — health ${t.healthScore}/100`)
  }
  return out
}

// Stable hash (ignores generatedAt) → SSE only pushes on real change.
function hashPayload(p) {
  const clone = { ...p }
  delete clone.generatedAt
  delete clone.hash
  return createHash('sha1').update(stableStringify(clone)).digest('hex').slice(0, 12)
}

function stableStringify(obj) {
  if (Array.isArray(obj)) return '[' + obj.map(stableStringify).join(',') + ']'
  if (obj && typeof obj === 'object') {
    return '{' + Object.keys(obj).sort().map(k => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}'
  }
  return JSON.stringify(obj)
}
