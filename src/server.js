// ─── Express API + SSE ───────────────────────────────────────────────────────
import express from 'express'
import cors from 'cors'
import { config } from './config.js'
import { log } from './lib/log.js'
import { mongoStatus } from './db/mongo.js'
import { authEnabled, checkPassword, makeToken, verifyToken } from './auth.js'

export function createServer({ onManualIngest }) {
  const app = express()
  app.use(express.json())
  // CORS_ORIGIN can be "*" or comma-separated URLs: "https://app.vercel.app,https://custom.com"
  const corsOrigin = config.server.corsOrigin === '*'
    ? '*'
    : [...config.server.corsOrigin.split(',').map(s => s.trim()).filter(Boolean), /^http:\/\/localhost:\d+$/]
  app.use(cors({ origin: corsOrigin, credentials: false, allowedHeaders: ['Content-Type', 'Authorization'] }))

  // ── Auth guard ──
  // Requires a valid bearer token (header or ?token=) on protected routes.
  // No-op when auth is disabled (ACCESS_PASSWORD unset), so open mode is unchanged.
  function requireAuth(req, res, next) {
    if (!authEnabled()) return next()
    const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    const token = bearer || req.query.token
    if (verifyToken(token)) return next()
    res.set('WWW-Authenticate', 'Bearer')
    return res.status(401).json({ error: 'unauthorized' })
  }

  // In-memory latest snapshot + connected SSE clients.
  let snapshot = null
  let lastIngestAt = null
  const clients = new Set()

  function setSnapshot(next) {
    const changed = !snapshot || snapshot.hash !== next.hash
    snapshot = next
    lastIngestAt = new Date().toISOString()
    if (changed) {
      const frame = `event: snapshot\ndata: ${JSON.stringify(next)}\n\n`
      for (const res of clients) res.write(frame)
      log.info(`snapshot pushed to ${clients.size} client(s) hash=${next.hash}`)
    }
  }
  const getSnapshot = () => snapshot

  // ── Refresh-on-read (serverless-safe freshness) ──
  // On Vercel there is no persistent process, so the node-cron poller never runs
  // between requests and the in-memory snapshot stays frozen at the cold-boot
  // seed. Instead, lazily re-ingest whenever the cached snapshot is older than
  // this TTL. A single shared in-flight promise coalesces concurrent requests
  // into ONE ingest; on failure we keep serving the last good snapshot so a
  // transient Jira hiccup never 5xxs the dashboard.
  const FRESH_TTL_MS = (Number(process.env.SNAPSHOT_TTL_SEC) || 120) * 1000
  let refreshing = null
  async function ensureFresh() {
    const age = snapshot ? Date.now() - new Date(snapshot.generatedAt).getTime() : Infinity
    if (age < FRESH_TTL_MS) return
    if (!refreshing) {
      refreshing = Promise.resolve()
        .then(onManualIngest)
        .catch(err => log.error(`refresh-on-read ingest failed: ${err.message}`))
        .finally(() => { refreshing = null })
    }
    await refreshing
  }

  // ── Routes ──
  // Public: health check + login. Everything with data is behind requireAuth.
  app.get('/api/health', (_req, res) => {
    const ms = mongoStatus()
    res.json({ ok: true, source: snapshot?.source ?? config.dataSource, generatedAt: snapshot?.generatedAt ?? null, lastIngestAt, hash: snapshot?.hash ?? null, clients: clients.size, mongo: ms, authRequired: authEnabled() })
  })

  // Crude in-memory login throttle to blunt brute-force (matters most for short
  // passwords). Per-instance only — Vercel may run several — so it's a speed
  // bump, not a hard lock; a distributed limiter would need a shared store.
  const LOGIN_MAX = 8, LOGIN_WINDOW = 10 * 60 * 1000
  const loginHits = new Map()   // ip → { count, first }
  const clientIp = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'unknown'

  // Exchange the shared password for a signed token. When auth is disabled the
  // client is told so (authRequired:false) and no token is needed.
  app.post('/api/login', (req, res) => {
    if (!authEnabled()) return res.json({ ok: true, token: null, authRequired: false })
    const ip = clientIp(req)
    const now = Date.now()
    let rec = loginHits.get(ip)
    if (!rec || now - rec.first > LOGIN_WINDOW) { rec = { count: 0, first: now }; loginHits.set(ip, rec) }
    if (rec.count >= LOGIN_MAX) return res.status(429).json({ ok: false, error: 'too many attempts · try again in a few minutes' })
    if (checkPassword(req.body?.password)) { loginHits.delete(ip); return res.json({ ok: true, token: makeToken(), authRequired: true }) }
    rec.count++
    return res.status(401).json({ ok: false, error: 'invalid password' })
  })

  app.get('/api/snapshot', requireAuth, async (_req, res) => {
    await ensureFresh()
    if (!snapshot) return res.status(503).json({ error: 'warming up' })
    res.json(snapshot)
  })

  app.get('/api/team/:id', requireAuth, (req, res) => {
    const team = snapshot?.teams.find(t => t.id === req.params.id)
    if (!team) return res.status(404).json({ error: 'team not found' })
    res.json(team)
  })

  // Force a fresh ingest. ?full=1 returns the whole computed snapshot (sensitive
  // → auth required); a plain ack call stays open so the daily Vercel cron and
  // the dashboard's Refresh can trigger a re-pull without a token.
  app.post('/api/ingest', (req, res, next) => (req.query.full ? requireAuth(req, res, next) : next()), async (req, res) => {
    try {
      const snap = await onManualIngest()
      res.json(req.query.full ? snap : { ok: true, hash: snap.hash, source: snap.source })
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message })
    }
  })

  // Server-Sent Events — the "never sleeps" live feed.
  app.get('/api/stream', requireAuth, async (req, res) => {
    await ensureFresh()
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    })
    res.write('retry: 3000\n\n')
    if (snapshot) res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`)
    clients.add(res)
    log.info(`SSE client connected (${clients.size} total)`)

    const beat = setInterval(() => res.write(': ping\n\n'), 20_000)
    req.on('close', () => { clearInterval(beat); clients.delete(res) })
  })

  return { app, setSnapshot, getSnapshot }
}
