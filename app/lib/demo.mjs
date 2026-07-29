import { combineAgentDashboards, buildDashboard } from "./metrics.mjs";

function hoursAgo(now, hours) {
  return new Date(now - hours * 60 * 60 * 1000).toISOString();
}

function makeAgentDashboard(now, agent, conversations) {
  const messagesByConversation = new Map(
    conversations.map(({ id, messages }) => [String(id), messages]),
  );
  const conversationsWithoutMessages = conversations.map((conversation) => {
    const { messages, ...conversationWithoutMessages } = conversation;
    void messages;
    return conversationWithoutMessages;
  });

  return {
    ...buildDashboard(conversationsWithoutMessages, messagesByConversation, {
      now,
    }),
    agent,
  };
}

export function createDemoDashboard(now = Date.now()) {
  const agentDashboards = [
    makeAgentDashboard(
      now,
      { name: "Mari", assigneeId: "10116" },
      [
        {
          id: 14031,
          display_id: 14031,
          status: "open",
          subject: "Order AU304969 delivery update",
          labels: ["shipping"],
          created_at: hoursAgo(now, 31),
          last_activity_at: hoursAgo(now, 31),
          messages: [
            { message_type: "incoming", created_at: hoursAgo(now, 31) },
          ],
        },
        {
          id: 14025,
          display_id: 14025,
          status: "open",
          subject: "Compression socks sizing question",
          labels: ["product question"],
          created_at: hoursAgo(now, 7.5),
          last_activity_at: hoursAgo(now, 7.5),
          messages: [
            { message_type: "incoming", created_at: hoursAgo(now, 7.5) },
          ],
        },
        {
          id: 14018,
          display_id: 14018,
          status: "open",
          subject: "Change delivery address",
          labels: ["order change"],
          created_at: hoursAgo(now, 20),
          last_activity_at: hoursAgo(now, 20),
          messages: [
            { message_type: "incoming", created_at: hoursAgo(now, 20) },
          ],
        },
        {
          id: 13992,
          display_id: 13992,
          status: "open",
          subject: "Return request for scrub top",
          labels: ["returns"],
          created_at: hoursAgo(now, 96),
          last_activity_at: hoursAgo(now, 54),
          messages: [
            { message_type: "incoming", created_at: hoursAgo(now, 96) },
            { message_type: "outgoing", created_at: hoursAgo(now, 91) },
            { message_type: "incoming", created_at: hoursAgo(now, 54) },
          ],
        },
        {
          id: 13985,
          display_id: 13985,
          status: "open",
          subject: "Invoice required for clinic order",
          labels: ["invoice"],
          created_at: hoursAgo(now, 74),
          last_activity_at: hoursAgo(now, 13),
          messages: [
            { message_type: "incoming", created_at: hoursAgo(now, 74) },
            { message_type: "outgoing", created_at: hoursAgo(now, 69) },
            { message_type: "incoming", created_at: hoursAgo(now, 13) },
          ],
        },
        {
          id: 13972,
          display_id: 13972,
          status: "open",
          subject: "Embroidery name confirmation",
          labels: ["embroidery"],
          created_at: hoursAgo(now, 120),
          last_activity_at: hoursAgo(now, 4),
          messages: [
            { message_type: "incoming", created_at: hoursAgo(now, 120) },
            { message_type: "outgoing", created_at: hoursAgo(now, 116) },
            { message_type: "incoming", created_at: hoursAgo(now, 8) },
            { message_type: "outgoing", created_at: hoursAgo(now, 4) },
          ],
        },
      ],
    ),
    makeAgentDashboard(
      now,
      { name: "Michael", assigneeId: "10207" },
      [
        {
          id: 15001,
          display_id: 15001,
          status: "open",
          subject: "Order status check",
          labels: ["shipping"],
          created_at: hoursAgo(now, 6),
          last_activity_at: hoursAgo(now, 6),
          messages: [{ message_type: "incoming", created_at: hoursAgo(now, 6) }],
        },
        {
          id: 15002,
          display_id: 15002,
          status: "open",
          subject: "Return eligibility question",
          labels: ["returns"],
          created_at: hoursAgo(now, 36),
          last_activity_at: hoursAgo(now, 36),
          messages: [
            { message_type: "incoming", created_at: hoursAgo(now, 36) },
          ],
        },
        {
          id: 15003,
          display_id: 15003,
          status: "open",
          subject: "Clinic order amendment",
          labels: ["wholesale"],
          created_at: hoursAgo(now, 100),
          last_activity_at: hoursAgo(now, 60),
          messages: [
            { message_type: "incoming", created_at: hoursAgo(now, 100) },
            { message_type: "outgoing", created_at: hoursAgo(now, 95) },
            { message_type: "incoming", created_at: hoursAgo(now, 60) },
          ],
        },
        {
          id: 15004,
          display_id: 15004,
          status: "open",
          subject: "Invoice copy requested",
          labels: ["invoice"],
          created_at: hoursAgo(now, 30),
          last_activity_at: hoursAgo(now, 25),
          messages: [
            { message_type: "incoming", created_at: hoursAgo(now, 30) },
            { message_type: "outgoing", created_at: hoursAgo(now, 25) },
          ],
        },
      ],
    ),
    makeAgentDashboard(
      now,
      { name: "Gian", assigneeId: "8720" },
      [
        {
          id: 16001,
          display_id: 16001,
          status: "open",
          subject: "Compression socks product question",
          labels: ["product question"],
          created_at: hoursAgo(now, 10),
          last_activity_at: hoursAgo(now, 10),
          messages: [{ message_type: "incoming", created_at: hoursAgo(now, 10) }],
        },
        {
          id: 16002,
          display_id: 16002,
          status: "open",
          subject: "Delivery address update",
          labels: ["order change"],
          created_at: hoursAgo(now, 60),
          last_activity_at: hoursAgo(now, 12),
          messages: [
            { message_type: "incoming", created_at: hoursAgo(now, 60) },
            { message_type: "outgoing", created_at: hoursAgo(now, 55) },
            { message_type: "incoming", created_at: hoursAgo(now, 12) },
          ],
        },
        {
          id: 16003,
          display_id: 16003,
          status: "open",
          subject: "Embroidery confirmation",
          labels: ["embroidery"],
          created_at: hoursAgo(now, 80),
          last_activity_at: hoursAgo(now, 50),
          messages: [
            { message_type: "incoming", created_at: hoursAgo(now, 80) },
            { message_type: "outgoing", created_at: hoursAgo(now, 70) },
            { message_type: "incoming", created_at: hoursAgo(now, 50) },
          ],
        },
      ],
    ),
  ];

  return {
    ...combineAgentDashboards(agentDashboards),
    source: "demo",
    refreshedAt: new Date(now).toISOString(),
    notice:
      "Demo data is displayed because a Commslayer token and agent IDs have not been configured.",
  };
}
