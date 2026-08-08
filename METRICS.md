# Metric Calculation Reference

How each number on the Agent Queue Performance dashboard is calculated.

## Data source

All metrics are derived from the Commslayer Integration API (`v1`):

1. **Conversations**: `GET /conversations?filter[assignee_id]=ID&filter[status]=open` — paginated by cursor, 100 per page.
2. **Messages**: `GET /conversations/{id}/messages` — paginated by cursor, 100 per page. Fetched for every open conversation assigned to the agent.

The dashboard fetches data for each agent independently, then combines the results.

## Message classification

Every message in a conversation is classified into one of three types:

### Incoming (customer message)
```
message_type = "incoming"
AND created_at is a valid timestamp
```

### Public human reply
```
message_type = "outgoing"
AND private != true
AND sender_type = "User"
AND created_at is a valid timestamp
```

This is the key filter: **AI replies (`sender_type = "AIAgent"`) do NOT count as human replies.** Private notes do not count. A reply from any human CX agent counts, regardless of which agent is assigned to the conversation.

### Ignored
- `message_type = "activity"` (system events like auto-labeling, assignment changes)
- `sender_type = null` (system activity messages)
- `sender_type = "AIAgent"` (AI/bot auto-replies)
- Private notes (`private = true`)

## Conversation classification

Each open conversation assigned to an agent is classified into exactly one bucket. The classification depends on whether a **public human reply** exists after the first incoming customer message.

### Step 1: Find the first incoming message
```
firstIncomingTime = earliest incoming message's created_at
```

If no incoming message exists, the conversation is **unclassified** and excluded from both New and Backlog counts.

### Step 2: Find public human replies (after first incoming)
```
publicReplies = all public human replies where created_at >= firstIncomingTime
```

Messages before the first incoming message are ignored — a reply sent before the customer's first message doesn't count.

### Step 3: Determine if the conversation has a reply
```
hasReply = publicReplies.length > 0
```

### Step 4: Calculate waiting time

**If no reply exists (New ticket):**
```
currentWaitStartedAt = firstIncomingTime
waitHours = (now - firstIncomingTime) / 3600000
```
The waiting clock starts at the **first** incoming message.

**If a reply exists (Backlog ticket):**
```
lastReplyTime = last public human reply's created_at
unansweredIncoming = all incoming messages after lastReplyTime
```
- If there are unanswered incoming messages after the last reply:
  ```
  currentWaitStartedAt = latest unanswered incoming message's created_at
  waitHours = (now - currentWaitStartedAt) / 3600000
  ```
- If there are no unanswered incoming messages:
  ```
  currentWaitStartedAt = null
  waitHours = null (not waiting)
  ```

### Step 5: Assign bucket

| Condition | Bucket |
|---|---|
| Has incoming, no human reply, waiting < 24h | `new-under-24` |
| Has incoming, no human reply, waiting ≥ 24h | `new-over-24` |
| Has human reply, not waiting or waiting < 48h | `backlog` |
| Has human reply, waiting ≥ 48h | `backlog-over-48` |
| No incoming message | `unclassified` |

Thresholds (configurable via env):
- `COMMSLAYER_FIRST_REPLY_THRESHOLD_HOURS` (default: 24)
- `COMMSLAYER_BACKLOG_THRESHOLD_HOURS` (default: 48)

## Dashboard metrics

Each agent scorecard shows six numbers:

### 🌱 NEW (`newTotal`)
```
Count of conversations where:
  status = open
  AND at least one incoming customer message exists
  AND no public human reply exists (sender_type = "User")
```
AI replies do NOT move a ticket out of New. A ticket with only an AI reply stays in New.

### 📌 <24H (`newUnder24`)
```
Count of NEW conversations where:
  waitHours < 24
```
Waiting time = now − first incoming message timestamp.

### 🐸 >24H (`newOver24`)
```
Count of NEW conversations where:
  waitHours ≥ 24
```
These are tickets that have been waiting for a first human reply for 24+ hours.

### ⚠️ BACKLOG (`backlogTotal`)
```
Count of conversations where:
  status = open
  AND at least one public human reply exists (sender_type = "User")
```
Once a human has replied, the ticket is in backlog. Even if the customer replies again, it stays in backlog (not New).

### 🎯 >48H (`backlogOver48`)
```
Count of BACKLOG conversations where:
  The customer has sent a new message after the last human reply
  AND that message has been waiting ≥ 48 hours for a response
```
Waiting time = now − latest incoming message after the last human reply.

If no unanswered incoming message exists after the last reply, the ticket is in backlog but NOT overdue (>48H = 0).

### ⚠️ OPEN (`totalActive`)
```
totalActive = newTotal + backlogTotal
```
Every open conversation with at least one incoming message is either New or Backlog. Open conversations with no incoming message are "unclassified" and excluded from this count.

## Reconciliation
```
totalActive = newTotal + backlogTotal
```
This must always hold. If it doesn't, there's a classification bug. The dashboard shows ✓ Reconciled or ! Review classification per agent.

Unclassified conversations (open, no incoming message) are shown separately and do NOT break reconciliation.

## Why numbers may differ from Commslayer's internal views

### "First reply" — same definition

Commslayer's "First reply = No reply" filter does NOT count AI auto-replies.
This matches our `sender_type = "User"` filter. Both systems treat AI-replied
tickets with no human reply as "New".

### "Backlog" — broader in our dashboard

Our dashboard: **Backlog = any open ticket with at least one human reply.**

Commslayer's "Backlogs" **view** adds extra staleness filters:
- Hours since first reply > 48
- Hours since last activity > 48

This means Commslayer's "Backlogs" view only shows stale/unattended replied
tickets, while our dashboard shows all replied tickets. The difference is
expected — our Backlog count will always be higher than Commslayer's
"Backlogs" view count.

### ">48H" — same concept, different label

Our `>48H` = Backlog ticket where the customer's latest message after the
last human reply has been waiting >48 hours.

Commslayer's `>48H` view = Has reply + waiting for reply >48h + last
activity >48h. The "last activity >48h" filter is additional.

### Data freshness

Our dashboard is a snapshot taken every 3 hours (00:00, 03:00, 06:00, 09:00,
12:00, 15:00, 18:00, 21:00 HKT). Commslayer's internal views are real-time.
Ticket counts will differ based on when each was viewed.

## Ticket flow metrics

### Inflow (`inflow.json`)

```
Count of conversations where:
  status = resolved
  AND created_at falls on that date
```

Every conversation enters the queue through Sarah (AI) first, so inflow
equals total daily ticket volume. Grouped by `created_at` date (UTC, first
10 characters of ISO timestamp).

Split by final assignee to show routing:
- `sarah` = final `assignee_id` is null (Sarah resolved it)
- `mari` / `michael` / `gian` = final `assignee_id` matches that agent
- `other` = any other `assignee_id` (e.g. Manilyn, 13345)

### Resolution (`resolutions.json`)

```
Count of conversations where:
  status = resolved
  AND updated_at falls on that date
```

The API has no `resolved_at` field. `updated_at` is the best proxy for
resolution date (it's set to the last status change). Grouped by `updated_at`
date.

Split by final assignee:
- `unassigned` (= Sarah AI resolved) — final `assignee_id` is null
- `mari` / `michael` / `gian` — matches that agent's ID

On the dashboard, `unassigned` is labeled **"Sarah (AI)"** in green.

### Why inflow ≠ resolutions on any single day

Inflow uses `created_at` (when the ticket entered the queue). Resolutions use
`updated_at` (when it was resolved). A ticket created Monday may be resolved
Wednesday — it appears in Monday's inflow but Wednesday's resolutions. Over
7-day windows they roughly balance (~130–200/day each).

### Sarah (AI) flow model

```
Every incoming conversation
    → Sarah auto-assigned ("Sarah was automatically assigned to this conversation")
    → Either:
        a) Sarah resolves it → assignee_id stays null → counted as "Sarah (AI)" resolution
        b) Sarah escalates → "Sarah was removed from the conversation: no matching guidance detected"
           → human agent takes over → conversation gets assignee_id → counted under that agent's resolutions
```

Sarah has no `assignee_id` in the API — she appears only in activity messages.
There is no `/agents` or `/users` endpoint to look her up.

## Historical snapshots

Daily snapshots are stored in the local D1/SQLite database with one row per agent per Sydney calendar day. Weekly values shown in the trend chart are **averages** of the available daily snapshots, not sums.

**Metric definition change (2026-07-28):** Snapshots before this date counted any public outgoing message (including AI) as a reply. Snapshots from this date forward count only `sender_type = "User"`. Historical data is not directly comparable.
