# Commslayer Dashboard

A local Dr. Woof CX operations dashboard showing ticket flow, queue metrics,
and coaching priorities for a support team using Commslayer.

The dashboard shows:

- **Ticket flow chart** — daily inflow (tickets entering queue) vs resolutions by Sarah (AI) and human agents (Mari, Michael, Gian), with a collapsible methodology legend
- **Agent scorecards** — per-agent queue metrics (new, backlog, waiting times)
- **Daily resolutions** — stacked bar chart by agent with click-to-reveal percentage breakdowns
- **10-day queue history** — daily snapshots with per-agent lines and a dashed "Total" line (actual daily sum)
- **Coaching queue** — ticket-level table filtered by urgency

**Sarah (AI):** Every conversation is auto-assigned to Sarah first. She either
resolves it (stays unassigned) or escalates to a human agent. The dashboard
labels these as "Sarah (AI)" resolutions in green.

**Theme:** Dark mode is the only theme — see the "Theming" section below.

The app runs on a local Mac Mini and is served via Cloudflare Tunnel at
`https://cx.xbtseal.com`. The Commslayer token is used only by the
external Python warmer script and never reaches the browser.

## Architecture

```
launchd (every 3h) → python3 scripts/warm-cache.py → Commslayer API
                                                         ↓
                                            .cache/dashboard.json
                                            .cache/resolutions.json
                                            .cache/inflow.json
                                                         ↓
Browser → Vinext server (:3004) → read files → serve JSON → React renders
```

The Vinext server never calls the Commslayer API. It reads cache files
written by the external Python warmer. This avoids the Vinext/Worker runtime
request timeout that kills long-running synchronous fetches (~5 min for 700+
tickets).

### Cache warmer

`scripts/warm-cache.py` fetches all open conversations and messages directly
from the Commslayer API, classifies each ticket, and writes results to:

- `.cache/dashboard.json` — live ticket data (700+ conversations, ~750KB)
- `.cache/resolutions.json` — daily resolution counts by `updated_at` (400-day retention)
- `.cache/inflow.json` — daily inflow counts by `created_at` (400-day retention)

Then calls the local dashboard refresh endpoint to persist a daily snapshot.

The combined dashboard + resolutions + inflow API pass takes ~5-7 minutes
for ~700 tickets. Sarah (AI) is detected via activity messages during the
classification phase — no special API endpoint needed.

Scheduled by launchd at **every 3 hours** (00:00, 03:00, 06:00, 09:00, 12:00,
15:00, 18:00, 21:00 HKT). Also runs on boot via `RunAtLoad`.

- Plist: `~/Library/LaunchAgents/com.dwa.commslayer-warmer.plist`
- Log: `~/Library/Logs/commslayer-warmer.log`
- Fetch time: ~5-7 minutes for ~700 tickets (3-min dashboard pass + ~30s for resolutions/inflow)

## Prerequisites

- Node.js `>=22.13.0`
- A Commslayer integration token with:
  - `conversations:read`
  - `messages:read`
- The agents' numeric Commslayer assignee IDs

Current IDs:

```text
Mari    10116
Michael 10207
Gian    8720
Sarah   (no assignee_id — auto-assigned by Commslayer)
```

## First run

From this folder:

```bash
npm install
cp .env.example .env.local
npm run db:migrate:local
```

Edit `.env.local`:

```dotenv
COMMSLAYER_API_TOKEN=your_token_here
COMMSLAYER_ASSIGNEE_IDS=10116,10207,8720
COMMSLAYER_AGENT_NAMES=Mari,Michael,Gian
```

Sarah (AI) is auto-assigned by Commslayer and does not need to be in
`COMMSLAYER_ASSIGNEE_IDS`. She is identified through activity messages
during classification.

Start the app:

```bash
npm run dev
```

Open:

```text
http://localhost:3004
```

In production, the app is served via Cloudflare Tunnel at
`https://cx.xbtseal.com` and managed by launchd:

- Server plist: `~/Library/LaunchAgents/com.dwa.commslayer-dashboard.plist`
- Warmer plist: `~/Library/LaunchAgents/com.dwa.commslayer-warmer.plist`
- Server log: `~/Library/Logs/commslayer-dashboard.{out,err}.log`
- Warmer log: `~/Library/Logs/commslayer-warmer.log`

Restart the server: `launchctl unload && launchctl load` the dashboard plist.
Trigger a manual data refresh: `python3 scripts/warm-cache.py`

If the token or assignee IDs are missing, the app starts in clearly labelled
demo mode with three sample scorecards.

## Production-style local run

```bash
npm run build
npm start
```

The app still runs locally at `http://localhost:3004`.

## Environment variables

| Variable | Required | Default | Purpose |
|---|---:|---|---|
| `COMMSLAYER_API_TOKEN` | Yes | — | Server-side integration token |
| `COMMSLAYER_ASSIGNEE_IDS` | Yes | — | Comma-separated numeric IDs (Mari=10116, Michael=10207, Gian=8720) |
| `COMMSLAYER_AGENT_NAMES` | No | `Mari,Michael,Gian` | Comma-separated display names matching the ID order |
| `COMMSLAYER_ASSIGNEE_ID` | No | — | Backward-compatible single ID or comma-separated IDs |
| `COMMSLAYER_API_BASE_URL` | No | Commslayer v1 API | API base URL |
| `COMMSLAYER_CACHE_SECONDS` | No | `21600` | In-memory cache TTL (6h, refresh button bypasses) |
| `COMMSLAYER_REQUEST_CONCURRENCY` | No | `6` | Maximum concurrent message requests per agent |
| `COMMSLAYER_REQUEST_INTERVAL_MS` | No | `1050` | Minimum delay between API requests; protects the 60 requests/minute limit |
| `COMMSLAYER_FIRST_REPLY_THRESHOLD_HOURS` | No | `24` | New-ticket target |
| `COMMSLAYER_BACKLOG_THRESHOLD_HOURS` | No | `48` | Backlog waiting target |

**Note:** Sarah (AI) is auto-assigned by Commslayer and has no `assignee_id`
in the API. She is automatically detected via activity messages rather than
configured through environment variables.

Do not put a real token in `.env.example`, source control, screenshots, issue
comments, or documentation. `.env.local` is ignored by Git.

## Data flow

The external Python warmer (`scripts/warm-cache.py`) fetches data directly from
the Commslayer API every 3 hours:

```text
GET /conversations?filter[assignee_id]=ASSIGNEE_ID&filter[status]=open&page[limit]=100
GET /conversations?filter[status]=resolved&page[limit]=100   (for resolutions + inflow)
```

It follows `meta.next_cursor` until every page has been collected, then
retrieves each conversation's messages:

```text
GET /conversations/{conversation_id}/messages?page[limit]=100
```

The three agent queues are calculated independently and then combined. The
result is written to `.cache/dashboard.json` which the Vinext server reads on
each API request. Resolved conversations are also grouped by `updated_at`
(resolutions) and `created_at` (inflow) into `.cache/resolutions.json` and
`.cache/inflow.json` respectively.

Rate limiting: 1050ms minimum between requests, 429 retry-after handling.

The Vinext server (`app/api/dashboard/route.ts`) reads the cache file and
serves it as JSON. It never calls the Commslayer API. A `?refresh=1` query
param bypasses the in-memory cache and re-reads the file directly.

## Persistent history

Successful live refreshes write one aggregate snapshot per agent per Sydney
calendar day to `.cache/history.json`. Repeated refreshes on the same day
replace that day's snapshot instead of creating duplicates.

Stored fields are limited to:

- snapshot date and capture time;
- agent name and assignee ID; and
- the seven aggregate queue counts shown by the dashboard.

Ticket subjects, messages, contacts, and other customer data are not stored.

The local history file lives at:

```text
.cache/history.json
```

This file is ignored by Git but survives app and machine restarts. History
is retained for 400 days. Weekly values are averages of the available daily
point-in-time snapshots, not sums.

The Queue History chart on the dashboard renders the last 10 days of raw
daily snapshots with:
- Per-agent colored lines (Mari blue, Michael gold, Gian red)
- A dashed grey "Total" line connecting the actual daily sum of Mari + Michael + Gian
- Six metric buttons: New, <24H, >24H, Backlog, >48H, Open (cycling)

After each successful cache write, the warmer calls the local dashboard refresh
endpoint so the daily snapshot is persisted without requiring a browser visit.
The API cannot reconstruct queue states from dates before snapshots were
collected, and snapshots are not collected while the local app is off.

**Metric definition change (2026-07-28):** Snapshots collected before this date
counted any public outgoing message (including AI replies) as a human reply.
Snapshots from this date forward count only `sender_type = "User"` messages.
Historical snapshots before 2026-07-28 are retained as legacy data and are not
directly comparable with newer snapshots. Raw messages are not persisted, so
historical recalculation is not possible.

## Resolutions and inflow

`scripts/warm-cache.py` also fetches `status=resolved` conversations (newest
first, paginated) and writes two additional cache files:

- `.cache/resolutions.json` — grouped by `updated_at` date, split by `assignee_id`
  (including `null` for Sarah AI). 400-day retention, merge strategy = newest
  wins per date.
- `.cache/inflow.json` — same resolved conversations re-grouped by `created_at`
  date. No extra API calls — same data, different grouping.

The API route reads both files and serves them as `resolutions[]` and
`inflow[]` in the dashboard payload. The frontend renders them as the
TicketFlowChart (inflow vs resolution dual bars) and the ResolutionChart
(stacked bars with click-to-reveal percentage breakdowns).

**Why inflow ≠ resolutions on a single day:** Inflow uses `created_at`
(when the ticket entered the queue) and resolutions use `updated_at`
(when it was resolved). A ticket created Monday may be resolved Wednesday
— it appears in Monday's inflow but Wednesday's resolutions.

## Metric contract

Resolution and inflow metrics use the same `sender_type` rules as the
queue classification above. The dashboard separates Sarah (AI) from human
agents using the `assignee_id` rules documented in the "Sarah (AI)
identification" section below.

### Public reply

```text
message_type = outgoing
AND private != true
AND sender_type = "User"
AND created_at is on or after the first incoming message
```

Private notes do not count as replies. AI replies (`sender_type = "AIAgent"`)
do not count as human replies — they cannot move a ticket from New to Backlog.
A public reply from any human CX agent counts, regardless of which agent is
assigned to the conversation. If the business later wants only the assigned
agent's reply to count, an additional `sender_id` rule is required.

### New ticket

```text
status = open
AND at least one incoming message exists
AND no public outgoing reply exists
```

The waiting clock starts at the first incoming message.

### Backlog ticket

```text
status = open
AND a public outgoing reply exists
```

For the 48-hour breach metric, the waiting clock starts at the latest incoming
message that arrived after the latest public outgoing reply.

### Daily resolution

```text
status = resolved
AND updated_at falls on that date
```

The API has no `resolved_at` field. `updated_at` is the closest proxy and
is used to group resolutions by date.

### Daily inflow

```text
status = resolved
AND created_at falls on that date
```

Every conversation enters the queue through Sarah (AI) first, so inflow
equals total daily ticket volume. Grouped by `created_at` date (UTC, first
10 characters of the ISO timestamp).

### Reconciliation

```text
total active = new total + backlog total
```

Open conversations without an incoming message are returned as `unclassified`
and shown in the reconciliation warning rather than silently included in
either queue.

## Sender type validation

Live API inspection confirmed the following `sender_type` values:

| sender_type | Meaning |
|---|---|
| `Contact` | Customer/incoming message sender |
| `User` | Human CX agent (outgoing) |
| `AIAgent` | AI/bot auto-reply (outgoing) |
| `null` | System activity events |

As of 2026-07-28, `isPublicOutgoing()` in `app/lib/metrics.mjs` requires
`sender_type === "User"`, so AI replies do not count as human replies. If
Commslayer introduces additional sender types, update this filter after
validating live data.

## Sarah (AI) identification

The Commslayer API has no `/agents` or `/users` endpoints. Sarah (AI) is
identified through activity messages, not by any `assignee_id`:

- **Auto-assigned:** `"Sarah was automatically assigned to this conversation"`
- **Resolved by Sarah:** final `assignee_id` is null (the "unassigned" bucket in `.cache/resolutions.json`)
- **Escalated:** `"Sarah was removed from the conversation: no matching guidance detected"` → human agent takes over

The dashboard labels Sarah's resolutions as "Sarah (AI)" in green (`#22c55e`)
across both the resolution chart and the ticket flow chart.

## Project structure

```text
app/
  api/dashboard/route.ts   Reads .cache/dashboard.json, serves JSON
  api/health/route.ts       Health check endpoint
  lib/commslayer.mjs       Commslayer API client (used by warmer historically)
  lib/demo.mjs             Three-agent demo dataset
  lib/history.ts           Persistent daily snapshots and history reads
  lib/history-math.mjs     Weekly aggregation logic
  lib/metrics.mjs          Queue classification and scorecard aggregation
  page.tsx                 Three-column interactive dashboard
  globals.css              Dark theme CSS variables + layout styles (~1500 lines)
db/
  schema.ts                Legacy D1 metric snapshot schema
drizzle/
  *.sql                    Legacy database migrations
scripts/
  warm-cache.py            External cache warmer (launchd, every 3h)
tests/
  dashboard-logic.test.mjs Metric calculation tests (18 tests)
  history.test.mjs         Weekly aggregation tests
  rendered-html.test.mjs   Build/render smoke test
.cache/
  dashboard.json           Live data cache (written by warmer, read by server)
  history.json             Aggregate daily history (no customer content)
  resolutions.json         Daily resolution counts by agent
  inflow.json              Daily inflow counts by agent (tickets entering queue)
.env.example               Safe configuration template
.env.local                 Real token + agent IDs (gitignored)
wrangler.migrations.jsonc  Local D1 migration configuration
```

## Theming

Dark mode is the only theme. The color system is driven by CSS custom
properties in `app/globals.css` `:root` — see the CSS variables section
in that file for the full palette. When adding a new component:

- Use semantic vars (`var(--text-muted)`, `var(--surface-elevated)`) — never hardcode hex
- Agent colors (Mari/Michael/Gian/Sarah) are intentionally hardcoded in
  `page.tsx`'s `agentColors` map because they're part of the chart legend
  identity, not the theme
- The agent scorecards (`.agent-scorecard` at `#20252a`) are already dark —
  leave them alone

## Commands

```bash
npm run dev       # local development server
npm run build     # production build validation
npm test          # metric tests and rendered-page test
npm run lint      # source linting
npm run db:generate       # generate a migration after schema changes
npm run db:migrate:local  # apply pending migrations to local history storage
```

## Handoff notes for another agent

1. Read this README before changing the metric logic.
2. Never request, print, log, or commit the real integration token.
3. Run `npm test` before and after metric changes.
4. Keep each agent's six metrics mathematically reconcilable.
5. Preserve cursor pagination for both conversations and messages.
6. Keep request concurrency conservative because the public API documentation
   does not specify rate limits.
7. Validate live sender types before changing reply attribution.
8. Keep historical storage aggregate-only. `.cache/history.json` must never
   contain ticket subjects, messages, contacts, or other customer content.
9. The `.openai/hosting.json` file belongs to the starter runtime. This project
   is currently intended for local-only use and has no Sites `project_id`.
10. The dashboard is dark-mode-only (no light variant). Do not add
    `prefers-color-scheme: light` overrides. New colors should go through
    semantic CSS variables in `app/globals.css` `:root`.
11. The Queue History chart's "Total" line is the actual daily sum of
    Mari + Michael + Gian, not a regression best-fit line. Each point is
    hoverable with the exact sum.
12. The TicketFlowChart renders a dual-bar chart: purple inflow (left) vs
    stacked resolution bars (right). The methodology legend below uses
    a `<details>` element (see `app/page.tsx` for the existing pattern).
13. Sarah (AI) has no `assignee_id` — she is identified through activity
    messages during classification. Don't add her to
    `COMMSLAYER_ASSIGNEE_IDS`.

## Troubleshooting

### Demo mode remains visible

Confirm `.env.local` exists in this folder, `COMMSLAYER_API_TOKEN` is filled,
`COMMSLAYER_ASSIGNEE_IDS` contains comma-separated IDs, and the development
server was restarted after editing the file.

### `401 Missing or invalid authentication token`

The integration token is missing, expired, or incorrect.

### `403 Token does not have required scope`

Add `conversations:read` and `messages:read` to the integration token.

### Dashboard shows demo mode

The cache file (`.cache/dashboard.json`) doesn't exist yet or is empty. Wait
for the next scheduled warmer run, or trigger one manually:

```bash
python3 scripts/warm-cache.py
```

Check the warmer log: `~/Library/Logs/commslayer-warmer.log`

### Dashboard refresh is slow

The Vinext server reads a local file — it should respond in <10ms. If the
page loads slowly, the issue is network (Cloudflare Tunnel) or the browser.

The Commslayer API fetch itself takes 5-7 minutes for ~700 tickets. This is
handled by the external warmer, not the server.

### Numbers do not match a Commslayer saved view

Compare 20 individual tickets. Check:

- whether private notes count in the saved view;
- whether AI/bot replies count;
- whether another agent replied to an assigned ticket;
- whether Commslayer uses calendar hours or configured business hours;
- whether the saved view uses `>` or `>=` at the 24/48-hour boundary; and
- whether the saved view's "hours waiting" clock uses the first or latest
  unanswered incoming message.
