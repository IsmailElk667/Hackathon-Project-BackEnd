// ─── JQL query builders ───────────────────────────────────────────────────────

/**
 * All non-epic tickets: open/in-progress + done in the last 28 days.
 * 28 days covers this sprint (14d) AND the previous one (14d) for velocity.
 */
export function allIssues(boardKey) {
  return (
    `project = ${boardKey} AND issuetype not in (Epic) AND ` +
    `(statusCategory != Done OR resolutiondate >= -28d) ` +
    `ORDER BY updated DESC`
  )
}

/**
 * Active initiative-level work (not Done): Epics (tech delivery) + Experiments
 * (ops experiments — Shruthi's tech-vs-ops split, by real Jira issue type).
 */
export function activeInitiatives(boardKey) {
  return (
    `project = ${boardKey} AND issuetype in (Epic, Experiment) AND ` +
    `statusCategory != Done ORDER BY updated DESC`
  )
}

/**
 * ALL direct children of the given epics — no date filter. Needed for accurate
 * initiative progress: done children older than 28d must still count, otherwise
 * a mostly-finished epic reads as 0%. `parent in (...)` ties each child to its
 * epic precisely, so counts land on the right initiative.
 */
export function epicChildren(boardKey, epicKeys) {
  return `project = ${boardKey} AND parent in (${epicKeys.join(',')}) ORDER BY updated DESC`
}
