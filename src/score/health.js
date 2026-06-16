// ─── Per-team health score (0–100) — the core scoring "agent" ────────────────
// Deterministic, explainable math. Start at 100, subtract weighted penalties,
// add a velocity term, clamp. Every term is returned in `breakdown` so the
// dashboard can show *why* a team is green/amber/red.
//
// Sanity-checked against the demo dataset:
//   UW/LG  → ~20  → blocked   (stalled 4/5, 2 breaches)
//   LO     → ~64  → at-risk   (1 breach, stalled 2/6)
//   PAY    → ~92  → healthy   (no blockers, +velocity)
//   ANA    → ~78  → healthy/at-risk boundary (1 non-breach blocker)
//   INFRA  → ~67  → at-risk   (open backlog treated as WIP drag)
import { HEALTH_WEIGHTS as W, HEALTH_THRESHOLDS as T } from './weights.js'

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))

/**
 * @param {object} m metrics
 *   shipped, shippedPrev, inFlight, stalled,
 *   blockers: [{ escalate }], avgInFlightDays
 * @returns {{ score:number, health:'healthy'|'at-risk'|'blocked', breakdown:object }}
 */
export function computeHealth(m) {
  const inFlight = Math.max(0, m.inFlight || 0)
  const stalled = Math.max(0, m.stalled || 0)
  const blockers = m.blockers || []
  const shipped = m.shipped || 0
  const shippedPrev = m.shippedPrev ?? shipped

  const stalledRatio = inFlight > 0 ? clamp(stalled / inFlight, 0, 1) : (stalled > 0 ? 1 : 0)
  const breachCount = blockers.filter(b => b.escalate).length
  const blockerCount = blockers.length

  // Graduated penalty per slaState; breach contributes 0 — already charged via W_SLA_BREACH.
  const BLOCKER_PENALTY = {
    ok: W.W_BLOCKER_OK, approaching: W.W_BLOCKER_APPROACHING,
    warning: W.W_BLOCKER_WARNING, breach: 0,
  }

  const avgWip = m.avgInFlightDays || 0
  const wipAgePenalty = clamp(
    (avgWip - W.WIP_BASELINE_DAYS) / (W.WIP_FULL_DAYS - W.WIP_BASELINE_DAYS), 0, 1
  )

  const velocityDelta = clamp((shipped - shippedPrev) / Math.max(shippedPrev, 1), -1, 1)
  const velocityScore = velocityDelta * W.W_VELOCITY

  const pSla = W.W_SLA_BREACH * breachCount
  const pBlk = blockers.reduce((sum, b) => sum + (BLOCKER_PENALTY[b.slaState] ?? W.W_BLOCKER_OK), 0)
  const pStall = W.W_STALLED_RATIO * stalledRatio
  const pWip = W.W_WIP_AGE * wipAgePenalty

  const score = Math.round(clamp(100 - pSla - pBlk - pStall - pWip + velocityScore, 0, 100))

  let health = 'healthy'
  if (score < T.ATRISK_MIN || breachCount >= T.BLOCKED_BREACH_COUNT) health = 'blocked'
  else if (score < T.HEALTHY_MIN) health = 'at-risk'

  return {
    score,
    health,
    breakdown: {
      base: 100,
      sla: -round1(pSla), breaches: breachCount,
      blockers: -round1(pBlk), blockerCount,
      blockersByState: {
        ok: blockers.filter(b => b.slaState === 'ok').length,
        approaching: blockers.filter(b => b.slaState === 'approaching').length,
        warning: blockers.filter(b => b.slaState === 'warning').length,
      },
      stalled: -round1(pStall), stalledRatio: round2(stalledRatio),
      wip: -round1(pWip), avgInFlightDays: round1(avgWip),
      velocity: round1(velocityScore), velocityDelta: round2(velocityDelta),
      breachOverride: breachCount >= 1,
    },
  }
}

const round1 = n => Math.round(n * 10) / 10
const round2 = n => Math.round(n * 100) / 100

/** color for a health enum (matches dashboard tokens). */
export const healthColor = h =>
  h === 'healthy' ? '#22C55E' : h === 'blocked' ? '#EF4444' : '#F5A623'
