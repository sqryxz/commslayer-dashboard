const DEFAULT_API_BASE =
  "https://app.commslayer.com/api/integration/v1";
const DEFAULT_CONCURRENCY = 6;
const DEFAULT_REQUEST_INTERVAL_MS = 1050;
const MAX_PAGES = 500;

const globalRateLimiter = globalThis;

function rateLimiter() {
  globalRateLimiter.__commslayerRequestLimiter ??= {
    nextRequestAt: 0,
    cooldownUntil: 0,
  };
  return globalRateLimiter.__commslayerRequestLimiter;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function createHeaders(token) {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
  };
}

async function waitForRequestSlot() {
  const limiter = rateLimiter();
  const interval = Number(process.env.COMMSLAYER_REQUEST_INTERVAL_MS);
  const intervalMs = Number.isFinite(interval) && interval > 0
    ? interval
    : DEFAULT_REQUEST_INTERVAL_MS;
  const now = Date.now();
  const slot = Math.max(now, limiter.nextRequestAt, limiter.cooldownUntil);
  limiter.nextRequestAt = slot + intervalMs;
  if (slot > now) await sleep(slot - now);
}

async function requestJson(url, token) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await waitForRequestSlot();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);

    try {
      const response = await fetch(url, {
        headers: createHeaders(token),
        signal: controller.signal,
      });

      if (response.status === 429 && attempt < 3) {
        const retryAfter = Number(response.headers.get("retry-after"));
        const cooldownMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : 60_000;
        rateLimiter().cooldownUntil = Math.max(
          rateLimiter().cooldownUntil,
          Date.now() + cooldownMs,
        );
        continue;
      }

      if (!response.ok) {
        const body = await response.text();
        throw new Error(
          `Commslayer returned ${response.status}: ${body.slice(0, 300)}`,
        );
      }

      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error("Commslayer rate limit persisted after three retries.");
}

async function fetchPaginated(path, token, apiBase, initialParams = {}) {
  const records = [];
  let cursor = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(`${apiBase}${path}`);

    Object.entries(initialParams).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    });

    url.searchParams.set("page[limit]", "100");
    if (cursor) url.searchParams.set("page[after]", cursor);

    const payload = await requestJson(url, token);
    records.push(...(Array.isArray(payload.data) ? payload.data : []));

    cursor = payload.meta?.next_cursor ?? null;
    if (!cursor) return records;
  }

  throw new Error(
    `Pagination exceeded ${MAX_PAGES} pages for ${path}. Check the API cursor.`,
  );
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.min(Math.max(1, limit), items.length || 1);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

export async function fetchAgentQueue(config) {
  const apiBase = (config.apiBase || DEFAULT_API_BASE).replace(/\/$/, "");
  const conversations = await fetchPaginated(
    "/conversations",
    config.token,
    apiBase,
    {
      "filter[assignee_id]": config.assigneeId,
      "filter[status]": "open",
    },
  );

  const messageLists = await mapWithConcurrency(
    conversations,
    config.concurrency || DEFAULT_CONCURRENCY,
    (conversation) =>
      fetchPaginated(
        `/conversations/${encodeURIComponent(conversation.id)}/messages`,
        config.token,
        apiBase,
      ),
  );

  const messagesByConversation = new Map(
    conversations.map((conversation, index) => [
      String(conversation.id),
      messageLists[index],
    ]),
  );

  return { conversations, messagesByConversation };
}

// Backward-compatible export for callers that still use the original single-agent name.
export const fetchMariQueue = fetchAgentQueue;
