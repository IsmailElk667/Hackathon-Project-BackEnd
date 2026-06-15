// ─── Stage queue depth ────────────────────────────────────────────────────────
// Counts tickets parked in hand-off waiting stages: Code Review, QA Done, and
// Ready to Deploy. Work in these stages is finished but blocked on someone else
// picking it up — high counts reveal review bottlenecks and deploy-queue jams.
import { stageIndexOf } from '../map/deriveLifecycle.js'

const QUEUE_STAGES = { codeReview: 4, qaDone: 7, readyToDeploy: 8 }

const STAGE_KEY = Object.fromEntries(
  Object.entries(QUEUE_STAGES).map(([k, v]) => [v, k])
)

export function computeQueueDepth(inFlightTickets = []) {
  const counts = { codeReview: 0, qaDone: 0, readyToDeploy: 0 }

  for (const tk of inFlightTickets) {
    const key = STAGE_KEY[stageIndexOf(tk.stage)]
    if (key) counts[key]++
  }

  const total = counts.codeReview + counts.qaDone + counts.readyToDeploy

  // The single busiest queue slot — null when there's nothing queued.
  const hottest = total > 0
    ? Object.entries(counts).reduce((max, e) => e[1] > max[1] ? e : max)[0]
    : null

  return { ...counts, total, hottest }
}
