# Commslayer Dashboard

A local Dr. Woof CX scorecard for comparing three Commslayer agents: Mari,
Michael and Gian.

The dashboard shows one scorecard column per agent with:

- total active tickets;
- total new tickets;
- new tickets waiting less than 24 hours for their first reply;
- new tickets waiting 24 hours or more for their first reply;
- total backlog tickets; and
- backlog tickets with an unanswered customer message at least 48 hours old.

The combined ticket table includes the assigned agent, queue state, waiting
time, first reply, and last activity. Each agent also has an independent
reconciliation check proving `new + backlog = active`.

The app runs on a local Mac Mini and is served via Cloudflare Tunnel at
`https://cx.xbtseal.com`. The Commslayer token is used only by the
external Python warmer script and never reaches the browser.

## Architecture

```
launchd (every 3h) → python3 scripts/warm-cache.py → Commslayer API
                                                         ↓
                                                  .cache/dashboard.json
                                                         ↓
Browser → Vinext server (:3004) → read file → serve JSON → React renders
```

The Vinext server never calls the Commslayer API. It reads the cache file
written by the external Python warmer. This avoids the Vinext/Worker runtime
request timeout that kills long-running synchronous fetches (~5 min for 260
tickets).

### Cache warmer

`scripts/warm-cache.py` fetches all open conversations and messages directly
from the Commslayer API, classifies each ticket (mirroring `metrics.mjs`
logic), and writes the result to `.cache/dashboard.json`.

Scheduled by launchd at **every 3 hours** (00:00, 03:00, 06:00, 09:00, 12:00,
15:00, 18:00, 21:00 HKT). Also runs on boot via `RunAtLoad`.

- Plist: `~/Library/LaunchAgents/com.dwa.commslayer-warmer.plist`
- Log: `~/Library/Logs/commslayer-warmer.log`
- Fetch time: ~5-7 minutes for ~260 tickets

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
| `COMMSLAYER_ASSIGNEE_IDS` | Yes | — | Comma-separated numeric IDs |
| `COMMSLAYER_AGENT_NAMES` | No | `Mari,Michael,Gian` | Comma-separated display names matching the ID order |
| `COMMSLAYER_ASSIGNEE_ID` | No | — | Backward-compatible single ID or comma-separated IDs |
| `COMMSLAYER_API_BASE_URL` | No | Commslayer v1 API | API base URL |
| `COMMSLAYER_CACHE_SECONDS` | No | `21600` | In-memory cache TTL (6h, refresh button bypasses) |
| `COMMSLAYER_REQUEST_CONCURRENCY` | No | `6` | Maximum concurrent message requests per agent |
| `COMMSLAYER_REQUEST_INTERVAL_MS` | No | `1050` | Minimum delay between API requests; protects the 60 requests/minute limit |
| `COMMSLAYER_FIRST_REPLY_THRESHOLD_HOURS` | No | `24` | New-ticket target |
| `COMMSLAYER_BACKLOG_THRESHOLD_HOURS` | No | `48` | Backlog waiting target |

Do not put a real token in `.env.example`, source control, screenshots, issue
comments, or documentation. `.env.local` is ignored by Git.

## Data flow

The external Python warmer (`scripts/warm-cache.py`) fetches data directly from
the Commslayer API every 3 hours:

```text
GET /conversations?filter[assignee_id]=ASSIGNEE_ID&filter[status]=open&page[limit]=100
```

It follows `meta.next_cursor` until every page has been collected, then
retrieves each conversation's messages:

```text
GET /conversations/{conversation_id}/messages?page[limit]=100
```

The three agent queues are calculated independently and then combined. The
result is written to `.cache/dashboard.json` which the Vinext server reads on
each API request.

Rate limiting: 1050ms minimum between requests, 429 retry-after handling.

The Vinext server (`app/api/dashboard/route.ts`) reads the cache file and
serves it as JSON. It never calls the Commslayer API. A `?refresh=1` query
param bypasses the in-memory cache and re-reads the file directly.

## Persistent history

Successful live refreshes write one aggregate snapshot per agent per Sydney
calendar day to a local D1/SQLite database. Repeated refreshes on the same day
replace that day's snapshot instead of creating duplicates.

Stored fields are limited to:

- snapshot date and capture time;
- agent name and assignee ID; and
- the seven aggregate queue counts shown by the dashboard.

Ticket subjects, messages, contacts, and other customer data are not stored.

The local database files live under:

```text
.wrangler/state/v3/d1/
```

This directory is ignored by Git but survives app and machine restarts. History
is retained for 400 days. Weekly values are averages of the available daily
point-in-time snapshots, not sums.

History begins with the first successful live refresh after the database
migration. The API cannot reconstruct queue states from dates before snapshots
were collected, and snapshots are not collected while the local app is off.

**Metric definition change (2026-07-28):** Snapshots collected before this date
counted any public outgoing message (including AI replies) as a human reply.
Snapshots from this date forward count only `sender_type = "User"` messages.
Historical snapshots before 2026-07-28 are retained as legacy data and are not
directly comparable with newer snapshots. Raw messages are not persisted, so
historical recalculation is not possible.

## Metric contract

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

## Project structure

```text
app/
  api/dashboard/route.ts   Reads .cache/dashboard.json, serves JSON
  lib/commslayer.mjs       Commslayer API client (used by warmer historically)
  lib/demo.mjs             Three-agent demo dataset
  lib/history.ts           Persistent daily snapshots and history reads
  lib/history-math.mjs     Weekly aggregation logic
  lib/metrics.mjs          Queue classification and scorecard aggregation
  page.tsx                 Three-column interactive dashboard
  globals.css              Dr. Woof dashboard styling
db/
  schema.ts                D1/SQLite metric snapshot schema
drizzle/
  *.sql                    Database migrations
scripts/
  warm-cache.py            External cache warmer (launchd, every 3h)
tests/
  dashboard-logic.test.mjs Metric calculation tests (18 tests)
  history.test.mjs         Weekly aggregation tests
  rendered-html.test.mjs   Build/render smoke test
.cache/
  dashboard.json           Live data cache (written by warmer, read by server)
.env.example               Safe configuration template
.env.local                 Real token + agent IDs (gitignored)
wrangler.migrations.jsonc  Local D1 migration configuration
```

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
8. Do not add a database unless historical trends or snapshot retention are
   explicitly required. The current D1 database exists only for aggregate
   history.
9. The `.openai/hosting.json` file belongs to the starter runtime. This project
   is currently intended for local-only use and has no Sites `project_id`.

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

The Commslayer API fetch itself takes 5-7 minutes for ~260 tickets. This is
handled by the external warmer, not the server.

### Numbers do not match a Commslayer saved view

Compare 20 individual tickets. Check:

- whether private notes count in the saved view;
- whether AI/bot replies count;
- whether another agent replied to an assigned ticket;
- whether Commslayer uses calendar hours or configured business hours;
- whether the saved view uses `>` or `>=` at the 24/48-hour boundary; and
- whether the saved view's “hours waiting” clock uses the first or latest
  unanswered incoming message.
