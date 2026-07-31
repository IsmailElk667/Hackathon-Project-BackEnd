# CLAUDE.md — hive-pulse-server (backend)

Guidance for anyone (human or Claude Code) editing this repo. Full narrative + history is in the
frontend repo's `PROJECT_HANDOFF.md` (`../hive-pulse-scroll/PROJECT_HANDOFF.md`).

## What this repo is
The **backend** of Hive Pulse. Node + Express + SSE. It ingests from **Jira**, computes a
dashboard **snapshot** JSON, and serves it to the frontend (`../hive-pulse-scroll`).

- Prod: https://hive-pulse-server.vercel.app (Vercel project `hive-pulse-server`)
- GitHub: `IsmailElk667/Hackathon-Project-BackEnd`
- Consumed by frontend via `GET /api/snapshot` (+ SSE `/api/stream`), password-gated.

## Run / deploy
```bash
npm install
npm start          # node src/index.js  (:8787). Serves seed/mock with NO creds — safe locally.
npm run seed       # regenerate data/seed.json
```
**Deploy = `git push origin master`.** Vercel is git-connected (no CLI/token here). Confirm with
`curl https://hive-pulse-server.vercel.app/api/health` → `source`, fresh `generatedAt`.

> ⚠️ The Jira code paths **cannot run locally without creds** (`DATA_SOURCE`/`JIRA_*` unset → it
> falls back to mock). Validate Jira changes against prod after deploy, or with the Atlassian
> connector if available. `/api/health` exposes `source`, `generatedAt`, `mongo`, `authRequired`
> without a password — use it to verify deploys.

## Data source switch (`src/config.js`)
`dataSource` = `jira` **only if** `DATA_SOURCE=jira` AND all of `JIRA_BASE_URL` / `JIRA_EMAIL` /
`JIRA_API_TOKEN` are set; otherwise silently `mock`. Env vars (set in Vercel):
`DATA_SOURCE, JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_BOARDS` (default `LO,PAY,UL,ANA,INFRA`),
`ACCESS_PASSWORD` (dashboard gate), `SESSION_SECRET, SESSION_TTL_DAYS, SNAPSHOT_TTL_SEC` (default
120), `MONGO_URI` (optional — currently NOT connected in prod), `ACH_SUCCESS_RATE, SPRINT_*`.
Jira cloudId: `af587a58-346d-4edf-9336-eb78d577a08c`.

## Pipeline (follow the data)
`src/index.js` (boot: connect Mongo optional → load seed → listen → poller) →
`ingest/runIngest.js` (`getJiraIngest` or `getMockIngest`, mock fallback on any error) →
`score/buildSnapshot.js` (assemble + hash) → served by `server.js`.

Key files:
- `server.js` — routes, SSE, auth guard, **`ensureFresh()` (refresh-on-read)**. See Serverless below.
- `jira/client.js` — axios (basic auth), `searchAll` (JQL), `resolveCustomFields`,
  `getStatusCategoryMap`, `fetchChangelog`.
- `jira/fetchIssues.js` — the ingest:
  - `buildTeam()` — buckets issues; **sprint-scopes** WIP/throughput/blockers to the active sprint.
  - `computeFlowCycle()` — fallback cycle time (created→resolved, 90d).
  - `buildBurnup()` — daily `{t,scope,done}` series from sprint issue dates.
  - `attachSprintCycleTime()` — **Actionable-Agile-style cycle time from the changelog** (first
    in-progress transition → completion, inclusive days, sprint median). Overrides `computeFlowCycle`.
  - `getJiraIngest()` — orchestrates all of the above.
- `score/buildSnapshot.js` — adds `burnup` + `flowCycle` per team; `synthBurnup`/`deriveFlowCycle`
  fallbacks for mock/local. `hashPayload` ignores `generatedAt` (so SSE only pushes real changes).
- `score/weights.js` — `STATUS_ALIASES` (Jira status name → canonical lifecycle index).
- `ingest/mockSource.js` + `data/seed.json` — demo/cold-boot data.

## Snapshot contract (what the frontend expects — don't break these keys)
Per team: `id, name, board, shipped, inFlight, stalled, blockers[], inFlightTickets[],
activeSprint{id,name,startDate,endDate}, burnup{start,end,points:[{t,scope,done}]},
flowCycle{avg,median,max,sampleSize,basis}`. Top-level: `source, generatedAt, hash, teams[],
sprint, infraBlockers[], initiatives[], leadership, ceremonies, ticker`.

## Serverless reality (important)
On Vercel there is **no long-lived process**, so the `node-cron` poller does **not** run between
requests. Freshness comes from **`ensureFresh()`** in `server.js`: on `/api/snapshot` (and
`/api/stream`) it re-ingests when the cached snapshot is older than `SNAPSHOT_TTL_SEC`, coalescing
concurrent requests and falling back to the last good snapshot on error. **Do not** rely on
fire-and-forget background work after sending a response — the function freezes.

## How to edit common things
| Want to change… | Edit |
|---|---|
| Cycle-time definition (start/end status, median vs avg, window) | `attachSprintCycleTime()` in `fetchIssues.js` |
| Which statuses map to which stage | `STATUS_ALIASES` in `weights.js` (+ frontend `STAGE_BAR`) |
| Sprint-scoping of WIP/throughput/blockers | `buildTeam()` (`inSprint` filter) in `fetchIssues.js` |
| Burn-up series | `buildBurnup()` in `fetchIssues.js` |
| Add/remove a board/team | `jira/boards.js` (`BOARDS`) + `JIRA_BOARDS` env; mirror in `mockSource.js` |
| Data freshness cadence | `SNAPSHOT_TTL_SEC` env (default 120s) |

## Known follow-ups
- **Cycle time = Actionable Agile parity**: we replicate AA's method from the changelog (AA's own
  numbers/config aren't API-exposed). Verify vs the AA report; if off, tweak the start-status
  detection in `attachSprintCycleTime`.
- **Per-team commitment/completion points** (In Dev for PAY/UL/AK; Analysis Done for LendingOps;
  completion = Merged to Release / Ready to Deploy) — only partially implemented; pending a PM
  verbiage-alignment meeting.
- **Mongo not connected** in prod — set `MONGO_URI` for a persistence/history layer.
- **Exact Greenhopper sprint-report** ingestion (to capture mid-sprint scope removals in the
  burn-up) — optional; needs a sample response from the Jira sprint-report endpoint.
