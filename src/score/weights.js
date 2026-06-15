// ─── Scoring constants — the ONE place to tune the "agents" ──────────────────
// Everything the deterministic scoring engine does is driven by these numbers.
// They are validated against the demo dataset so computed colors match the
// designed dashboard out of the box (see score/health.js sanity notes).

// SLA response window for cross-team Infra tickets (hours).
export const SLA = {
  APPROACHING: 18, // amber "approaching" hint below the window
  MIN: 24,         // start of the official window
  MAX: 32,         // past this = breach / escalate
}

// Per-team health score (start at 100, subtract penalties, add velocity).
export const HEALTH_WEIGHTS = {
  W_SLA_BREACH: 15,          // per escalated (breached) blocker — breach covers its own penalty
  // Graduated blocker penalty by SLA state (breach contributes 0 — fully covered by W_SLA_BREACH)
  W_BLOCKER_OK: 3,           // < 18h — fresh, minor drag
  W_BLOCKER_APPROACHING: 6,  // 18–24h — heading into the response window
  W_BLOCKER_WARNING: 9,      // 24–32h — inside SLA window, not yet breached
  W_STALLED_RATIO: 40,  // × (stalled / inFlight)
  W_WIP_AGE: 10,        // × wipAgePenalty(0..1)
  W_VELOCITY: 10,       // ± velocity swing
  WIP_BASELINE_DAYS: 3, // avg WIP age with no penalty
  WIP_FULL_DAYS: 8,     // avg WIP age at full penalty
}

// Health enum thresholds (score → color/label).
export const HEALTH_THRESHOLDS = {
  HEALTHY_MIN: 75,         // >= → healthy
  ATRISK_MIN: 40,          // >= → at-risk ; below → blocked
  BLOCKED_BREACH_COUNT: 2, // >= this many ESCALATED breaches → force blocked
  // (1 breach alone stays at-risk — matches LO-2041 design; UW with 2+ is red)
}

// effortScore (ROI bar): shipped ÷ capacity consumed.
export const EFFORT_WEIGHTS = {
  WIP_WEIGHT: 0.5,   // each in-flight ticket consumes half a "unit"
  STALL_DRAG: 0.75,  // each stalled ticket is heavy drag
}

// Mark an in-flight ticket "stalled" if untouched longer than this.
export const STALE_HOURS = 72

// Canonical 10-stage ticket lifecycle (index 0..9). Used for stage chips.
export const LIFECYCLE = [
  'Ready for Analysis', // 0
  'In Analysis',        // 1
  'Ready for Dev',      // 2
  'In Dev',             // 3
  'Code Review',        // 4
  'Dev Done',           // 5
  'In QA',              // 6
  'QA Done',            // 7
  'Ready to Deploy',    // 8
  'Done',               // 9
]

// Map messy Jira status names → a canonical lifecycle index.
export const STATUS_ALIASES = {
  'ready for analysis': 0, 'to do': 0, 'open': 0, 'backlog': 0, 'queued': 0,
  'in analysis': 1, 'analysis': 1,
  'analysis done': 2, 'ready for dev': 2, 'ready for development': 2, 'selected for development': 2,
  'in dev': 3, 'in development': 3, 'in progress': 3, 'development': 3,
  'code review': 4, 'in code review': 4, 'review': 4, 'in review': 4,
  'dev done': 5, 'development done': 5,
  'in qa': 6, 'ready for qa': 6, 'awaiting qa': 6, 'qa': 6, 'testing': 6,
  'qa done': 7, 'tested': 7,
  'ready to deploy': 8, 'ready for deploy': 8, 'deploy': 8, 'ready for release': 8,
  'done': 9, 'closed': 9, 'resolved': 9, 'shipped': 9,
}
