// ─── Jira ingest → internal team shape ───────────────────────────────────────
// Privacy: only `summary` (ticket titles) is stored. description and comments
// are never requested, stored, or forwarded to the browser or any LLM.
import { config } from '../config.js'
import { log } from '../lib/log.js'
import { searchAll, resolveCustomFields, getStatusCategoryMap, fetchChangelog } from './client.js'
import { allIssues, activeInitiatives, epicChildren } from './jql.js'
import { BOARDS, ALL_CROSS_LABELS } from './boards.js'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const STALL_HOURS = 72   // hours without update → stalled
const BREACH_HOURS = 32  // hours → SLA breach

// ─── helpers ─────────────────────────────────────────────────────────────────

function msAgo(isoDate) { return Date.now() - new Date(isoDate).getTime() }
function hoursAgo(isoDate) { return Math.floor(msAgo(isoDate) / 3_600_000) }
function daysAgo(isoDate)  { return Math.floor(msAgo(isoDate) / 86_400_000) }
function weekday(isoDate)  { return WEEKDAYS[new Date(isoDate).getDay()] }

function isDone(issue) {
  return issue.fields.status?.statusCategory?.key === 'done'
}

// Impediment flag (Jira "Flagged" custom field) is set → real blocker signal.
function isFlagged(issue, flaggedField) {
  return Boolean(flaggedField && Array.isArray(issue.fields[flaggedField]) && issue.fields[flaggedField].length)
}

// Returns the active "is blocked by" link, if any. A ticket is genuinely blocked
// only when the blocking issue is NOT already Done. issuelinks include the linked
// issue's status, so we filter resolved blockers out here.
function getBlockedBy(issue) {
  for (const link of issue.fields.issuelinks || []) {
    const inward = link.type?.inward || ''
    // "is blocked by" (Blocks link type, inward direction)
    if (/blocked by/i.test(inward) && link.inwardIssue) {
      const blockerDone = link.inwardIssue.fields?.status?.statusCategory?.key === 'done'
      if (!blockerDone) {
        return { key: link.inwardIssue.key, summary: link.inwardIssue.fields?.summary || '' }
      }
    }
  }
  return null
}

// Project prefix of a Jira key (LO-2041 → LO) — used as the blocker "label".
function projectPrefix(key = '') {
  const m = String(key).match(/^([A-Z]+)-/)
  return m ? m[1] : ''
}

// The team's current sprint = the most common active-state sprint across its
// issues' Sprint field (Jira Cloud returns parsed sprint objects). null if the
// team runs kanban / has no active sprint.
function computeActiveSprint(issues, sprintField) {
  if (!sprintField) return null
  const tally = {}
  for (const issue of issues) {
    const arr = issue.fields[sprintField]
    if (!Array.isArray(arr)) continue
    for (const s of arr) {
      if (s && typeof s === 'object' && s.state === 'active' && s.name) {
        if (!tally[s.name]) tally[s.name] = { ...s, count: 0 }
        tally[s.name].count++
      }
    }
  }
  const top = Object.values(tally).sort((a, b) => b.count - a.count)[0]
  if (!top) return null
  return {
    id: top.id ?? null,
    name: top.name,
    state: top.state,
    startDate: top.startDate || null,
    endDate: top.endDate || null,
    goal: top.goal || null,
    issueCount: top.count,
  }
}

function mapStatus(statusName = '') {
  const STATUS_MAP = {
    'To Do': 'Backlog', 'Backlog': 'Backlog', 'Open': 'In Dev',
    'In Progress': 'In Progress', 'In Development': 'In Dev', 'In Dev': 'In Dev',
    'Code Review': 'In Code Review', 'In Code Review': 'In Code Review', 'In Review': 'In Code Review',
    'Ready for QA': 'Ready for QA', 'In QA': 'In QA', 'QA': 'In QA', 'Testing': 'In QA',
    'Awaiting QA': 'Awaiting QA',
    'Ready to Deploy': 'Ready to Deploy', 'Ready for Deploy': 'Ready to Deploy',
    'Merged to Release': 'Ready to Deploy', 'Waiting On Release': 'Ready to Deploy',
    'Blocked': 'Blocked', 'On Hold': 'Blocked',
    'Analysis': 'Analysis Done', 'Analysis Done': 'Analysis Done',
    'Done': 'Done', 'Resolved': 'Done', 'Closed': 'Done',
  }
  return STATUS_MAP[statusName] || statusName
}

// ─── per-board builder ────────────────────────────────────────────────────────

const CUTOFF_14D = () => Date.now() - 14 * 86_400_000
const CUTOFF_28D = () => Date.now() - 28 * 86_400_000

// Jira statusCategory: 'done' = shipped, 'new' = backlog (not started),
// 'indeterminate' = active/in-flight. Health scoring runs on ACTIVE only —
// a 200-ticket backlog of "Ready for Analysis" must not tank the score.
function statusCategory(issue) {
  return issue.fields.status?.statusCategory?.key || 'indeterminate'
}

function buildTeam(board, issues, flaggedField, sprintField) {
  const cut14 = CUTOFF_14D(), cut28 = CUTOFF_28D()
  const { boardKey, crossTeamLabels, ...staticMeta } = board

  const activeSprint = computeActiveSprint(issues, sprintField)

  // Flow metrics (WIP / throughput / blockers) are scoped to the team's active
  // sprint. Kanban teams (no active sprint) stay board-wide with the 14/28-day
  // resolution windows so the dashboard still reads sensibly.
  const inSprint = (issue) => {
    if (!activeSprint || !sprintField) return true
    const arr = issue.fields[sprintField]
    return Array.isArray(arr) && arr.some(s => s && typeof s === 'object' &&
      (s.id === activeSprint.id || s.name === activeSprint.name))
  }
  const scoped = issues.filter(inSprint)

  const shippedIssues = [], prevIssues = [], activeIssues = [], backlogIssues = []

  for (const issue of scoped) {
    const cat = statusCategory(issue)
    if (cat === 'done') {
      if (activeSprint) {
        shippedIssues.push(issue)     // sprint-scoped throughput = all Done in sprint
      } else {
        const resolvedMs = issue.fields.resolutiondate
          ? new Date(issue.fields.resolutiondate).getTime() : 0
        if (resolvedMs >= cut14)       shippedIssues.push(issue)
        else if (resolvedMs >= cut28)  prevIssues.push(issue)
      }
    } else if (cat === 'new') {
      backlogIssues.push(issue)       // not started — backlog
    } else {
      activeIssues.push(issue)        // indeterminate — genuinely in flight
    }
  }

  // Velocity trend needs a previous-window count; in sprint mode derive it
  // board-wide from the 14–28-day resolution window (previous sprint proxy).
  if (activeSprint) {
    for (const issue of issues) {
      if (statusCategory(issue) !== 'done') continue
      const resolvedMs = issue.fields.resolutiondate ? new Date(issue.fields.resolutiondate).getTime() : 0
      if (resolvedMs < cut14 && resolvedMs >= cut28) prevIssues.push(issue)
    }
  }

  // Blockers + stalled are computed over ACTIVE work only (backlog isn't "stuck",
  // it just hasn't started). A flagged backlog item is surfaced separately below.
  const blockers = []
  const blockedKeys = new Set()
  let stalledCount = 0

  for (const issue of activeIssues) {
    const flagged      = isFlagged(issue, flaggedField)
    const blockedBy    = getBlockedBy(issue)
    const blocked      = flagged || Boolean(blockedBy)
    const updatedHours = hoursAgo(issue.fields.updated)
    const stalled      = blocked || updatedHours >= STALL_HOURS

    if (stalled) stalledCount++

    if (blocked) {
      blockedKeys.add(issue.key)
      blockers.push({
        ticketId:    issue.key,
        infraTicket: blockedBy?.key || (flagged ? '🚩 Flagged' : '—'),
        assignee:    issue.fields.assignee?.displayName || 'Unassigned',
        age:         updatedHours,
        label:       blockedBy ? projectPrefix(blockedBy.key) : 'FLAG',
        description: issue.fields.summary,
        escalate:    updatedHours >= BREACH_HOURS,
      })
    }
  }

  // Sort blockers oldest-first (most urgent at top).
  blockers.sort((a, b) => b.age - a.age)

  const ticketRow = (i) => ({
    id:      i.key,
    title:   i.fields.summary,
    stage:   mapStatus(i.fields.status?.name),
    days:    daysAgo(i.fields.updated),
    blocked: blockedKeys.has(i.key),
  })

  return {
    ...staticMeta,
    shipped:     shippedIssues.length,
    shippedPrev: prevIssues.length,
    inFlight:    activeIssues.length,
    backlog:     backlogIssues.length,
    stalled:     stalledCount,
    activeSprint,
    flowCycle:   computeFlowCycle(issues),        // fallback; overridden by AA-style pass
    burnup:      buildBurnup(scoped, activeSprint), // sprint issue-count history
    // Sprint-completed issues (key + resolved time) for the changelog-based
    // cycle-time pass in getJiraIngest. Not emitted in the snapshot.
    cycleItems: activeSprint
      ? shippedIssues.filter(i => i.fields.resolutiondate)
          .map(i => ({ key: i.key, resolvedMs: new Date(i.fields.resolutiondate).getTime() }))
      : [],
    blockers,
    inFlightTickets: activeIssues.map(ticketRow),
    backlogTickets:  backlogIssues.map(ticketRow),
    shippedTickets: shippedIssues.slice(0, 12).map(i => ({
      id:    i.key,
      title: i.fields.summary,
      day:   i.fields.resolutiondate ? weekday(i.fields.resolutiondate) : '—',
    })),
  }
}

// 90-day flow cycle time: real created→resolved duration (days) for issues
// completed within the trailing window. Board-wide (not sprint-scoped) per the
// PM spec ("cycle time = 90 days"). Returns {avg,median,max,windowDays,sampleSize}.
function computeFlowCycle(issues) {
  const now = Date.now(), WINDOW = 90 * 86_400_000
  const cyc = []
  for (const i of issues) {
    if (statusCategory(i) !== 'done') continue
    const res = i.fields.resolutiondate ? new Date(i.fields.resolutiondate).getTime() : 0
    const cre = i.fields.created ? new Date(i.fields.created).getTime() : 0
    if (!res || !cre || res < now - WINDOW) continue
    const days = (res - cre) / 86_400_000
    if (days >= 0) cyc.push(days)
  }
  if (!cyc.length) return null
  const s = cyc.sort((a, b) => a - b), mid = Math.floor(s.length / 2)
  const median = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
  const r = n => Math.round(n * 10) / 10
  return { avg: r(s.reduce((a, b) => a + b, 0) / s.length), median: r(median), max: r(s[s.length - 1]), windowDays: 90, sampleSize: s.length }
}

// Actionable-Agile-style cycle time from the changelog: elapsed time from the
// first "in progress" transition to completion, over the active sprint's
// completed items. AA counts inclusive calendar days (same-day = 1), so we add 1.
// Falls back silently per-issue; if the whole pass fails the caller keeps the
// created→resolved fallback already set on the team.
async function attachSprintCycleTime(teams, catMap) {
  const DAY = 86_400_000
  for (const t of teams) {
    const items = (t.cycleItems || []).slice(0, 60)   // bound work per team
    delete t.cycleItems
    if (!items.length) continue
    const cycles = []
    for (const { key, resolvedMs } of items) {
      try {
        const hist = (await fetchChangelog(key)).sort((a, b) => new Date(a.created) - new Date(b.created))
        let startMs = null
        for (const h of hist) {
          for (const it of h.items || []) {
            if (it.field === 'status' && catMap[String(it.to)] === 'indeterminate') { startMs = new Date(h.created).getTime(); break }
          }
          if (startMs != null) break
        }
        if (startMs != null && resolvedMs && resolvedMs >= startMs) {
          cycles.push(Math.max(1, Math.round((resolvedMs - startMs) / DAY) + 1))
        }
      } catch { /* skip this issue, keep going */ }
    }
    if (cycles.length) {
      const s = cycles.sort((a, b) => a - b), mid = Math.floor(s.length / 2)
      const median = s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
      const r = n => Math.round(n * 10) / 10
      t.flowCycle = { avg: r(s.reduce((a, b) => a + b, 0) / s.length), median, max: s[s.length - 1], sprint: t.activeSprint?.name || null, sampleSize: s.length, basis: 'actionable-agile' }
    }
  }
}

// Sprint burn-up history reconstructed from the sprint's real issue dates: an
// issue enters scope at max(sprintStart, created) and is completed at its
// resolutiondate. Emits daily { t, scope, done } points from sprint start to
// today. (Captures adds + completions; mid-sprint scope removals aren't tracked
// without the changelog — a future enhancement via the Jira sprint report API.)
function buildBurnup(scopedIssues, sprint) {
  if (!sprint || !sprint.startDate || !sprint.endDate) return null
  const startMs = new Date(sprint.startDate).getTime()
  const endMs = new Date(sprint.endDate).getTime()
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null
  const DAY = 86_400_000
  const todayMs = Math.min(Date.now(), endMs)
  const items = scopedIssues.map(i => ({
    added: Math.max(startMs, i.fields.created ? new Date(i.fields.created).getTime() : startMs),
    done: (statusCategory(i) === 'done' && i.fields.resolutiondate) ? new Date(i.fields.resolutiondate).getTime() : null,
  }))
  const points = []
  for (let ms = startMs; ; ms += DAY) {
    const day = Math.min(ms, todayMs)
    points.push({
      t: new Date(day).toISOString(),
      scope: items.filter(x => x.added <= day).length,
      done: items.filter(x => x.done != null && x.done <= day).length,
    })
    if (day >= todayMs) break
  }
  return { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString(), points }
}

// ─── epic initiative builder ──────────────────────────────────────────────────

function buildEpics(epicResults, childResults, flaggedField) {
  // Index EVERY epic child (all-time, from the dedicated epicChildren query) by
  // its parent epic key. parent.key is guaranteed to be an epic here because the
  // query filtered `parent in (epicKeys)` — so counts map to the right initiative.
  const childrenByEpic = {}
  for (const { children } of childResults) {
    for (const issue of children) {
      const epicKey = issue.fields.parent?.key
      if (!epicKey) continue
      if (!childrenByEpic[epicKey]) childrenByEpic[epicKey] = []
      childrenByEpic[epicKey].push(issue)
    }
  }

  const epics = []
  for (const { boardId, epicIssues } of epicResults) {
    for (const epic of epicIssues) {
      const children = childrenByEpic[epic.key] || []
      if (!children.length) continue  // epic with no children → skip

      const doneChildren    = children.filter(i => isDone(i)).length
      const blockedChildren = children.filter(i =>
        !isDone(i) && (isFlagged(i, flaggedField) || getBlockedBy(i))
      ).length

      // Tech-vs-ops separation by real Jira issue type (Shruthi's ask).
      const issueType = epic.fields.issuetype?.name || 'Epic'
      const kind = /experiment/i.test(issueType) ? 'ops' : 'tech'

      // Compact story list for the drill-down (initiative → stories). Sorted
      // done-last so open work surfaces first.
      const stories = children.map(i => ({
        id:      i.key,
        title:   i.fields.summary,
        stage:   mapStatus(i.fields.status?.name),
        done:    isDone(i),
        blocked: !isDone(i) && (isFlagged(i, flaggedField) || Boolean(getBlockedBy(i))),
      })).sort((a, b) => (a.done === b.done ? 0 : a.done ? 1 : -1))

      epics.push({
        id:              epic.key,
        teamId:          boardId,
        name:            epic.fields.summary,
        kind,
        issueType,
        doneChildren,
        totalChildren:   children.length,
        blockedChildren,
        stories,
      })
    }
  }

  return epics
}

// ─── main export ─────────────────────────────────────────────────────────────

export async function getJiraIngest() {
  const { flagged: flaggedField, sprint: sprintField } = await resolveCustomFields()

  // Filter boards to those enabled in config
  const boards = BOARDS.filter(b => config.jira.boards.includes(b.boardKey))

  log.info(`jira: fetching ${boards.length} boards: ${boards.map(b => b.boardKey).join(', ')}`)

  // Parallel: fetch all issues + active epics per board
  const [issueResults, epicResults] = await Promise.all([
    Promise.all(boards.map(async board => {
      const issues = await searchAll(allIssues(board.boardKey))
      log.info(`jira: ${board.boardKey} → ${issues.length} issues`)
      return { board, issues }
    })),
    Promise.all(boards.map(async board => {
      const epicIssues = await searchAll(activeInitiatives(board.boardKey))
      return { boardId: board.id, board, epicIssues }
    })),
  ])

  // Now fetch EVERY child of those epics (no date filter) for accurate progress.
  const childResults = await Promise.all(epicResults.map(async ({ boardId, board, epicIssues }) => {
    const epicKeys = epicIssues.map(e => e.key)
    if (!epicKeys.length) return { boardId, children: [] }
    const children = await searchAll(epicChildren(board.boardKey, epicKeys))
    log.info(`jira: ${board.boardKey} → ${epicKeys.length} epics, ${children.length} epic children`)
    return { boardId, children }
  }))

  const teams = issueResults.map(({ board, issues }) => buildTeam(board, issues, flaggedField, sprintField))

  // AA-style cycle time from changelog (first in-progress → completion, this
  // sprint). Best-effort: on failure each team keeps its created→resolved value.
  try {
    const catMap = await getStatusCategoryMap()
    await attachSprintCycleTime(teams, catMap)
  } catch (err) {
    log.warn('sprint cycle-time pass skipped:', err.message)
  }

  const epics = buildEpics(epicResults, childResults, flaggedField)

  log.info(`jira: done — ${teams.length} teams, ${epics.length} initiatives`)

  return {
    source: 'jira',
    teams,
    epics,
    // achSuccessRate is a Payments processor KPI not in Jira; use env var or default
    kpi: { achSuccessRate: Number(process.env.ACH_SUCCESS_RATE) || 98.4 },
  }
}
