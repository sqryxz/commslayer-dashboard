export const HISTORY_METRIC_KEYS = [
  "totalActive",
  "newTotal",
  "newUnder24",
  "newOver24",
  "backlogTotal",
  "backlogOver48",
];

export function weekStartFromDateKey(dateKey) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return date.toISOString().slice(0, 10);
}

function roundAverage(total, count) {
  return count === 0 ? 0 : Math.round((total / count) * 10) / 10;
}

export function aggregateWeeklySnapshots(rows, maxWeeks = 52) {
  const grouped = new Map();

  for (const row of rows) {
    const key = `${row.weekStart}:${row.assigneeId}`;
    const current = grouped.get(key) ?? {
      weekStart: row.weekStart,
      assigneeId: String(row.assigneeId),
      agentName: row.agentName,
      daysCaptured: 0,
      totals: Object.fromEntries(
        HISTORY_METRIC_KEYS.map((metric) => [metric, 0]),
      ),
    };

    current.daysCaptured += 1;
    current.agentName = row.agentName;
    for (const metric of HISTORY_METRIC_KEYS) {
      current.totals[metric] += Number(row[metric] ?? 0);
    }
    grouped.set(key, current);
  }

  const byWeek = new Map();
  for (const group of grouped.values()) {
    const agent = {
      assigneeId: group.assigneeId,
      agentName: group.agentName,
      daysCaptured: group.daysCaptured,
      metrics: Object.fromEntries(
        HISTORY_METRIC_KEYS.map((metric) => [
          metric,
          roundAverage(group.totals[metric], group.daysCaptured),
        ]),
      ),
    };
    const week = byWeek.get(group.weekStart) ?? {
      weekStart: group.weekStart,
      agents: [],
    };
    week.agents.push(agent);
    byWeek.set(group.weekStart, week);
  }

  return [...byWeek.values()]
    .sort((left, right) => left.weekStart.localeCompare(right.weekStart))
    .slice(-maxWeeks)
    .map((week) => ({
      ...week,
      agents: week.agents.sort((left, right) =>
        left.agentName.localeCompare(right.agentName),
      ),
    }));
}
