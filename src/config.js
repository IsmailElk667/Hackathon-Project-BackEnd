// ─── Central config ──────────────────────────────────────────────────────────
// Loads .env, validates, and decides the EFFECTIVE data source. If DATA_SOURCE
// is "jira" but no token is present, we transparently fall back to "mock" so the
// server never crashes on stage.
import 'dotenv/config'

const bool = (v, dflt = false) =>
  v === undefined ? dflt : /^(1|true|yes|on)$/i.test(String(v).trim())

const num = (v, dflt) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : dflt
}

const requested = (process.env.DATA_SOURCE || 'mock').toLowerCase()
const hasJiraCreds = Boolean(
  process.env.JIRA_BASE_URL && process.env.JIRA_EMAIL && process.env.JIRA_API_TOKEN
)

// Effective source: honor "jira" only if creds exist, else mock.
const dataSource = requested === 'jira' && hasJiraCreds ? 'jira' : 'mock'
const fellBack = requested === 'jira' && !hasJiraCreds

export const config = {
  dataSource,           // 'jira' | 'mock'  (effective)
  requestedSource: requested,
  fellBackToMock: fellBack,

  jira: {
    baseUrl: (process.env.JIRA_BASE_URL || '').replace(/\/+$/, ''),
    email: process.env.JIRA_EMAIL || '',
    apiToken: process.env.JIRA_API_TOKEN || '',
    boards: (process.env.JIRA_BOARDS || 'LO,PAY,UL,ANA,INFRA')
      .split(',').map(s => s.trim()).filter(Boolean),
  },

  mongo: {
    uri: process.env.MONGO_URI || '',
    db: process.env.MONGO_DB || 'hivepulse',
    enabled: Boolean(process.env.MONGO_URI),
  },

  sprint: {
    number: num(process.env.SPRINT_NUMBER, 24),
    week: process.env.SPRINT_WEEK || 'Jun 10, 2026',
    lengthDays: num(process.env.SPRINT_LENGTH_DAYS, 10),
    elapsedDays: num(process.env.SPRINT_ELAPSED_DAYS, 6),
  },

  poll: { cron: process.env.POLL_CRON || '*/5 * * * *' },
  tzDisplay: process.env.TZ_DISPLAY || 'America/New_York',

  narrative: {
    enabled: bool(process.env.ENABLE_NARRATIVE, false) && Boolean(process.env.ANTHROPIC_API_KEY),
    apiKey: process.env.ANTHROPIC_API_KEY || '',
  },

  server: {
    port: num(process.env.PORT, 8787),
    corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5176',
  },

  // Shared-password gate. Set ACCESS_PASSWORD to enable; leave blank to disable
  // (open). SESSION_SECRET is optional — if omitted, tokens are signed with a
  // key derived from the password.
  auth: {
    password: process.env.ACCESS_PASSWORD || '',
    secret: process.env.SESSION_SECRET || '',
    ttlDays: num(process.env.SESSION_TTL_DAYS, 7),
  },
}

export function logConfigBanner(log) {
  log.info(`source=${config.dataSource}${config.fellBackToMock ? ' (fell back: jira creds missing)' : ''}`)
  log.info(`mongo=${config.mongo.enabled ? 'enabled' : 'disabled (in-memory + seed.json)'}`)
  log.info(`narrative=${config.narrative.enabled ? 'on' : 'off'}  cron="${config.poll.cron}"`)
}
