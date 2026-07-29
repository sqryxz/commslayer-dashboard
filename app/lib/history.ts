import { asc, lt } from "drizzle-orm";
import { getDb } from "@/db";
import { metricSnapshots } from "@/db/schema";
import {
  aggregateWeeklySnapshots,
  weekStartFromDateKey,
} from "@/app/lib/history-math.mjs";

const RETENTION_DAYS = 400;
const SYDNEY_TIME_ZONE = "Australia/Sydney";

type AgentSnapshotInput = {
  agent: {
    name: string;
    assigneeId: string;
  };
  metrics: {
    newTotal: number;
    newUnder24: number;
    newOver24: number;
    backlogTotal: number;
    backlogOver48: number;
    totalActive: number;
    unclassified: number;
  };
};

function dateKeyInSydney(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SYDNEY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value ?? "";

  return `${part("year")}-${part("month")}-${part("day")}`;
}

export async function persistDashboardSnapshot(
  agents: AgentSnapshotInput[],
  capturedAt: string,
) {
  const db = await getDb();
  const capturedDate = new Date(capturedAt);
  const snapshotDate = dateKeyInSydney(capturedDate);
  const weekStart = weekStartFromDateKey(snapshotDate);

  for (const dashboard of agents) {
    const values = {
      snapshotDate,
      weekStart,
      capturedAt,
      source: "live",
      agentName: dashboard.agent.name,
      assigneeId: String(dashboard.agent.assigneeId),
      newTotal: dashboard.metrics.newTotal,
      newUnder24: dashboard.metrics.newUnder24,
      newOver24: dashboard.metrics.newOver24,
      backlogTotal: dashboard.metrics.backlogTotal,
      backlogOver48: dashboard.metrics.backlogOver48,
      totalActive: dashboard.metrics.totalActive,
      unclassified: dashboard.metrics.unclassified,
    };

    await db
      .insert(metricSnapshots)
      .values(values)
      .onConflictDoUpdate({
        target: [
          metricSnapshots.snapshotDate,
          metricSnapshots.assigneeId,
        ],
        set: values,
      });
  }

  const retentionCutoff = new Date(
    capturedDate.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
  await db
    .delete(metricSnapshots)
    .where(lt(metricSnapshots.snapshotDate, dateKeyInSydney(retentionCutoff)));
}

export async function getHistorySummary() {
  const db = await getDb();
  const rows = await db
    .select()
    .from(metricSnapshots)
    .orderBy(
      asc(metricSnapshots.snapshotDate),
      asc(metricSnapshots.agentName),
    )
    .limit(1500);
  const dates = [...new Set(rows.map((row) => row.snapshotDate))];

  return {
    status: "ready" as const,
    storage: "local-d1" as const,
    retentionDays: RETENTION_DAYS,
    snapshotDays: dates.length,
    firstSnapshotDate: dates[0] ?? null,
    lastSnapshotDate: dates.at(-1) ?? null,
    weekly: aggregateWeeklySnapshots(rows),
  };
}
