# Ticket Flow & Resolution Data — How It Works

This document explains exactly how the "End-to-end ticket flow" and "Daily
resolutions" sections of the CX Dashboard get their data. It covers the full
pipeline: API call → grouping → cache file → API route → frontend chart.

---

## The one API call that powers both charts

Both sections use the **same API endpoint** — `GET /conversations?filter[status]=resolved`.
A single paginated fetch of resolved conversations gives us everything we need.
No separate endpoints, no message pagination, no per-agent fetching.

```
GET https://app.commslayer.com/api/integration/v1/conversations?filter[status]=resolved&page[limit]=100&page[after]=<cursor>
```

Auth: `Authorization: Bearer <COMMSLAYER_API_TOKEN>`

The API returns conversations newest-first (by `updated_at`). We paginate
with `page[after]` cursors until we hit conversations older than our 14-day
cutoff, then stop.

### Raw API response shape

```json
{
  "data": [
    {
      "id": "75191881",
      "assignee_id": "10116",
      "status": "resolved",
      "created_at": "2026-08-07T16:37:17.414Z",
      "updated_at": "2026-08-07T16:37:20.944Z",
      "last_activity_at": "2026-08-07T16:37:20.895Z",
      "display_id": "142301",
      "subject": "Could Your Reviews Be Driving Customers Away?",
      "labels": ["collaboration-ugc-request"],
      "spam": false,
      "inbox_id": "1331",
      "contact_id": "431853133"
    },
    ...
  ],
  "meta": {
    "next_cursor": "eyJpZCI6Ijc1MTkxODgxIn0="
  }
}
```

**Important:** The response objects are flat — NOT wrapped in `attributes`.
Some code defensively does `rec.get("attributes", rec)` but this falls
through to `rec` itself. The fields are directly on the object.

### Key fields we use

| Field | Type | What it tells us |
|-------|------|------------------|
| `assignee_id` | string or null | Who resolved it. `null` = Sarah (AI). `"10116"` = Mari. etc. |
| `status` | string | Always `"resolved"` (that's our filter) |
| `created_at` | ISO 8601 | When the ticket entered the queue → **inflow date** |
| `updated_at` | ISO 8601 | When it was last modified → **resolution date** (proxy) |

**There is no `resolved_at` field.** The API does not track when a conversation
was marked resolved. `updated_at` is the best proxy — it's set to the timestamp
of the last status change.

---

## Sarah (AI) — the key insight

Every incoming conversation is auto-assigned to **Sarah**, the Commslayer AI
bot, before any human sees it. Sarah either:

1. **Resolves it herself** → the conversation stays `assignee_id = null` (she
   was never a "real" assignee in the API's eyes)
2. **Escalates it** → activity message `"removed from the conversation: no
   matching guidance detected"` → a human agent is assigned → the conversation
   gets that agent's `assignee_id`

This means:
- **`assignee_id = null` on a resolved conversation = Sarah resolved it**
- **`assignee_id = "10116"` on a resolved conversation = Mari resolved it** (after Sarah escalated)

The Commslayer API has **no `/agents` or `/users` endpoint**. Sarah doesn't
have an assignee_id. She exists only in activity messages. We infer her
resolutions from the `null` assignee bucket.

---

## Step 1: Fetch resolved conversations (Python warmer)

File: `scripts/warm-cache.py`, function `fetch_resolved_counts()`

```python
def fetch_resolved_counts(token, api_base):
    cutoff = datetime.now(timezone.utc) - timedelta(days=14)
    cutoff_str = cutoff.strftime("%Y-%m-%d")
    resolved = []
    cursor = None
    for _ in range(100):                          # max 100 pages
        params = {"filter[status]": "resolved", "page[limit]": "100"}
        if cursor:
            params["page[after]"] = cursor
        url = f"{api_base}/conversations?{urllib.parse.urlencode(params)}"
        payload = api_request(url, token)         # Bearer auth, 1050ms rate limit
        records = payload.get("data", [])
        stopped = False
        for rec in records:
            attrs = rec.get("attributes", rec)    # defensive — usually just rec
            updated = attrs.get("updated_at", "")
            if updated[:10] >= cutoff_str:        # YYYY-MM-DD string comparison
                resolved.append(rec)
            else:
                stopped = True                    # past cutoff, stop paging
        cursor = payload.get("meta", {}).get("next_cursor")
        if not cursor or stopped:
            break
    # ...group by date + assignee (see below)
```

**Key details:**
- We paginate **newest-first** (by `updated_at`) and stop when we see records
  older than 14 days
- String comparison on `updated_at[:10]` (the `YYYY-MM-DD` part) works because
  ISO 8601 dates sort lexicographically
- The Commslayer API returns ~3100+ resolved conversations across all time.
  Paginating beyond ~16 pages can trigger HTTP 500 errors. The cutoff prevents this.
- Rate limit: 1050ms between requests, 429 retry-after handling

---

## Step 2: Group into resolutions data

Same function, continued. We group the resolved conversations by `updated_at`
date (resolution proxy) and split by final `assignee_id`:

```python
by_date = {}
agent_ids = {"10116", "10207", "8720"}
for rec in resolved:
    attrs = rec.get("attributes", rec)
    updated = attrs.get("updated_at", "")
    date = updated[:10]                           # "2026-08-07"
    assignee = str(attrs.get("assignee_id", ""))
    if date not in by_date:
        by_date[date] = {"total": 0, "mari": 0, "michael": 0, "gian": 0, "unassigned": 0}
    by_date[date]["total"] += 1
    if assignee == "10116":
        by_date[date]["mari"] += 1
    elif assignee == "10207":
        by_date[date]["michael"] += 1
    elif assignee == "8720":
        by_date[date]["gian"] += 1
    else:
        by_date[date]["unassigned"] += 1          # ← Sarah (AI) resolutions
```

**Agent IDs:**

| Name | Assignee ID | Bucket key |
|------|-------------|------------|
| Mari | `10116` | `mari` |
| Michael | `10207` | `michael` |
| Gian | `8720` | `gian` |
| Sarah (AI) | `null` / missing | `unassigned` |

Everything that isn't Mari, Michael, or Gian goes into `unassigned`. In
practice, this is overwhelmingly Sarah (AI) resolutions. (Rare edge case:
a human agent was unassigned before resolution.)

### Output: `.cache/resolutions.json`

```json
{
  "version": 1,
  "rows": [
    {"date": "2026-08-07", "total": 198, "mari": 86, "michael": 55, "gian": 0, "unassigned": 57},
    {"date": "2026-08-08", "total": 26, "mari": 0, "michael": 4, "gian": 0, "unassigned": 22}
  ]
}
```

---

## Step 3: Group into inflow data

File: `scripts/warm-cache.py`, function `fetch_inflow_counts()`

This uses the **same resolved conversations** but groups by `created_at`
instead of `updated_at`. No extra API calls needed — same data, different
date grouping.

```python
def fetch_inflow_counts(token, api_base):
    # ... same pagination as fetch_resolved_counts ...
    # But groups by created_at:
    by_date = {}
    for rec in inflow_convs:
        attrs = rec.get("attributes", rec)
        created = attrs.get("created_at", "")
        date = created[:10]                       # "2026-08-07"
        assignee = str(attrs.get("assignee_id", ""))
        if date not in by_date:
            by_date[date] = {"total": 0, "sarah": 0, "mari": 0, "michael": 0, "gian": 0, "other": 0}
        by_date[date]["total"] += 1
        if assignee in ("", "None", "null"):
            by_date[date]["sarah"] += 1           # Sarah resolved = null assignee
        elif assignee == "10116":
            by_date[date]["mari"] += 1
        elif assignee == "10207":
            by_date[date]["michael"] += 1
        elif assignee == "8720":
            by_date[date]["gian"] += 1
        else:
            by_date[date]["other"] += 1           # e.g. Manilyn (13345)
```

**Why `created_at` for inflow?** There is no `assigned_at` field. `created_at`
is when the ticket entered the queue. Since every ticket goes through Sarah
first, this equals total daily ticket volume.

**Why the same API call works for both:** The resolved endpoint returns both
`created_at` and `updated_at` on every conversation. We fetch once, group twice.

### Output: `.cache/inflow.json`

```json
{
  "version": 1,
  "rows": [
    {"date": "2026-08-07", "total": 64, "sarah": 31, "mari": 23, "michael": 10, "gian": 0, "other": 0},
    {"date": "2026-08-08", "total": 14, "sarah": 14, "mari": 0, "michael": 0, "gian": 0, "other": 0}
  ]
}
```

---

## Step 4: Merge with history (400-day retention)

Both `resolutions.json` and `inflow.json` use a merge strategy: new data
replaces existing rows for the same date, but old dates are preserved.

```python
def merge_resolution_data(existing, new_data):
    merged = {r["date"]: r for r in existing.get("rows", [])}  # index by date
    for date, counts in new_data.items():
        merged[date] = {"date": date, **counts}                # overwrite today's row
    sorted_rows = sorted(merged.values(), key=lambda r: r["date"])
    # Trim to 400-day retention
    cutoff = (datetime.now(timezone.utc) - timedelta(days=400)).strftime("%Y-%m-%d")
    sorted_rows = [r for r in sorted_rows if r["date"] >= cutoff]
    return {"version": 1, "rows": sorted_rows}
```

This means:
- **Today's row gets overwritten** on every warmer run (3h intervals) — the
  numbers update as more tickets get resolved
- **Historical rows are sticky** — once a day is in the past, it doesn't change
- **400-day retention** — old data is pruned

---

## Step 5: API route serves data to frontend

File: `app/api/dashboard/route.ts`

The Vinext server reads the cache files and serves them as part of the
dashboard JSON payload:

```typescript
type ResolutionRow = {
  date: string;
  total: number;
  mari: number;
  michael: number;
  gian: number;
  unassigned: number;     // ← Sarah (AI) resolutions
};

type InflowRow = {
  date: string;
  total: number;
  sarah: number;          // ← Sarah resolved (null assignee)
  mari: number;
  michael: number;
  gian: number;
  other: number;          // ← any other assignee (e.g. Manilyn)
};

function readResolutions(): ResolutionRow[] {
  const raw = readFileSync(RESOLUTIONS_FILE, "utf-8");
  const parsed = JSON.parse(raw);
  return parsed.rows.slice(-14);    // last 14 days only
}

function readInflow(): InflowRow[] {
  const raw = readFileSync(INFLOW_FILE, "utf-8");
  const parsed = JSON.parse(raw);
  return parsed.rows.slice(-14);    // last 14 days only
}
```

The server **never calls the Commslayer API**. It just reads local JSON files.
The Python warmer writes them every 3 hours.

---

## Step 6: Frontend renders the charts

File: `app/page.tsx`

### ResolutionChart (Daily resolutions)

Stacked bar chart. Each day = one bar with segments:
- 🔵 Mari (`#26b2dd`)
- 🟡 Michael (`#d3aa22`)
- 🔴 Gian (`#d96e5f`)
- 🟢 Sarah (AI) (`#22c55e`) — from the `unassigned` field

The `unassigned` field in `resolutions.json` is labeled "Sarah (AI)" in the
chart legend and tooltips.

Click any bar → breakdown panel shows per-agent count + percentage of that
day's total.

7-day rolling average line overlaid (dashed green).

### TicketFlowChart (End-to-end ticket flow)

Dual-bar chart per day:
- **Left bar** (purple `#8b5cf6`): Inflow — from `inflow.json`, `total` field
- **Right bar** (stacked): Resolutions — merged from `resolutions.json`
  - 🟢 Sarah resolved (green) — from `inflow.json` `sarah` field
  - 🔵 Mari, 🟡 Michael, 🔴 Gian — from `resolutions.json`

Summary stats: avg inflow/day, Sarah resolve rate %, human resolve avg/day.

Below the chart: collapsible `<details>` legend explaining the methodology.

---

## Why inflow ≠ resolutions on any single day

This confuses everyone. The two charts use **different date fields** from the
same conversations:

| Chart | Date field | Meaning |
|-------|-----------|---------|
| Inflow (left bar) | `created_at` | When the ticket **entered** the queue |
| Resolutions (right bar) | `updated_at` | When the ticket was **resolved** |

A ticket created Monday may be resolved Wednesday. It appears in Monday's
inflow bar but Wednesday's resolution bar. On any single day, inflow and
resolution counts won't match. Over 7-day windows they roughly balance.

---

## Common pitfalls

### 1. "The API returns 500 on deep pagination"

The Commslayer API has ~3100+ resolved conversations. Paginating beyond ~16
pages (1600 records) triggers HTTP 500. **Solution:** Use a date cutoff.
Paginate newest-first, stop when `updated_at[:10] < cutoff_date`.

### 2. "The API doesn't have a resolved_at field"

Correct. Use `updated_at` as the resolution date proxy. It's set to the
timestamp of the last status change, which for resolved conversations is
when they were marked resolved.

### 3. "Who is Sarah? She's not in the agents list"

Sarah is the Commslayer AI bot. She has **no `assignee_id`**. She's auto-assigned
to every conversation via activity messages. When she resolves a ticket, it
stays `assignee_id = null`. There is no `/agents` endpoint to look her up.

### 4. "The numbers don't match Commslayer's dashboard"

Commslayer's internal views are real-time. Our dashboard is a snapshot taken
every 3 hours. Ticket counts will differ based on timing. Also, our warmer
only fetches the last 14 days of resolved conversations.

### 5. "Rate limited (429)"

The API enforces ~1 request/second. Use 1050ms minimum between requests.
On 429, respect the `retry-after` header (usually 60s).

### 6. "Conversation objects are nested in attributes"

They're **not** — the objects are flat. `{ id, assignee_id, status, created_at, ... }`
are directly on the object. Some code defensively does
`rec.get("attributes", rec)` but this just falls through to `rec`.

---

## Quick reference: the full pipeline

```
Every 3 hours (launchd):
  Python warmer (warm-cache.py)
    ↓ GET /conversations?filter[status]=resolved (paginated, 14-day cutoff)
    ↓ Group by updated_at → resolutions.json
    ↓ Group by created_at → inflow.json
    ↓ (also fetches open conversations → dashboard.json)
    ↓
  Vinext server (route.ts)
    ↓ reads .cache/resolutions.json → last 14 rows → resolutions[]
    ↓ reads .cache/inflow.json → last 14 rows → inflow[]
    ↓ serves as JSON payload
    ↓
  React frontend (page.tsx)
    ↓ ResolutionChart: stacked bars (Mari/Michael/Gian/Sarah AI)
    ↓ TicketFlowChart: dual bars (purple inflow vs stacked resolution)
    ↓ Click bars for percentage breakdowns
```

**One API endpoint. Two groupings. Two cache files. Two charts.**
