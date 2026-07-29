const HOUR_MS = 60 * 60 * 1000;

function toTime(value) {
  const time = Date.parse(value ?? "");
  return Number.isFinite(time) ? time : null;
}

function isIncoming(message) {
  return message?.message_type === "incoming" && toTime(message.created_at) !== null;
}

function isPublicOutgoing(message) {
  return (
    message?.message_type === "outgoing" &&
    message?.private !== true &&
    message?.sender_type === "User" &&
    toTime(message.created_at) !== null
  );
}

function sortByCreatedAt(messages) {
  return [...messages].sort(
    (left, right) => toTime(left.created_at) - toTime(right.created_at),
  );
}

function hoursBetween(startTime, endTime) {
  if (startTime === null) return null;
  return Math.max(0, (endTime - startTime) / HOUR_MS);
}

function roundHours(value) {
  return value === null ? null : Math.round(value * 10) / 10;
}

function riskRank(bucket) {
  return {
    "new-over-24": 0,
    "backlog-over-48": 1,
    "new-under-24": 2,
    backlog: 3,
    unclassified: 4,
  }[bucket] ?? 5;
}

export function classifyConversation(
  conversation,
  messages,
  now = Date.now(),
  thresholds = { firstReplyHours: 24, backlogHours: 48 },
) {
  const orderedMessages = sortByCreatedAt(messages);
  const incomingMessages = orderedMessages.filter(isIncoming);
  const firstIncomingTime =
    incomingMessages.length > 0 ? toTime(incomingMessages[0].created_at) : null;

  const publicReplies = orderedMessages.filter(
    (message) =>
      isPublicOutgoing(message) &&
      firstIncomingTime !== null &&
      toTime(message.created_at) >= firstIncomingTime,
  );

  const firstReplyTime =
    publicReplies.length > 0 ? toTime(publicReplies[0].created_at) : null;
  const lastReplyTime =
    publicReplies.length > 0
      ? toTime(publicReplies[publicReplies.length - 1].created_at)
      : null;
  const hasReply = firstReplyTime !== null;

  let currentWaitStartedAt = null;

  if (firstIncomingTime !== null && !hasReply) {
    currentWaitStartedAt = firstIncomingTime;
  } else if (lastReplyTime !== null) {
    const unansweredIncoming = incomingMessages.filter(
      (message) => toTime(message.created_at) > lastReplyTime,
    );

    if (unansweredIncoming.length > 0) {
      currentWaitStartedAt = toTime(
        unansweredIncoming[unansweredIncoming.length - 1].created_at,
      );
    }
  }

  const waitHours = hoursBetween(currentWaitStartedAt, now);
  const firstResponseHours =
    firstIncomingTime !== null && firstReplyTime !== null
      ? hoursBetween(firstIncomingTime, firstReplyTime)
      : null;

  let bucket = "unclassified";

  if (firstIncomingTime !== null && !hasReply) {
    bucket =
      waitHours !== null && waitHours >= thresholds.firstReplyHours
        ? "new-over-24"
        : "new-under-24";
  } else if (hasReply) {
    bucket =
      waitHours !== null && waitHours >= thresholds.backlogHours
        ? "backlog-over-48"
        : "backlog";
  }

  return {
    id: conversation.id,
    displayId: conversation.display_id ?? conversation.id,
    subject: conversation.subject || "No subject",
    status: conversation.status,
    inboxId: conversation.inbox_id ?? null,
    contactId: conversation.contact_id ?? null,
    labels: Array.isArray(conversation.labels) ? conversation.labels : [],
    createdAt: conversation.created_at ?? null,
    lastActivityAt: conversation.last_activity_at ?? null,
    firstIncomingAt:
      firstIncomingTime === null
        ? null
        : new Date(firstIncomingTime).toISOString(),
    firstReplyAt:
      firstReplyTime === null ? null : new Date(firstReplyTime).toISOString(),
    currentWaitStartedAt:
      currentWaitStartedAt === null
        ? null
        : new Date(currentWaitStartedAt).toISOString(),
    firstResponseHours: roundHours(firstResponseHours),
    hoursWaiting: roundHours(waitHours),
    hasReply,
    isWaiting: currentWaitStartedAt !== null,
    bucket,
  };
}

export function buildDashboard(
  conversations,
  messagesByConversation,
  options = {},
) {
  const now = options.now ?? Date.now();
  const thresholds = {
    firstReplyHours: options.firstReplyHours ?? 24,
    backlogHours: options.backlogHours ?? 48,
  };

  const tickets = conversations
    .map((conversation) =>
      classifyConversation(
        conversation,
        messagesByConversation.get(String(conversation.id)) ?? [],
        now,
        thresholds,
      ),
    )
    .sort((left, right) => {
      const rankDifference = riskRank(left.bucket) - riskRank(right.bucket);
      if (rankDifference !== 0) return rankDifference;

      return (right.hoursWaiting ?? -1) - (left.hoursWaiting ?? -1);
    });

  const newTickets = tickets.filter(
    (ticket) =>
      ticket.bucket === "new-under-24" || ticket.bucket === "new-over-24",
  );
  const backlogTickets = tickets.filter(
    (ticket) =>
      ticket.bucket === "backlog" || ticket.bucket === "backlog-over-48",
  );
  const unclassified = tickets.filter(
    (ticket) => ticket.bucket === "unclassified",
  );

  const metrics = {
    newTotal: newTickets.length,
    newUnder24: newTickets.filter(
      (ticket) => ticket.bucket === "new-under-24",
    ).length,
    newOver24: newTickets.filter(
      (ticket) => ticket.bucket === "new-over-24",
    ).length,
    backlogTotal: backlogTickets.length,
    backlogOver48: backlogTickets.filter(
      (ticket) => ticket.bucket === "backlog-over-48",
    ).length,
    totalActive: newTickets.length + backlogTickets.length,
    unclassified: unclassified.length,
  };

  return {
    metrics,
    tickets,
    thresholds,
    reconciliation: {
      expected: metrics.totalActive,
      classified:
        metrics.newTotal + metrics.backlogTotal,
      passed:
        metrics.totalActive === metrics.newTotal + metrics.backlogTotal,
    },
  };
}

export function combineAgentDashboards(agentDashboards, options = {}) {
  const tickets = agentDashboards.flatMap((dashboard) =>
    dashboard.tickets.map((ticket) => ({
      ...ticket,
      agentName: dashboard.agent.name,
      assigneeId: dashboard.agent.assigneeId,
    })),
  );

  const metricKeys = [
    "newTotal",
    "newUnder24",
    "newOver24",
    "backlogTotal",
    "backlogOver48",
    "totalActive",
    "unclassified",
  ];
  const metrics = Object.fromEntries(
    metricKeys.map((key) => [
      key,
      agentDashboards.reduce(
        (total, dashboard) => total + dashboard.metrics[key],
        0,
      ),
    ]),
  );

  return {
    metrics,
    agents: agentDashboards,
    tickets,
    thresholds: options.thresholds ?? agentDashboards[0]?.thresholds,
    reconciliation: {
      expected: metrics.totalActive,
      classified: metrics.newTotal + metrics.backlogTotal,
      passed:
        metrics.totalActive === metrics.newTotal + metrics.backlogTotal &&
        agentDashboards.every((dashboard) => dashboard.reconciliation.passed),
    },
  };
}
