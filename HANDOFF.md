# CX Dashboard — Handoff for Codex

## Project Overview

**URL:** https://cx.xbtseal.com (Cloudflare Tunnel → localhost:3004)
**Path:** `~/Dropbox/DWA/DWA-Brain/Commslayer Dashboard/`
**Stack:** Vinext (Next.js fork) + React + TypeScript, Python cache warmer, Cloudflare Tunnel
**Purpose:** Operations dashboard for a 3-agent customer support team (Mari, Michael, Gian) using Commslayer (a helpdesk tool). Shows queue metrics, coaching priorities, and historical trends.

## API: Commslayer

Base URL: `https://app.commslayer.com/api/integration/v1`
Auth: Bearer token in `.env.local` (`COMMSLAYER_API_TOKEN`)
Rate limit: ~1 request/second, 429 with `retry-after` header

### Endpoints used

| Endpoint | Filters | Purpose |
|----------|---------|---------|
| `GET /conversations` | `filter[assignee_id]`, `filter[status]=open` | Fetch open conversations per agent |
| `GET /conversations` | `filter[status]=resolved` | Fetch resolved conversations (clearance rate) |
| `GET /conversations` | `filter[assignee_id]` (no status filter) | All conversations per agent (inflow data) |
| `GET /conversations/{id}/messages` | — | Message history for classification |

### Conversation object shape

```json
{
  "id": "75191881",
  "attributes": {
    "id": "75191881",
    "assignee_id": "10116",
    "status": "open",          // open | resolved
    "created_at": "2026-08-07T16:37:17.414Z",
    "updated_at": "2026-08-07T16:37:20.944Z",
    "last_activity_at": "2026-08-07T16:37:20.895Z",
    "display_id": "142301",
    "subject": "Could Your Reviews Be Driving Customers Away?",
    "labels": ["collaboration-ugc-request"],
    "custom_attributes": {},
    "spam": false,
    "inbox_id": "1331",
    "contact_id": "431853133"
  }
}
```

**No `assigned_at` field exists.** `created_at` is the best proxy for when a ticket entered an agent's queue.

### Agent IDs

| Name    | Assignee ID | Chart Color |
|---------|-------------|-------------|
| Mari    | 10116       | `#26b2dd`   |
| Michael | 10207       | `#d3aa22`   |
| Gian    | 8720        | `#d96e5f`   |

## Architecture

### Data Flow

```
Commslayer API
    ↓ (every 3 hours via launchd)
warm-cache.py (Python)
    ↓ writes
.cache/dashboard.json    (live ticket data: 700+ conversations)
.cache/history.json      (daily snapshots: metrics per agent per day, 400-day retention)
.cache/resolutions.json  (daily resolution counts per agent, 400-day retention)
    ↓ read by
app/api/dashboard/route.ts (Next.js API route)
    ↓ serves JSON to
app/page.tsx (React frontend, SVG charts)
    ↓ served via
vinext start --port 3004
    ↓ proxied by
Cloudflare Tunnel → cx.xbtseal.com
```

### Key Files

| File | Role |
|------|------|
| `scripts/warm-cache.py` | Cache warmer — fetches API, classifies tickets, writes cache files. Runs via `launchd com.dwa.commslayer-warmer` every 3 hours. |
| `app/api/dashboard/route.ts` | API route — reads cache files, serves combined JSON payload. |
| `app/page.tsx` | Main frontend (~1300 lines) — all UI components, SVG charts, ticket tables. |
| `app/lib/history.ts` | History persistence — manages `history.json` snapshots, weekly aggregation. |
| `app/lib/commslayer.mjs` | API client (JS) — paginated fetch, rate limiter, queue fetcher. |
| `.env.local` | Secrets — API token, assignee IDs, agent names. |
| `.cache/dashboard.json` | Live snapshot cache (~750KB, 700+ tickets). |
| `.cache/history.json` | Daily metric snapshots (10KB, 27 rows, Jul 28 → present). |
| `.cache/resolutions.json` | Daily resolution counts (2KB, 15 rows, Jul 24 → present). |

### Build & Deploy

```bash
cd ~/Dropbox/DWA/DWA-Brain/"Commslayer Dashboard"
npx vite build                    # Build client + SSR
kill <vinext-pid>; npx vinext start --port 3004   # Restart server (background)
```

Cloudflare Tunnel auto-reconnects. No restart needed for tunnel.

**Git:** The project has a git repo (`.git/` present). Remote origin is at `~/Dropbox/DWA/DWA-Brain/` level (monorepo). Consider creating a standalone GitHub repo for easier sharing with Codex.

## Changes Made (Aug 8, 2026)

### 1. Replaced "What each agent should do now" with 10-day daily trend chart

**Removed:** The `queue-health` section containing per-agent action cards (coaching recommendations).

**Added:** `DailyHistorySection` + `DailyHistoryChart` — an SVG line chart showing the last 10 days of daily snapshots with:
- Metric buttons: New, <24H, >24H, Backlog, >48H, Open (cycling)
- Per-agent colored lines (Mari blue, Michael gold, Gian red)
- Total trendline (dashed gray, linear regression of daily totals)
- Hover tooltips on each data point

**Backend:** Added `daily` field to `HistorySummary` in `app/lib/history.ts` — exposes last 10 days of raw daily snapshots (previously only weekly aggregates were available).

### 2. Added Clearance Rate chart (daily resolutions)

**Added:** `ResolutionChart` component — stacked bar chart showing daily resolutions by agent:
- Stacked bars: Mari / Michael / Gian / Unassigned (gray)
- 7-day rolling average line (dashed green)
- Summary stats: Latest count, 7-day avg, tracked-agent total

**Backend changes:**
- `warm-cache.py`: Added `fetch_resolved_counts()` — paginates `filter[status]=resolved` conversations, groups by date + assignee, writes to `.cache/resolutions.json` (400-day retention, merge strategy = newest wins)
- `app/api/dashboard/route.ts`: Added `readResolutions()` — reads `.cache/resolutions.json`, returns last 14 days in the API payload as `resolutions` field

### 3. Pending: Queue inflow data

**Explored but NOT yet integrated into the dashboard.** We discovered the API can provide daily inflow (tickets entering each agent's queue by `created_at` date). Key findings:

```
Daily Inflow vs Resolved (recent):
Date         Inflow  Resolved  Gap
Jul 28         123      178     -55  (cleared more)
Aug 3          232      184     +48  (big spike, backlog grew)
Aug 6          188      180      +8  (roughly balanced)
Aug 7          130      215     -85  (cleared more than came in)
```

**Implementation needed:**
- Add inflow fetching to `warm-cache.py` (fetch all conversations per agent, group by `created_at` date)
- Store in `.cache/inflow.json` (same pattern as resolutions)
- Serve via API route
- Add to frontend (either as side-by-side bars in the resolution chart, or a separate section)

**Consideration:** Fetching inflow requires paginating ALL conversations per agent (not just open or resolved). This is ~900 conversations per agent for 14 days = ~27 API pages at 1.1s each = ~30s per agent. The warmer already takes several minutes; this adds ~90s.

## Data Insights (as of Aug 8)

### Queue state
- **619 active tickets** across 3 agents
- **Mari:** 281 active (183 need coaching), 18 unclassified
- **Michael:** 336 active (205 need coaching), 36 unclassified
- **Gian:** 2 active (minimal activity)

### Resolution trends
- 7-day rolling average: **147/day** (up from 104/day two weeks ago)
- Mari: ~65/day, trending up (hit 100 on Aug 7)
- Michael: ~49/day, steady
- Unassigned/bot resolutions: ~50/day (30-40% of total)

### Inflow vs clearance
- Roughly balanced on normal days (~130-200/day each)
- Inflow spikes (Aug 3: 232 tickets) create multi-day backlog
- Aug 1-2 show low inflow AND low resolutions (possibly weekend)

## Key Decisions & Constraints

1. **Vinext, not vanilla Next.js** — this project uses Vinext (a Vite-based Next.js alternative). Build commands differ slightly. The `.vinext/` directory contains framework files — don't touch them.

2. **SVG charts, no chart library** — all charts are hand-coded SVG. This keeps the bundle small and avoids dependency issues. If adding new charts, follow the existing pattern (viewBox, polyline, circle points).

3. **CSS variables for theming** — uses `var(--primary)`, `var(--text-muted)`, etc. defined in the global CSS. Agent colors are hardcoded hex in `agentColors` map.

4. **Cache files are the source of truth at runtime** — the server reads `.cache/*.json` files. The Python warmer writes them every 3 hours. The server itself never calls the Commslayer API directly (except for message pagination during classification, which only the warmer does).

5. **`verbatimModuleSyntax: true`** is NOT set in this project (unlike PPLLog). Standard imports work fine.

6. **Rate limiting is critical** — the Commslayer API enforces ~1 req/sec. The Python warmer and JS client both implement rate limiters. Don't parallelize API calls.

## GitHub Migration Notes

If moving to a standalone GitHub repo:

1. **Copy the entire `Commslayer Dashboard/` directory** (excluding `node_modules/`, `.vinext/`, `.wrangler/`)
2. **Move `.env.local` to `.env.example`** with redacted values:
   - `COMMSLAYER_API_TOKEN=<your-token>`
   - `COMMSLAYER_ASSIGNEE_IDS=10116,10207,8720`
   - `COMMSLAYER_AGENT_NAMES=Mari,Michael,Gian`
3. **Cache files** (`.cache/`) can be included as sample data — they're not secrets
4. **Update `.gitignore`** to exclude `node_modules/`, `.vinext/`, `.wrangler/`, `.env.local`
5. **The launchd plist** (`com.dwa.commslayer-warmer.plist`) lives in `~/Library/LaunchAgents/` — not in the repo, but document how to set it up

## Open Questions for Next Session

1. **Inflow chart integration** — should inflow be side-by-side bars with resolutions, a separate chart, or a combined "net queue change" visualization?
2. **Weekend detection** — Aug 1-2 show very low activity. Should charts annotate weekends differently?
3. **Backlog aging** — can we show how long the oldest ticket in each agent's backlog has been waiting? (Data is available in `hoursWaiting` field on tickets)
4. **Clearance rate target line** — should we add a horizontal target line on the resolution chart (e.g., target: 200/day)?
