// ─── Jira ingest → internal team shape ───────────────────────────────────────
// Privacy: only `summary` (ticket titles) is stored. description and comments
// are never requested, stored, or forwarded to the browser or any LLM.
import { config } from '../config.js'
import { log } from '../lib/log.js'
import { searchAll, resolveCustomFields } from './client.js'
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

function mapStatus(statusName = '') {
  const STATUS_MAP = {
    'To Do': 'Backlog', 'Backlog': 'Backlog', 'Open': 'In Dev',
    'In Progress': 'In Progress', 'In Development': 'In Dev', 'In Dev': 'In Dev',
    'Code Review': 'In Code Review', 'In Code Review': 'In Code Review', 'In Review': 'In Code Review',
    'Ready for QA': 'Ready for QA', 'In QA': 'In QA', 'QA': 'In QA', 'Testing': 'In QA',
    'Awaiting QA': 'Awaiting QA',
    'Ready to Deploy': 'Ready to Deploy', 'Ready for Deploy': 'Ready to Deploy',
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

function buildTeam(board, issues, flaggedField) {
  const cut14 = CUTOFF_14D(), cut28 = CUTOFF_28D()
  const { boardKey, crossTeamLabels, ...staticMeta } = board

  const shippedIssues = [], prevIssues = [], activeIssues = [], backlogIssues = []

  for (const issue of issues) {
    const cat = statusCategory(issue)
    if (cat === 'done') {
      const resolvedMs = issue.fields.resolutiondate
        ? new Date(issue.fields.resolutiondate).getTime() : 0
      if (resolvedMs >= cut14)       shippedIssues.push(issue)
      else if (resolvedMs >= cut28)  prevIssues.push(issue)
      // older than 28d → ignore
    } else if (cat === 'new') {
      backlogIssues.push(issue)       // not started — backlog
    } else {
      activeIssues.push(issue)        // indeterminate — genuinely in flight
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

      epics.push({
        id:              epic.key,
        teamId:          boardId,
        name:            epic.fields.summary,
        kind,
        issueType,
        doneChildren,
        totalChildren:   children.length,
        blockedChildren,
      })
    }
  }

  return epics
}

// ─── main export ─────────────────────────────────────────────────────────────

export async function getJiraIngest() {
  const { flagged: flaggedField } = await resolveCustomFields()

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

  const teams = issueResults.map(({ board, issues }) => buildTeam(board, issues, flaggedField))
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
