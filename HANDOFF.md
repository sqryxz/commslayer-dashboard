# CX Dashboard — Handoff for Codex

## Project Overview

**URL:** https://cx.xbtseal.com (Cloudflare Tunnel → localhost:3004)
**Path:** `~/Dropbox/DWA/DWA-Brain/Commslayer Dashboard/`
**Stack:** Vinext (Next.js fork) + React + TypeScript, Python cache warmer, Cloudflare Tunnel
**Purpose:** Operations dashboard for a customer support team using Commslayer (a helpdesk tool). Shows queue metrics, ticket flow (inflow → AI resolution → human resolution), coaching priorities, and historical trends.

**Agents tracked:**

| Name | Role | Assignee ID | Chart Color |
|------|------|-------------|-------------|
| Sarah | AI bot (auto-assigned to all conversations first) | null (unassigned) | `#22c55e` (green) |
| Mari | Human CX agent | 10116 | `#26b2dd` (blue) |
| Michael | Human CX agent | 10207 | `#d3aa22` (gold) |
| Gian | Human CX agent | 8720 | `#d96e5f` (red) |

**Sarah flow:** Every incoming conversation is auto-assigned to Sarah first. She either resolves it (ticket stays `assignee_id=null`, marked "resolved by Auto-labels") or escalates it (activity: "removed from the conversation: no matching guidance detected") and a human agent takes over.

## API: Commslayer

Base URL: `https://app.commslayer.com/api/integration/v1`
Auth: Bearer token in `.env.local` (`COMMSLAYER_API_TOKEN`)
Rate limit: ~1 request/second, 429 with `retry-after` header

### Endpoints used

| Endpoint | Filters | Purpose |
|----------|---------|---------|
| `GET /conversations` | `filter[assignee_id]`, `filter[status]=open` | Fetch open conversations per agent |
| `GET /conversations` | `filter[status]=resolved` | Fetch resolved conversations (resolution + inflow data) |
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
.cache/inflow.json       (daily inflow counts per agent, 400-day retention)
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
| `scripts/warm-cache.py` | Cache warmer — fetches API, classifies tickets, writes cache files (dashboard, resolutions, inflow). Runs via `launchd com.dwa.commslayer-warmer` every 3 hours. |
| `app/api/dashboard/route.ts` | API route — reads cache files, serves combined JSON payload (dashboard + history + resolutions + inflow). |
| `app/page.tsx` | Main frontend (~1700 lines) — all UI components, SVG charts, ticket tables. |
| `app/lib/history.ts` | History persistence — manages `history.json` snapshots, weekly aggregation. |
| `app/lib/commslayer.mjs` | API client (JS) — paginated fetch, rate limiter, queue fetcher. |
| `.env.local` | Secrets — API token, assignee IDs, agent names. |
| `.cache/dashboard.json` | Live snapshot cache (~750KB, 700+ tickets). |
| `.cache/history.json` | Daily metric snapshots (12KB, growing daily). |
| `.cache/resolutions.json` | Daily resolution counts by agent (2KB, 15 rows, Jul 24 → present). |
| `.cache/inflow.json` | Daily inflow counts by agent (1KB, 14 rows, Jul 26 → present). |

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
- Stacked bars: Mari (blue) / Michael (gold) / Gian (red) / **Sarah (AI)** (green)
- 7-day rolling average line (dashed green)
- **Click any bar** to see a per-agent percentage breakdown panel
- Non-selected bars dim to 35% opacity when one is selected
- Summary stats: Latest count, 7-day avg, Sarah (AI) count
- Tooltips show percentages: "Mari, 6 Aug: 65 (36%)"

**"Unassigned" = Sarah (AI):** The unassigned bucket in the API represents tickets Sarah resolved end-to-end without human escalation. Labeled "Sarah (AI)" in green on the dashboard.

### 3. Added Ticket Flow chart (end-to-end pipeline)

**Added:** `TicketFlowChart` component — dual-bar chart showing the complete ticket lifecycle per day:
- **Left bar (purple):** Inflow — tickets entering the queue (`created_at` date)
- **Right bar (stacked):** Resolutions — Sarah (AI, green) / Mari (blue) / Michael (gold) / Gian (red)
- Summary stats: avg inflow/day, Sarah resolve rate %, human resolve avg/day
- Collapsible "How each stage is calculated" legend below the chart

**Backend changes:**
- `warm-cache.py`: Added `fetch_inflow_counts()` — paginates resolved conversations, groups by `created_at` date + final assignee (sarah/mari/michael/gian/other), writes to `.cache/inflow.json` (400-day retention, merge strategy = newest wins)
- `app/api/dashboard/route.ts`: Added `readInflow()` + `InflowRow` type — serves last 14 days as `inflow[]` in payload

**Data semantics:**
- Inflow = all conversations created that day (by `created_at`). Every ticket enters through Sarah first.
- Sarah resolved = resolved conversations where `assignee_id` is null. Sarah handled it without escalating.
- Agent resolved = resolved conversations where `assignee_id` matches that human agent. Sarah escalated these ("removed: no matching guidance detected").
- Inflow and resolution are grouped by different date fields (`created_at` vs `updated_at`), so they don't match on any single day. Over 7-day windows they roughly balance.

### 4. Collapsible methodology legend

Below the Ticket Flow chart, a `<details>` panel explains how each stage is calculated, the Sarah flow model, why inflow ≠ resolutions on a single day, and the data source. Uses color-coded labels matching the chart legend.

## Data Insights (as of Aug 8)

### Queue state
- **664 active tickets** across 3 agents
- **Mari:** 281 active, 18 unclassified
- **Michael:** 336 active, 36 unclassified
- **Gian:** 2 active (minimal activity)

### Resolution trends
- 7-day rolling average: **139/day** (up from 104/day two weeks ago)
- Sarah (AI): ~47/day, resolving **54%** of inflow
- Mari: ~65/day, trending up (hit 91 on Aug 7)
- Michael: ~49/day, steady

### Inflow vs clearance
- Avg inflow: **87 tickets/day** (7-day avg)
- Roughly balanced with resolutions on normal days
- Inflow spikes (Aug 3: 175 tickets) create multi-day backlog
- Aug 1-2 show low inflow AND low resolutions (weekend)

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

1. **Weekend detection** — Aug 1-2 show very low activity. Should charts annotate weekends differently?
2. **Backlog aging** — can we show how long the oldest ticket in each agent's backlog has been waiting? (Data is available in `hoursWaiting` field on tickets)
3. **Clearance rate target line** — should we add a horizontal target line on the resolution chart (e.g., target: 200/day)?
4. **Sarah escalation tracking** — currently we know Sarah's total resolutions but not her escalation rate (how many tickets she removes herself from vs auto-resolves). Could be computed by paginating messages for activity events, but would add significant API calls.
5. **Inflow vs resolution net chart** — could add a third element showing net queue delta (inflow − resolutions) as a line or area chart overlay.
