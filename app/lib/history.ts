import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";
import {
  aggregateWeeklySnapshots,
  weekStartFromDateKey,
} from "@/app/lib/history-math.mjs";

const RETENTION_DAYS = 400;
const SYDNEY_TIME_ZONE = "Australia/Sydney";
const HISTORY_FILE = join(process.cwd(), ".cache", "history.json");

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

type MetricSnapshotRow = {
  snapshotDate: string;
  weekStart: string;
  capturedAt: string;
  source: "live";
  agentName: string;
  assigneeId: string;
  newTotal: number;
  newUnder24: number;
  newOver24: number;
  backlogTotal: number;
  backlogOver48: number;
  totalActive: number;
  unclassified: number;
};

function readSnapshotRows(): MetricSnapshotRow[] {
  try {
    if (!existsSync(HISTORY_FILE)) return [];
    const parsed = JSON.parse(readFileSync(HISTORY_FILE, "utf-8"));
    return Array.isArray(parsed?.rows) ? parsed.rows : [];
  } catch {
    return [];
  }
}

function writeSnapshotRows(rows: MetricSnapshotRow[]) {
  mkdirSync(dirname(HISTORY_FILE), { recursive: true });
  const temporaryFile = `${HISTORY_FILE}.${process.pid}.tmp`;
  writeFileSync(
    temporaryFile,
    JSON.stringify({ version: 1, rows }, null, 2),
    "utf-8",
  );
  renameSync(temporaryFile, HISTORY_FILE);
}

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
  const capturedDate = new Date(capturedAt);
  const snapshotDate = dateKeyInSydney(capturedDate);
  const weekStart = weekStartFromDateKey(snapshotDate);
  const agentIds = new Set(
    agents.map((dashboard) => String(dashboard.agent.assigneeId)),
  );
  const retentionCutoff = new Date(
    capturedDate.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
  const retentionDate = dateKeyInSydney(retentionCutoff);

  const rows = readSnapshotRows().filter(
    (row) =>
      row.snapshotDate >= retentionDate &&
      !(
        row.snapshotDate === snapshotDate &&
        agentIds.has(String(row.assigneeId))
      ),
  );

  for (const dashboard of agents) {
    rows.push({
      snapshotDate,
      weekStart,
      capturedAt,
      source: "live" as const,
      agentName: dashboard.agent.name,
      assigneeId: String(dashboard.agent.assigneeId),
      newTotal: dashboard.metrics.newTotal,
      newUnder24: dashboard.metrics.newUnder24,
      newOver24: dashboard.metrics.newOver24,
      backlogTotal: dashboard.metrics.backlogTotal,
      backlogOver48: dashboard.metrics.backlogOver48,
      totalActive: dashboard.metrics.totalActive,
      unclassified: dashboard.metrics.unclassified,
    });
  }

  rows.sort(
    (left, right) =>
      left.snapshotDate.localeCompare(right.snapshotDate) ||
      left.agentName.localeCompare(right.agentName),
  );
  writeSnapshotRows(rows);
}

export async function getHistorySummary() {
  const rows = readSnapshotRows().slice(-1500);
  const dates = [...new Set(rows.map((row) => row.snapshotDate))];

  // Build daily snapshots for the chart (last 10 days)
  const recentDates = dates.slice(-10);
  const dailySnapshots = recentDates.map((date) => {
    const dayRows = rows.filter((row) => row.snapshotDate === date);
    return {
      snapshotDate: date,
      agents: dayRows.map((row) => ({
        agentName: row.agentName,
        assigneeId: row.assigneeId,
        newTotal: row.newTotal,
        newUnder24: row.newUnder24,
        newOver24: row.newOver24,
        backlogTotal: row.backlogTotal,
        backlogOver48: row.backlogOver48,
        totalActive: row.totalActive,
      })),
    };
  });

  return {
    status: "ready" as const,
    storage: "local-json" as const,
    retentionDays: RETENTION_DAYS,
    snapshotDays: dates.length,
    firstSnapshotDate: dates[0] ?? null,
    lastSnapshotDate: dates.at(-1) ?? null,
    weekly: aggregateWeeklySnapshots(rows),
    daily: dailySnapshots,
  };
}
