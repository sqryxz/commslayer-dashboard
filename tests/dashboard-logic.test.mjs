import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDashboard,
  classifyConversation,
  combineAgentDashboards,
} from "../app/lib/metrics.mjs";

const HOUR_MS = 60 * 60 * 1000;
const now = Date.parse("2026-07-28T06:00:00.000Z");

function hoursAgo(hours) {
  return new Date(now - hours * HOUR_MS).toISOString();
}

function conversation(id) {
  return {
    id,
    display_id: id,
    status: "open",
    subject: `Ticket ${id}`,
    created_at: hoursAgo(100),
    last_activity_at: hoursAgo(1),
  };
}

test("classifies an unanswered ticket under 24 hours as new", () => {
  const result = classifyConversation(
    conversation(1),
    [
      {
        message_type: "incoming",
        private: false,
        created_at: hoursAgo(12),
      },
    ],
    now,
  );

  assert.equal(result.bucket, "new-under-24");
  assert.equal(result.hasReply, false);
  assert.equal(result.hoursWaiting, 12);
});

test("classifies an unanswered ticket at the boundary as overdue", () => {
  const result = classifyConversation(
    conversation(2),
    [
      {
        message_type: "incoming",
        private: false,
        created_at: hoursAgo(24),
      },
    ],
    now,
  );

  assert.equal(result.bucket, "new-over-24");
});

test("private notes do not count as a first reply", () => {
  const result = classifyConversation(
    conversation(3),
    [
      {
        message_type: "incoming",
        private: false,
        created_at: hoursAgo(30),
      },
      {
        message_type: "outgoing",
        private: true,
        created_at: hoursAgo(28),
      },
    ],
    now,
  );

  assert.equal(result.bucket, "new-over-24");
  assert.equal(result.hasReply, false);
});

test("uses the latest unanswered incoming message for backlog age", () => {
  const result = classifyConversation(
    conversation(4),
    [
      {
        message_type: "incoming",
        sender_type: "Contact",
        private: false,
        created_at: hoursAgo(100),
      },
      {
        message_type: "outgoing",
        sender_type: "User",
        private: false,
        created_at: hoursAgo(95),
      },
      {
        message_type: "incoming",
        sender_type: "Contact",
        private: false,
        created_at: hoursAgo(60),
      },
      {
        message_type: "incoming",
        sender_type: "Contact",
        private: false,
        created_at: hoursAgo(52),
      },
    ],
    now,
  );

  assert.equal(result.bucket, "backlog-over-48");
  assert.equal(result.hoursWaiting, 52);
  assert.equal(result.firstResponseHours, 5);
});

test("keeps replied open tickets in backlog when no reply is due", () => {
  const result = classifyConversation(
    conversation(5),
    [
      {
        message_type: "incoming",
        sender_type: "Contact",
        private: false,
        created_at: hoursAgo(20),
      },
      {
        message_type: "outgoing",
        sender_type: "User",
        private: false,
        created_at: hoursAgo(18),
      },
    ],
    now,
  );

  assert.equal(result.bucket, "backlog");
  assert.equal(result.isWaiting, false);
  assert.equal(result.hoursWaiting, null);
});

test("reconciles new and backlog into total active", () => {
  const conversations = [conversation(1), conversation(2), conversation(3)];
  const messagesByConversation = new Map([
    [
      "1",
      [
        {
          message_type: "incoming",
          sender_type: "Contact",
          created_at: hoursAgo(10),
        },
      ],
    ],
    [
      "2",
      [
        {
          message_type: "incoming",
          sender_type: "Contact",
          created_at: hoursAgo(30),
        },
      ],
    ],
    [
      "3",
      [
        {
          message_type: "incoming",
          sender_type: "Contact",
          created_at: hoursAgo(80),
        },
        {
          message_type: "outgoing",
          sender_type: "User",
          private: false,
          created_at: hoursAgo(78),
        },
      ],
    ],
  ]);

  const result = buildDashboard(conversations, messagesByConversation, { now });

  assert.deepEqual(result.metrics, {
    newTotal: 2,
    newUnder24: 1,
    newOver24: 1,
    backlogTotal: 1,
    backlogOver48: 0,
    totalActive: 3,
    unclassified: 0,
  });
  assert.equal(result.reconciliation.passed, true);
});
test("combines independent agent scorecards and preserves agent identity", () => {
  const first = buildDashboard(
    [conversation(10)],
    new Map([
      [
        "10",
        [{ message_type: "incoming", created_at: hoursAgo(10) }],
      ],
    ]),
    { now },
  );

  const second = buildDashboard(
    [conversation(11)],
    new Map([
      [
        "11",
        [
          { message_type: "incoming", sender_type: "Contact", created_at: hoursAgo(60) },
          { message_type: "outgoing", sender_type: "User", private: false, created_at: hoursAgo(55) },
          { message_type: "incoming", sender_type: "Contact", created_at: hoursAgo(12) },
        ],
      ],
    ]),
    { now },
  );

  const result = combineAgentDashboards([
    { ...first, agent: { name: "Mari", assigneeId: "10116" } },
    { ...second, agent: { name: "Michael", assigneeId: "10207" } },
  ]);

  assert.equal(result.agents.length, 2);
  assert.equal(result.tickets[0].agentName, "Mari");
  assert.equal(result.tickets[1].agentName, "Michael");
  assert.equal(result.metrics.totalActive, 2);
  assert.equal(result.reconciliation.passed, true);
});

// --- sender_type regression tests ---

test("incoming message only is classified as New", () => {
  const result = classifyConversation(
    conversation(20),
    [
      {
        message_type: "incoming",
        sender_type: "Contact",
        private: false,
        created_at: hoursAgo(5),
      },
    ],
    now,
  );
  assert.equal(result.bucket, "new-under-24");
  assert.equal(result.hasReply, false);
});

test("incoming message followed by public AI reply stays New", () => {
  const result = classifyConversation(
    conversation(21),
    [
      {
        message_type: "incoming",
        sender_type: "Contact",
        private: false,
        created_at: hoursAgo(30),
      },
      {
        message_type: "outgoing",
        sender_type: "AIAgent",
        private: false,
        created_at: hoursAgo(28),
      },
    ],
    now,
  );
  assert.equal(result.bucket, "new-over-24");
  assert.equal(result.hasReply, false);
  assert.equal(result.firstResponseHours, null);
});

test("incoming message followed by public human reply becomes Backlog", () => {
  const result = classifyConversation(
    conversation(22),
    [
      {
        message_type: "incoming",
        sender_type: "Contact",
        private: false,
        created_at: hoursAgo(20),
      },
      {
        message_type: "outgoing",
        sender_type: "User",
        private: false,
        created_at: hoursAgo(18),
      },
    ],
    now,
  );
  assert.equal(result.bucket, "backlog");
  assert.equal(result.hasReply, true);
  assert.equal(result.firstResponseHours, 2);
});

test("incoming message followed by private human note stays New", () => {
  const result = classifyConversation(
    conversation(23),
    [
      {
        message_type: "incoming",
        sender_type: "Contact",
        private: false,
        created_at: hoursAgo(30),
      },
      {
        message_type: "outgoing",
        sender_type: "User",
        private: true,
        created_at: hoursAgo(28),
      },
    ],
    now,
  );
  assert.equal(result.bucket, "new-over-24");
  assert.equal(result.hasReply, false);
});

test("AI reply followed by human reply uses the human reply as first response", () => {
  const result = classifyConversation(
    conversation(24),
    [
      {
        message_type: "incoming",
        sender_type: "Contact",
        private: false,
        created_at: hoursAgo(20),
      },
      {
        message_type: "outgoing",
        sender_type: "AIAgent",
        private: false,
        created_at: hoursAgo(18),
      },
      {
        message_type: "outgoing",
        sender_type: "User",
        private: false,
        created_at: hoursAgo(10),
      },
    ],
    now,
  );
  assert.equal(result.bucket, "backlog");
  assert.equal(result.hasReply, true);
  assert.equal(result.firstResponseHours, 10);
});

test("human reply from another CX agent counts as a human reply", () => {
  const result = classifyConversation(
    conversation(25),
    [
      {
        message_type: "incoming",
        sender_type: "Contact",
        private: false,
        created_at: hoursAgo(20),
      },
      {
        message_type: "outgoing",
        sender_type: "User",
        private: false,
        created_at: hoursAgo(15),
      },
    ],
    now,
  );
  assert.equal(result.bucket, "backlog");
  assert.equal(result.hasReply, true);
  assert.equal(result.firstResponseHours, 5);
});

test("outgoing message before the first incoming message does not count", () => {
  const result = classifyConversation(
    conversation(26),
    [
      {
        message_type: "outgoing",
        sender_type: "User",
        private: false,
        created_at: hoursAgo(50),
      },
      {
        message_type: "incoming",
        sender_type: "Contact",
        private: false,
        created_at: hoursAgo(20),
      },
    ],
    now,
  );
  assert.equal(result.bucket, "new-under-24");
  assert.equal(result.hasReply, false);
});

test("reconciliation still holds with sender_type filter", () => {
  const conversations = [conversation(30), conversation(31), conversation(32)];
  const messagesByConversation = new Map([
    [
      "30",
      [{ message_type: "incoming", sender_type: "Contact", created_at: hoursAgo(10) }],
    ],
    [
      "31",
      [
        { message_type: "incoming", sender_type: "Contact", created_at: hoursAgo(30) },
        { message_type: "outgoing", sender_type: "AIAgent", created_at: hoursAgo(28) },
      ],
    ],
    [
      "32",
      [
        { message_type: "incoming", sender_type: "Contact", created_at: hoursAgo(80) },
        { message_type: "outgoing", sender_type: "User", created_at: hoursAgo(78) },
      ],
    ],
  ]);

  const result = buildDashboard(conversations, messagesByConversation, { now });

  assert.equal(result.metrics.newTotal, 2);
  assert.equal(result.metrics.backlogTotal, 1);
  assert.equal(result.metrics.totalActive, 3);
  assert.equal(result.reconciliation.passed, true);
});
