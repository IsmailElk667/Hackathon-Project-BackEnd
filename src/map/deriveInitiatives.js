// ─── Initiatives / epics → progress bars ─────────────────────────────────────
// progressPct = done children ÷ total children. Epics span multiple sprints, so
// status is NOT measured against sprint pace (that made every epic read at-risk).
// Instead: blocked if any child is blocked, at-risk if work has started but
// stalled with blockers nearby, else on-track.

const MIN_CHILDREN = 2  // epics with <2 known children are noise — filter them out

/**
 * @param {Array} epics [{ id, teamId, name, doneChildren, totalChildren, blockedChildren }]
 * @returns initiatives with progressPct + status (on-track | at-risk | blocked)
 */
export function deriveInitiatives(epics = []) {
  return epics
    .filter(e => (e.totalChildren || 0) >= MIN_CHILDREN)
    .map(e => {
      const total = Math.max(e.totalChildren || 0, 0)
      const done = Math.max(e.doneChildren || 0, 0)
      const blocked = Math.max(e.blockedChildren || 0, 0)
      const progressPct = total > 0 ? Math.round((100 * done) / total) : 0

      let status = 'on-track'
      if (blocked > 0) status = 'blocked'
      else if (progressPct === 0 && total >= 4) status = 'at-risk'  // sizable epic, no movement

      return {
        id: e.id,
        teamId: e.teamId,
        name: e.name,
        kind: e.kind || 'tech',       // 'tech' (Epic) | 'ops' (Experiment)
        issueType: e.issueType || 'Epic',
        progressPct,
        doneChildren: done,
        totalChildren: total,
        blockedChildren: blocked,
        status,
        stories: e.stories || [],     // drill-down: initiative → stories
      }
    })
    // Most-complete first within each team's group.
    .sort((a, b) => b.progressPct - a.progressPct)
}
