// ─── Jira REST API v3 client ──────────────────────────────────────────────────
// Basic auth (email:token). Retries on 429. Custom field IDs cached after boot.
import axios from 'axios'
import { config } from '../config.js'
import { log } from '../lib/log.js'

function makeClient() {
  const token = Buffer.from(`${config.jira.email}:${config.jira.apiToken}`).toString('base64')

  const client = axios.create({
    baseURL: config.jira.baseUrl,
    headers: {
      Authorization: `Basic ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    timeout: 20000,
  })

  client.interceptors.response.use(null, async (err) => {
    if (err.response?.status === 429) {
      const wait = Number(err.response.headers['retry-after'] || 5) * 1000
      log.warn(`jira: rate limited, retrying in ${wait / 1000}s`)
      await new Promise(r => setTimeout(r, wait))
      return client.request(err.config)
    }
    throw err
  })

  return client
}

let _client = null
export function getClient() {
  if (!_client) _client = makeClient()
  return _client
}

// Cached custom field resolution — called once at boot, then reused every cycle.
let _customFields = null

export async function resolveCustomFields() {
  if (_customFields) return _customFields

  const { data } = await getClient().get('/rest/api/3/field')
  let storyPoints = null, epicLink = null, flagged = null, sprint = null

  for (const f of data) {
    const n = (f.name || '').toLowerCase()
    if (!storyPoints && /^story points?$|^sp$|^story point estimate$/.test(n)) storyPoints = f.id
    if (!epicLink   && /^epic link$|^epic name$/.test(n))                        epicLink   = f.id
    if (!flagged    && /^flagged$|^impediment$/.test(n))                         flagged    = f.id
    if (!sprint     && /^sprint$/.test(n))                                       sprint     = f.id
  }

  _customFields = { storyPoints, epicLink, flagged, sprint }
  log.info(`jira fields resolved: storyPoints=${storyPoints} epicLink=${epicLink} flagged=${flagged} sprint=${sprint}`)
  return _customFields
}

/**
 * Run a JQL search using POST /rest/api/3/search/jql (cursor-based pagination).
 * Returns a flat array of Jira issues.
 * Fields fetched: lean set — deliberately excludes description and comments.
 */
export async function searchAll(jql) {
  const customFields = await resolveCustomFields()

  const fields = [
    'summary', 'status', 'assignee', 'labels', 'created', 'updated',
    'issuetype', 'parent', 'priority', 'resolutiondate', 'issuelinks',
    ...(customFields.storyPoints ? [customFields.storyPoints] : []),
    ...(customFields.epicLink    ? [customFields.epicLink]    : []),
    ...(customFields.flagged     ? [customFields.flagged]     : []),
    ...(customFields.sprint      ? [customFields.sprint]      : []),
  ]

  const all = []
  let nextPageToken = undefined

  do {
    const body = { jql, fields, maxResults: 100, ...(nextPageToken ? { nextPageToken } : {}) }
    const { data } = await getClient().post('/rest/api/3/search/jql', body)
    const batch = data.issues || []
    all.push(...batch)
    nextPageToken = data.nextPageToken || null
  } while (nextPageToken)

  return all
}
