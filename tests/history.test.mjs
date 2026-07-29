import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateWeeklySnapshots,
  weekStartFromDateKey,
} from "../app/lib/history-math.mjs";

test("calculates Monday as the weekly snapshot boundary", () => {
  assert.equal(weekStartFromDateKey("2026-07-28"), "2026-07-27");
  assert.equal(weekStartFromDateKey("2026-08-02"), "2026-07-27");
  assert.equal(weekStartFromDateKey("2026-08-03"), "2026-08-03");
});

test("weekly queue metrics are daily averages rather than sums", () => {
  const result = aggregateWeeklySnapshots([
    {
      snapshotDate: "2026-07-27",
      weekStart: "2026-07-27",
      agentName: "Mari",
      assigneeId: "10116",
      totalActive: 10,
      newTotal: 4,
      newUnder24: 3,
      newOver24: 1,
      backlogTotal: 6,
      backlogOver48: 2,
    },
    {
      snapshotDate: "2026-07-28",
      weekStart: "2026-07-27",
      agentName: "Mari",
      assigneeId: "10116",
      totalActive: 14,
      newTotal: 6,
      newUnder24: 4,
      newOver24: 2,
      backlogTotal: 8,
      backlogOver48: 4,
    },
  ]);

  assert.equal(result.length, 1);
  assert.equal(result[0].agents[0].daysCaptured, 2);
  assert.equal(result[0].agents[0].metrics.totalActive, 12);
  assert.equal(result[0].agents[0].metrics.newTotal, 5);
  assert.equal(result[0].agents[0].metrics.backlogOver48, 3);
});
