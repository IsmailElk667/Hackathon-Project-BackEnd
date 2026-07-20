// ─── Shared-password auth (signed bearer token) ───────────────────────────────
// A single ACCESS_PASSWORD gates the API. On login we mint a short-lived,
// HMAC-signed token; protected routes require it — as `Authorization: Bearer <t>`
// on fetches, or `?token=<t>` on the SSE stream (EventSource can't send headers).
//
// Cookies were avoided on purpose: the dashboard and API live on different
// domains, so a session cookie would be third-party (blocked by Safari, being
// phased out in Chrome). A bearer token is robust everywhere and SSE-friendly.
//
// If ACCESS_PASSWORD is unset, auth is DISABLED (open) — local/mock dev is
// unaffected until you set it in the environment.
import crypto from 'node:crypto'
import { config } from './config.js'

const b64url = (buf) => Buffer.from(buf).toString('base64url')

// Signing key: explicit SESSION_SECRET, else derived from the password so a
// single env var (ACCESS_PASSWORD) is enough to turn the feature on.
const secret = () =>
  config.auth.secret || crypto.createHash('sha256').update('hive-pulse:' + config.auth.password).digest('hex')

export const authEnabled = () => Boolean(config.auth.password)

const sign = (data) => crypto.createHmac('sha256', secret()).update(data).digest('base64url')

// Constant-time password comparison.
export function checkPassword(input) {
  const a = Buffer.from(String(input ?? ''))
  const b = Buffer.from(String(config.auth.password))
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export function makeToken() {
  const payload = b64url(JSON.stringify({ exp: Date.now() + config.auth.ttlDays * 86400000 }))
  return `${payload}.${sign(payload)}`
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string') return false
  const [payload, sig] = token.split('.')
  if (!payload || !sig) return false
  const expected = sign(payload)
  const s = Buffer.from(sig), e = Buffer.from(expected)
  if (s.length !== e.length || !crypto.timingSafeEqual(s, e)) return false
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString())
    return typeof exp === 'number' && Date.now() < exp
  } catch { return false }
}
