// ─── Cycle time by stage ──────────────────────────────────────────────────────
// Aggregates per-stage hours from ticket.stageHistory across all team tickets.
// Identifies the bottleneck stage (highest avg hours) and computes P90 ticket
// age — a stall-resistant alternative to the mean that hides zombie tickets.
//
// stageHistory shape: { [canonicalStageLabel]: hoursSpent }
// e.g. { 'In Dev': 18, 'Code Review': 22 }   ← completed stages only
// Jira source: derived from changelog transitions. Mock source: seeded.
import { LIFECYCLE } from './weights.js'

export function computeCycleTime(inFlightTickets = [], shippedTickets = []) {
  const stageTotals = {} // { label: { totalHours, count } }

  for (const tk of [...inFlightTickets, ...shippedTickets]) {
    if (!tk.stageHistory) continue
    for (const [label, hours] of Object.entries(tk.stageHistory)) {
      if (!Number.isFinite(hours) || hours <= 0) continue
      if (!stageTotals[label]) stageTotals[label] = { totalHours: 0, count: 0 }
      stageTotals[label].totalHours += hours
      stageTotals[label].count++
    }
  }

  // Preserve canonical LIFECYCLE order; skip stages with no data.
  const byStage = LIFECYCLE
    .filter(label => stageTotals[label])
    .map(label => ({
      stage: label,
      avgHours: Math.round(stageTotals[label].totalHours / stageTotals[label].count),
      sampleSize: stageTotals[label].count,
    }))

  const bottleneck = byStage.length > 0
    ? byStage.reduce((max, s) => s.avgHours > max.avgHours ? s : max)
    : null

  // P90 of days in flight — catches chronic stragglers the mean masks.
  const ages = inFlightTickets
    .map(t => t.days)
    .filter(n => Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b)

  const p90AgeDays = ages.length > 0
    ? ages[Math.min(Math.ceil(ages.length * 0.9), ages.length) - 1]
    : 0

  return {
    byStage,
    bottleneck: bottleneck
      ? { stage: bottleneck.stage, avgHours: bottleneck.avgHours }
      : null,
    p90AgeDays,
  }
}
