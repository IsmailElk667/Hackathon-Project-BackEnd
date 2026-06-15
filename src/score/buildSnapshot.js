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
      effortScore, effortLabel,
      queueDepth, cycleTime,
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

  const payload = {
    source: ingest.source || 'mock',
    generatedAt: new Date().toISOString(),
    sprint,
    teams,
    infraBlockers,
    ceremonies,
    lifecycle,
    initiatives,
    ticker,
  }
  payload.hash = hashPayload(payload)
  return payload
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
