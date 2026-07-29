#!/usr/bin/env python3
"""
Commslayer Dashboard cache warmer.

Fetches live data directly from the Commslayer API (bypassing the Vinext
server) and writes it to a JSON snapshot file that the server reads as
its cache.  This avoids the Vinext Worker request-timeout limit that kills
long-running synchronous HTTP handlers.

Runs every 6 hours via launchd (00:00, 06:00, 12:00, 18:00 HKT).
"""

import json
import os
import sys
import time
import urllib.request
import urllib.parse
from datetime import datetime, timezone

# --- Configuration ---

PROJECT_DIR = "/Users/atlas/Dropbox/DWA/DWA-Brain/Commslayer Dashboard"
ENV_PATH = os.path.join(PROJECT_DIR, ".env.local")
CACHE_PATH = os.path.join(PROJECT_DIR, ".cache", "dashboard.json")
LOG_PATH = os.path.expanduser("~/Library/Logs/commslayer-warmer.log")

DEFAULT_API_BASE = "https://app.commslayer.com/api/integration/v1"
DEFAULT_CONCURRENCY = 6
DEFAULT_REQUEST_INTERVAL_MS = 1050
DEFAULT_FIRST_REPLY_HOURS = 24
DEFAULT_BACKLOG_HOURS = 48
MAX_PAGES = 500


def log(message):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {message}"
    print(line, flush=True)
    try:
        with open(LOG_PATH, "a") as f:
            f.write(line + "\n")
    except Exception:
        pass


def load_env():
    env = {}
    with open(ENV_PATH) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, _, value = line.partition("=")
                env[key.strip()] = value.strip()
    return env


# --- Rate limiter (mirrors commslayer.mjs) ---

_rate_state = {"next_request_at": 0, "cooldown_until": 0}


def rate_limited_sleep(interval_ms):
    now = time.time()
    slot = max(now, _rate_state["next_request_at"], _rate_state["cooldown_until"])
    _rate_state["next_request_at"] = slot + interval_ms / 1000.0
    if slot > now:
        time.sleep(slot - now)


def api_request(url, token, max_retries=4):
    for attempt in range(max_retries):
        rate_limited_sleep(DEFAULT_REQUEST_INTERVAL_MS)
        req = urllib.request.Request(url, headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        })
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                return json.loads(resp.read())
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < max_retries - 1:
                retry_after = e.headers.get("retry-after")
                cooldown = int(retry_after) if retry_after and retry_after.isdigit() else 60
                _rate_state["cooldown_until"] = time.time() + cooldown
                log(f"  429 rate limited, cooling down {cooldown}s")
                continue
            raise
    raise RuntimeError("Commslayer rate limit persisted after retries")


def fetch_paginated(path, token, api_base, params=None):
    records = []
    cursor = None
    for _ in range(MAX_PAGES):
        url = f"{api_base}{path}"
        query = dict(params or {})
        query["page[limit]"] = "100"
        if cursor:
            query["page[after]"] = cursor
        url = f"{url}?{urllib.parse.urlencode(query)}"
        payload = api_request(url, token)
        records.extend(payload.get("data", []))
        cursor = payload.get("meta", {}).get("next_cursor")
        if not cursor:
            return records
    raise RuntimeError(f"Pagination exceeded {MAX_PAGES} pages for {path}")


def fetch_with_concurrency(items, limit, fn):
    """Simple sequential fetch with concurrency simulation.
    Since Python's urllib is blocking, we process sequentially but
    the rate limiter ensures we don't exceed the API limit."""
    results = []
    for i, item in enumerate(items):
        results.append(fn(item, i))
    return results


# --- Metrics (mirrors metrics.mjs) ---

HOUR_MS = 60 * 60 * 1000


def to_time(value):
    if not value:
        return None
    try:
        t = datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000
        return t if t == t else None  # NaN check
    except Exception:
        return None


def is_incoming(msg):
    return msg.get("message_type") == "incoming" and to_time(msg.get("created_at")) is not None


def is_public_outgoing(msg):
    return (
        msg.get("message_type") == "outgoing"
        and msg.get("private") is not True
        and msg.get("sender_type") == "User"
        and to_time(msg.get("created_at")) is not None
    )


def classify_conversation(conv, messages, now_ms, thresholds):
    ordered = sorted(messages, key=lambda m: to_time(m.get("created_at")) or 0)
    incoming = [m for m in ordered if is_incoming(m)]
    first_incoming = to_time(incoming[0].get("created_at")) if incoming else None

    public_replies = [
        m for m in ordered
        if is_public_outgoing(m)
        and first_incoming is not None
        and (to_time(m.get("created_at")) or 0) >= first_incoming
    ]

    first_reply = to_time(public_replies[0].get("created_at")) if public_replies else None
    last_reply = to_time(public_replies[-1].get("created_at")) if public_replies else None
    has_reply = first_reply is not None

    current_wait = None
    if first_incoming is not None and not has_reply:
        current_wait = first_incoming
    elif last_reply is not None:
        unanswered = [m for m in incoming if (to_time(m.get("created_at")) or 0) > last_reply]
        if unanswered:
            current_wait = to_time(unanswered[-1].get("created_at"))

    wait_hours = None
    if current_wait is not None:
        wait_hours = round(max(0, (now_ms - current_wait) / HOUR_MS), 1)

    first_response_hours = None
    if first_incoming is not None and first_reply is not None:
        first_response_hours = round(max(0, (first_reply - first_incoming) / HOUR_MS), 1)

    first_reply_h = thresholds.get("firstReplyHours", DEFAULT_FIRST_REPLY_HOURS)
    backlog_h = thresholds.get("backlogHours", DEFAULT_BACKLOG_HOURS)

    bucket = "unclassified"
    if first_incoming is not None and not has_reply:
        bucket = "new-over-24" if (wait_hours is not None and wait_hours >= first_reply_h) else "new-under-24"
    elif has_reply:
        bucket = "backlog-over-48" if (wait_hours is not None and wait_hours >= backlog_h) else "backlog"

    return {
        "id": conv.get("id"),
        "displayId": conv.get("display_id", conv.get("id")),
        "subject": conv.get("subject") or "No subject",
        "status": conv.get("status"),
        "inboxId": conv.get("inbox_id"),
        "contactId": conv.get("contact_id"),
        "labels": conv.get("labels", []),
        "createdAt": conv.get("created_at"),
        "lastActivityAt": conv.get("last_activity_at"),
        "firstIncomingAt": datetime.fromtimestamp(first_incoming / 1000, tz=timezone.utc).isoformat() if first_incoming else None,
        "firstReplyAt": datetime.fromtimestamp(first_reply / 1000, tz=timezone.utc).isoformat() if first_reply else None,
        "currentWaitStartedAt": datetime.fromtimestamp(current_wait / 1000, tz=timezone.utc).isoformat() if current_wait else None,
        "firstResponseHours": first_response_hours,
        "hoursWaiting": wait_hours,
        "hasReply": has_reply,
        "isWaiting": current_wait is not None,
        "bucket": bucket,
    }


def build_dashboard(conversations, messages_map, now_ms, thresholds):
    tickets = []
    for conv in conversations:
        msgs = messages_map.get(str(conv.get("id")), [])
        ticket = classify_conversation(conv, msgs, now_ms, thresholds)
        tickets.append(ticket)

    tickets.sort(key=lambda t: (
        {"new-over-24": 0, "backlog-over-48": 1, "new-under-24": 2, "backlog": 3, "unclassified": 4}.get(t["bucket"], 5),
        -(t["hoursWaiting"] or -1),
    ))

    new_tickets = [t for t in tickets if t["bucket"] in ("new-under-24", "new-over-24")]
    backlog_tickets = [t for t in tickets if t["bucket"] in ("backlog", "backlog-over-48")]
    unclassified = [t for t in tickets if t["bucket"] == "unclassified"]

    metrics = {
        "newTotal": len(new_tickets),
        "newUnder24": len([t for t in new_tickets if t["bucket"] == "new-under-24"]),
        "newOver24": len([t for t in new_tickets if t["bucket"] == "new-over-24"]),
        "backlogTotal": len(backlog_tickets),
        "backlogOver48": len([t for t in backlog_tickets if t["bucket"] == "backlog-over-48"]),
        "totalActive": len(new_tickets) + len(backlog_tickets),
        "unclassified": len(unclassified),
    }

    return {
        "metrics": metrics,
        "tickets": tickets,
        "thresholds": thresholds,
        "reconciliation": {
            "expected": metrics["totalActive"],
            "classified": metrics["newTotal"] + metrics["backlogTotal"],
            "passed": metrics["totalActive"] == metrics["newTotal"] + metrics["backlogTotal"],
        },
    }


def main():
    log("Starting direct cache refresh...")

    env = load_env()
    token = env.get("COMMSLAYER_API_TOKEN", "").strip()
    api_base = env.get("COMMSLAYER_API_BASE_URL", DEFAULT_API_BASE).rstrip("/")
    first_reply_h = int(env.get("COMMSLAYER_FIRST_REPLY_THRESHOLD_HOURS", DEFAULT_FIRST_REPLY_HOURS))
    backlog_h = int(env.get("COMMSLAYER_BACKLOG_THRESHOLD_HOURS", DEFAULT_BACKLOG_HOURS))

    ids = [s.strip() for s in env.get("COMMSLAYER_ASSIGNEE_IDS", "").split(",") if s.strip()]
    names = [s.strip() for s in env.get("COMMSLAYER_AGENT_NAMES", "Mari,Michael,Gian").split(",")]

    if not token or not ids:
        log("ERROR: Missing token or assignee IDs")
        sys.exit(1)

    thresholds = {"firstReplyHours": first_reply_h, "backlogHours": backlog_h}
    now_ms = int(time.time() * 1000)
    agent_dashboards = []

    for i, assignee_id in enumerate(ids):
        name = names[i] if i < len(names) else f"Agent {i+1}"
        log(f"  Fetching conversations for {name} ({assignee_id})...")

        conversations = fetch_paginated(
            "/conversations", token, api_base,
            {"filter[assignee_id]": assignee_id, "filter[status]": "open"},
        )
        log(f"    {len(conversations)} conversations")

        messages_map = {}
        for j, conv in enumerate(conversations):
            if (j + 1) % 50 == 0:
                log(f"    Messages: {j+1}/{len(conversations)}...")
            msgs = fetch_paginated(
                f"/conversations/{conv['id']}/messages", token, api_base,
            )
            messages_map[str(conv["id"])] = msgs

        dashboard = build_dashboard(conversations, messages_map, now_ms, thresholds)
        agent_dashboards.append({
            **dashboard,
            "agent": {"name": name, "assigneeId": assignee_id},
        })
        log(f"    {name}: {dashboard['metrics']['totalActive']} active, {dashboard['metrics']['newTotal']} new, {dashboard['metrics']['backlogTotal']} backlog")

    # Combine
    all_tickets = []
    combined_metrics = {k: 0 for k in ["newTotal", "newUnder24", "newOver24", "backlogTotal", "backlogOver48", "totalActive", "unclassified"]}
    for ad in agent_dashboards:
        for t in ad["tickets"]:
            all_tickets.append({**t, "agentName": ad["agent"]["name"], "assigneeId": ad["agent"]["assigneeId"]})
        for k in combined_metrics:
            combined_metrics[k] += ad["metrics"][k]

    payload = {
        "metrics": combined_metrics,
        "agents": agent_dashboards,
        "tickets": all_tickets,
        "thresholds": thresholds,
        "reconciliation": {
            "expected": combined_metrics["totalActive"],
            "classified": combined_metrics["newTotal"] + combined_metrics["backlogTotal"],
            "passed": combined_metrics["totalActive"] == combined_metrics["newTotal"] + combined_metrics["backlogTotal"]
                      and all(ad["reconciliation"]["passed"] for ad in agent_dashboards),
        },
        "source": "live",
        "refreshedAt": datetime.fromtimestamp(now_ms / 1000, tz=timezone.utc).isoformat(),
        "notice": None,
        "history": {"status": "unavailable", "storage": "local-d1", "retentionDays": 400, "snapshotDays": 0, "firstSnapshotDate": None, "lastSnapshotDate": None, "weekly": []},
    }

    # Write cache file
    os.makedirs(os.path.dirname(CACHE_PATH), exist_ok=True)
    with open(CACHE_PATH, "w") as f:
        json.dump(payload, f)

    log(f"Cache written to {CACHE_PATH}")
    log(f"Total: {combined_metrics['totalActive']} active, {combined_metrics['newTotal']} new, {combined_metrics['backlogTotal']} backlog")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log(f"FAILED: {e}")
        sys.exit(1)
