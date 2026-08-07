"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Bucket =
  | "new-under-24"
  | "new-over-24"
  | "backlog"
  | "backlog-over-48"
  | "unclassified";

type Metrics = {
  newTotal: number;
  newUnder24: number;
  newOver24: number;
  backlogTotal: number;
  backlogOver48: number;
  totalActive: number;
  unclassified: number;
};

type Ticket = {
  id: number;
  displayId: number;
  subject: string;
  status: string;
  labels: string[];
  createdAt: string | null;
  lastActivityAt: string | null;
  firstReplyAt: string | null;
  firstResponseHours: number | null;
  hoursWaiting: number | null;
  hasReply: boolean;
  isWaiting: boolean;
  bucket: Bucket;
  agentName: string;
  assigneeId: string;
};

type AgentDashboard = {
  metrics: Metrics;
  tickets: Ticket[];
  agent: {
    name: string;
    assigneeId: string;
  };
  reconciliation: {
    expected: number;
    classified: number;
    passed: boolean;
  };
};

type TrendMetric =
  | "totalActive"
  | "newTotal"
  | "newOver24"
  | "backlogTotal"
  | "backlogOver48";

type WeeklyAgentTrend = {
  assigneeId: string;
  agentName: string;
  daysCaptured: number;
  metrics: Record<TrendMetric, number>;
};

type WeeklyTrend = {
  weekStart: string;
  agents: WeeklyAgentTrend[];
};

type DailyAgentSnapshot = {
  agentName: string;
  assigneeId: string;
  newTotal: number;
  newUnder24: number;
  newOver24: number;
  backlogTotal: number;
  backlogOver48: number;
  totalActive: number;
};

type DailySnapshot = {
  snapshotDate: string;
  agents: DailyAgentSnapshot[];
};

type HistorySummary = {
  status: "ready" | "unavailable";
  storage: "local-d1" | "local-json";
  detail?: string;
  retentionDays: number;
  snapshotDays: number;
  firstSnapshotDate: string | null;
  lastSnapshotDate: string | null;
  weekly: WeeklyTrend[];
  daily?: DailySnapshot[];
};

type DashboardPayload = {
  metrics: Metrics;
  agents: AgentDashboard[];
  tickets: Ticket[];
  thresholds: {
    firstReplyHours: number;
    backlogHours: number;
  };
  reconciliation: {
    expected: number;
    classified: number;
    passed: boolean;
  };
  source: "demo" | "live";
  refreshedAt: string;
  notice: string | null;
  history: HistorySummary;
  resolutions?: ResolutionRow[];
};

type ResolutionRow = {
  date: string;
  total: number;
  mari: number;
  michael: number;
  gian: number;
  unassigned: number;
};

type Filter = "coaching" | "first-reply" | "re-contact" | "all";

const numberFormatter = new Intl.NumberFormat("en-AU");
const dateFormatter = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});
const weekFormatter = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const trendOptions: Array<{ key: TrendMetric; label: string }> = [
  { key: "totalActive", label: "Open" },
  { key: "newTotal", label: "New" },
  { key: "newOver24", label: "New >24h" },
  { key: "backlogTotal", label: "Backlog" },
  { key: "backlogOver48", label: "Backlog >48h" },
];
const agentColors: Record<string, string> = {
  "10116": "#26b2dd",
  "10207": "#d3aa22",
  "8720": "#d96e5f",
};

const metricDefinitions = {
  newTotal:
    "Open conversations with no public human reply. AI replies and private notes do not count.",
  newUnder24:
    "New conversations waiting less than 24 hours for their first human reply.",
  newOver24:
    "New conversations waiting 24 hours or more for their first human reply.",
  backlogTotal:
    "Open conversations with at least one public human reply, regardless of subsequent customer messages.",
  backlogOver48:
    "Backlog conversations with a customer message after the last human reply, unanswered for 48 hours or more.",
  totalActive:
    "Open conversations with at least one customer message. Equals New + Backlog.",
} as const;
type MetricDefinitionKey = keyof typeof metricDefinitions;

const metricDefinitionLabels: Record<MetricDefinitionKey, string> = {
  newTotal: "NEW",
  newUnder24: "<24H",
  newOver24: ">24H",
  backlogTotal: "BACKLOG",
  backlogOver48: ">48H",
  totalActive: "OPEN",
};

function formatDate(value: string | null) {
  return value ? dateFormatter.format(new Date(value)) : "—";
}

function formatHours(value: number | null) {
  if (value === null) return "Not waiting";
  if (value < 1) return "<1h";
  return `${numberFormatter.format(value)}h`;
}

function ticketCount(value: number) {
  return `${numberFormatter.format(value)} ticket${value === 1 ? "" : "s"}`;
}

function bucketCopy(bucket: Bucket) {
  return {
    "new-under-24": { label: "New · within target", tone: "good" },
    "new-over-24": { label: "New · first reply overdue", tone: "danger" },
    backlog: { label: "Backlog · within target", tone: "neutral" },
    "backlog-over-48": { label: "Backlog · reply overdue", tone: "warning" },
    unclassified: { label: "Needs review", tone: "muted" },
  }[bucket];
}

function coachingCopy(ticket: Ticket) {
  return {
    "new-over-24": {
      focus: "First-response discipline",
      action:
        "Reply now. Review why this ticket passed 24 hours without a human response.",
      tone: "danger",
    },
    "backlog-over-48": {
      focus: "Follow-up discipline",
      action:
        "Reply now. Coach on prioritising customer re-contacts before 48 hours.",
      tone: "warning",
    },
    "new-under-24": {
      focus: "EOD prevention",
      action: "Clear before EOD so this does not become tomorrow’s breach.",
      tone: "good",
    },
    backlog: {
      focus: ticket.isWaiting ? "Backlog prevention" : "Quality review",
      action: ticket.isWaiting
        ? "Respond before 48 hours and confirm who owns the next response."
        : "No response is due; use this ticket only for quality coaching.",
      tone: ticket.isWaiting ? "neutral" : "muted",
    },
    unclassified: {
      focus: "Classification review",
      action: "Confirm the ticket has a valid customer message and clear ownership.",
      tone: "muted",
    },
  }[ticket.bucket];
}

function QueueRow({
  icon,
  label,
  value,
  metricKey,
  onActivate,
  onDeactivate,
  tone = "default",
}: {
  icon: string;
  label: string;
  value: number;
  metricKey: MetricDefinitionKey;
  onActivate: (metricKey: MetricDefinitionKey) => void;
  onDeactivate: () => void;
  tone?: "default" | "good" | "warning" | "danger";
}) {
  return (
    <li
      className={`queue-row queue-row-${tone}`}
      tabIndex={0}
      aria-describedby="metric-definition-popup"
      onMouseEnter={() => onActivate(metricKey)}
      onMouseLeave={onDeactivate}
      onFocus={() => onActivate(metricKey)}
      onBlur={onDeactivate}
    >
      <span className="queue-row-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="queue-row-label">{label}</span>
      <strong>{numberFormatter.format(value)}</strong>
    </li>
  );
}

function AgentScorecard({
  dashboard,
  onActivate,
  onDeactivate,
}: {
  dashboard: AgentDashboard;
  onActivate: (metricKey: MetricDefinitionKey) => void;
  onDeactivate: () => void;
}) {
  const { agent, metrics } = dashboard;

  return (
    <article className="agent-scorecard">
      <div className="scorecard-heading">
        <div className="agent-card agent-card-scorecard">
          <div className="agent-avatar" aria-hidden="true">
            {agent.name.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <strong>{agent.name}</strong>
            <span>Assignee ID {agent.assigneeId}</span>
          </div>
        </div>
        <span className="agent-column-id">ID {agent.assigneeId}</span>
      </div>

      <ul className="queue-list">
        <QueueRow
          icon="🌱"
          label="NEW"
          value={metrics.newTotal}
          metricKey="newTotal"
          onActivate={onActivate}
          onDeactivate={onDeactivate}
        />
        <QueueRow
          icon="📌"
          label="<24H"
          value={metrics.newUnder24}
          metricKey="newUnder24"
          onActivate={onActivate}
          onDeactivate={onDeactivate}
          tone="good"
        />
        <QueueRow
          icon="🐸"
          label=">24H"
          value={metrics.newOver24}
          metricKey="newOver24"
          onActivate={onActivate}
          onDeactivate={onDeactivate}
          tone="danger"
        />
        <QueueRow
          icon="⚠️"
          label="BACKLOG"
          value={metrics.backlogTotal}
          metricKey="backlogTotal"
          onActivate={onActivate}
          onDeactivate={onDeactivate}
          tone="warning"
        />
        <QueueRow
          icon="🌀"
          label=">48H"
          value={metrics.backlogOver48}
          metricKey="backlogOver48"
          onActivate={onActivate}
          onDeactivate={onDeactivate}
          tone="warning"
        />
        <QueueRow
          icon="⚠️"
          label="OPEN"
          value={metrics.totalActive}
          metricKey="totalActive"
          onActivate={onActivate}
          onDeactivate={onDeactivate}
          tone="default"
        />
      </ul>

      <div className="scorecard-footer">
        <span>
          {dashboard.reconciliation.passed ? "✓ Reconciled" : "! Review classification"}
        </span>
        <span>{metrics.unclassified} unclassified</span>
      </div>
    </article>
  );
}

function formatWeek(dateKey: string) {
  return `Week of ${weekFormatter.format(new Date(`${dateKey}T00:00:00.000Z`))}`;
}

function WeeklyTrendChart({
  weekly,
  metric,
}: {
  weekly: WeeklyTrend[];
  metric: TrendMetric;
}) {
  const weeks = weekly.slice(-12);
  const agents = Array.from(
    new Map(
      weeks
        .flatMap((week) => week.agents)
        .map((agent) => [agent.assigneeId, agent]),
    ).values(),
  );
  const width = 900;
  const height = 290;
  const padding = { top: 22, right: 28, bottom: 42, left: 48 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const values = weeks.flatMap((week) =>
    week.agents.map((agent) => agent.metrics[metric] ?? 0),
  );
  const maximum = Math.max(1, ...values);
  const x = (index: number) =>
    padding.left +
    (weeks.length === 1 ? plotWidth / 2 : (index / (weeks.length - 1)) * plotWidth);
  const y = (value: number) =>
    padding.top + plotHeight - (value / maximum) * plotHeight;

  return (
    <div className="trend-chart-wrap">
      <div className="trend-legend" aria-label="Agent legend">
        {agents.map((agent) => (
          <span key={agent.assigneeId}>
            <i
              style={{
                background:
                  agentColors[agent.assigneeId] || "var(--green)",
              }}
            />
            {agent.agentName}
          </span>
        ))}
      </div>
      <svg
        className="trend-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${trendOptions.find((option) => option.key === metric)?.label} weekly average by agent`}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const value = maximum * ratio;
          const gridY = y(value);
          return (
            <g key={ratio}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={gridY}
                y2={gridY}
                className="trend-grid-line"
              />
              <text
                x={padding.left - 10}
                y={gridY + 4}
                textAnchor="end"
                className="trend-axis-label"
              >
                {Math.round(value)}
              </text>
            </g>
          );
        })}

        {weeks.map((week, index) => (
          <text
            key={week.weekStart}
            x={x(index)}
            y={height - 14}
            textAnchor="middle"
            className="trend-axis-label"
          >
            {weekFormatter.format(
              new Date(`${week.weekStart}T00:00:00.000Z`),
            )}
          </text>
        ))}

        {agents.map((agent) => {
          const points = weeks.flatMap((week, index) => {
            const matchingAgent = week.agents.find(
              (item) => item.assigneeId === agent.assigneeId,
            );
            return matchingAgent
              ? [
                  {
                    x: x(index),
                    y: y(matchingAgent.metrics[metric] ?? 0),
                    value: matchingAgent.metrics[metric] ?? 0,
                    weekStart: week.weekStart,
                  },
                ]
              : [];
          });
          const color = agentColors[agent.assigneeId] || "#0f4e59";

          return (
            <g key={agent.assigneeId}>
              <polyline
                points={points.map((point) => `${point.x},${point.y}`).join(" ")}
                fill="none"
                stroke={color}
                strokeWidth="3"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {points.map((point) => (
                <circle
                  key={`${agent.assigneeId}-${point.weekStart}`}
                  cx={point.x}
                  cy={point.y}
                  r="4.5"
                  fill="var(--off-white)"
                  stroke={color}
                  strokeWidth="3"
                >
                  <title>
                    {agent.agentName}, {formatWeek(point.weekStart)}:{" "}
                    {point.value}
                  </title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

type ChartMetricKey =
  | "newTotal"
  | "newUnder24"
  | "newOver24"
  | "backlogTotal"
  | "backlogOver48"
  | "totalActive";

const chartMetricOptions: Array<{ key: ChartMetricKey; label: string }> = [
  { key: "newTotal", label: "New" },
  { key: "newUnder24", label: "<24H" },
  { key: "newOver24", label: ">24H" },
  { key: "backlogTotal", label: "Backlog" },
  { key: "backlogOver48", label: ">48H" },
  { key: "totalActive", label: "Open" },
];

function dailyMetricValue(agent: DailyAgentSnapshot, metric: ChartMetricKey): number {
  switch (metric) {
    case "newTotal": return agent.newTotal;
    case "newUnder24": return agent.newUnder24;
    case "newOver24": return agent.newOver24;
    case "backlogTotal": return agent.backlogTotal;
    case "backlogOver48": return agent.backlogOver48;
    case "totalActive": return agent.totalActive;
    default: return 0;
  }
}

function DailyHistoryChart({
  daily,
  metric,
}: {
  daily: DailySnapshot[];
  metric: ChartMetricKey;
}) {
  const days = daily.slice(-10);
  const agentOrder = ["10116", "10207", "8720"];
  const latestAgents = days.at(-1)?.agents ?? [];
  const agents = agentOrder.flatMap((id) => {
    const a = latestAgents.find((item) => item.assigneeId === id);
    return a ? [a] : [];
  });

  const width = 900;
  const height = 290;
  const padding = { top: 22, right: 28, bottom: 42, left: 48 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  // All values including totals
  const agentValues = days.flatMap((day) =>
    day.agents.map((a) => dailyMetricValue(a, metric)),
  );
  const totalValues = days.map(
    (day) => day.agents.reduce((sum, a) => sum + dailyMetricValue(a, metric), 0),
  );
  const maximum = Math.max(1, ...agentValues, ...totalValues);

  const x = (i: number) =>
    padding.left +
    (days.length === 1 ? plotWidth / 2 : (i / (days.length - 1)) * plotWidth);
  const y = (v: number) => padding.top + plotHeight - (v / maximum) * plotHeight;

  // Linear regression for total trendline
  const n = days.length;
  const totalRegression = (() => {
    if (n < 2) return null;
    const xs = days.map((_, i) => i);
    const sumX = xs.reduce((a, b) => a + b, 0);
    const sumY = totalValues.reduce((a, b) => a + b, 0);
    const sumXY = xs.reduce((acc, xi, i) => acc + xi * totalValues[i], 0);
    const sumX2 = xs.reduce((acc, xi) => acc + xi * xi, 0);
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    return { slope, intercept };
  })();

  const dayFormatter = new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
  });

  return (
    <div className="trend-chart-wrap">
      <div className="trend-legend" aria-label="Chart legend">
        {agents.map((agent) => (
          <span key={agent.assigneeId}>
            <i style={{ background: agentColors[agent.assigneeId] || "var(--green)" }} />
            {agent.agentName}
          </span>
        ))}
        <span>
          <i style={{ background: "var(--text-dim)", opacity: 0.6 }} />
          Total trend
        </span>
      </div>
      <svg
        className="trend-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${chartMetricOptions.find((o) => o.key === metric)?.label} daily by agent with total trendline`}
      >
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const value = maximum * ratio;
          const gridY = y(value);
          return (
            <g key={ratio}>
              <line x1={padding.left} x2={width - padding.right} y1={gridY} y2={gridY} className="trend-grid-line" />
              <text x={padding.left - 10} y={gridY + 4} textAnchor="end" className="trend-axis-label">
                {Math.round(value)}
              </text>
            </g>
          );
        })}

        {/* X axis labels */}
        {days.map((day, index) => (
          <text key={day.snapshotDate} x={x(index)} y={height - 14} textAnchor="middle" className="trend-axis-label">
            {dayFormatter.format(new Date(day.snapshotDate + "T00:00:00.000Z"))}
          </text>
        ))}

        {/* Total trendline */}
        {totalRegression && (
          <line
            x1={x(0)}
            y1={y(totalRegression.intercept)}
            x2={x(n - 1)}
            y2={y(totalRegression.intercept + totalRegression.slope * (n - 1))}
            stroke="var(--text-dim)"
            strokeWidth="2"
            strokeDasharray="6 4"
            opacity={0.5}
          />
        )}

        {/* Agent lines */}
        {agents.map((agent) => {
          const points = days.flatMap((day, index) => {
            const matching = day.agents.find((a) => a.assigneeId === agent.assigneeId);
            return matching
              ? [{ x: x(index), y: y(dailyMetricValue(matching, metric)), value: dailyMetricValue(matching, metric), date: day.snapshotDate }]
              : [];
          });
          const color = agentColors[agent.assigneeId] || "#0f4e59";
          return (
            <g key={agent.assigneeId}>
              <polyline
                points={points.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="none"
                stroke={color}
                strokeWidth="3"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {points.map((point) => (
                <circle
                  key={`${agent.assigneeId}-${point.date}`}
                  cx={point.x}
                  cy={point.y}
                  r="4.5"
                  fill="var(--off-white)"
                  stroke={color}
                  strokeWidth="3"
                >
                  <title>
                    {agent.agentName}, {dayFormatter.format(new Date(point.date + "T00:00:00.000Z"))}: {point.value}
                  </title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function DailyHistorySection({
  history,
  metric,
  onMetricChange,
}: {
  history: HistorySummary;
  metric: ChartMetricKey;
  onMetricChange: (metric: ChartMetricKey) => void;
}) {
  const daily = history.daily ?? [];
  const recentDays = daily.slice(-10);

  return (
    <section className="queue-health">
      <div className="section-heading">
        <div>
          <p className="eyebrow">10-day trend</p>
          <h2>Queue history</h2>
        </div>
        <div className="refresh-meta">
          <span>Last refreshed</span>
        </div>
      </div>

      <div className="trend-controls" aria-label="Daily chart metric">
        {chartMetricOptions.map((option) => (
          <button
            type="button"
            key={option.key}
            className={metric === option.key ? "active" : ""}
            onClick={() => onMetricChange(option.key)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {recentDays.length > 0 ? (
        <DailyHistoryChart daily={recentDays} metric={metric} />
      ) : (
        <div className="history-empty">
          No daily snapshots available yet. History builds with each live refresh.
        </div>
      )}
    </section>
  );
}

function ResolutionChart({ rows }: { rows: ResolutionRow[] }) {
  const days = rows.slice(-14);
  const width = 900;
  const height = 250;
  const padding = { top: 22, right: 28, bottom: 42, left: 48 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const agents = [
    { key: "mari" as const, name: "Mari", color: "#26b2dd" },
    { key: "michael" as const, name: "Michael", color: "#d3aa22" },
    { key: "gian" as const, name: "Gian", color: "#d96e5f" },
    { key: "unassigned" as const, name: "Unassigned", color: "#888888" },
  ];

  const maximum = Math.max(1, ...days.map((d) => d.total));
  const x = (i: number) =>
    padding.left +
    (days.length === 1 ? plotWidth / 2 : (i / (days.length - 1)) * plotWidth);
  const y = (v: number) => padding.top + plotHeight - (v / maximum) * plotHeight;

  // 7-day rolling average
  const rollingAvg = days.map((_, i) => {
    const start = Math.max(0, i - 6);
    const window = days.slice(start, i + 1);
    return Math.round(window.reduce((s, d) => s + d.total, 0) / window.length);
  });

  const dayFormatter = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short" });

  return (
    <div className="trend-chart-wrap">
      <div className="trend-legend" aria-label="Resolution chart legend">
        {agents.map((agent) => (
          <span key={agent.key}>
            <i style={{ background: agent.color }} />
            {agent.name}
          </span>
        ))}
        <span>
          <i style={{ background: "var(--primary)", opacity: 0.6 }} />
          7-day avg
        </span>
      </div>
      <svg className="trend-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Daily resolutions by agent with 7-day rolling average">
        {/* Grid */}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const value = maximum * ratio;
          const gridY = y(value);
          return (
            <g key={ratio}>
              <line x1={padding.left} x2={width - padding.right} y1={gridY} y2={gridY} className="trend-grid-line" />
              <text x={padding.left - 10} y={gridY + 4} textAnchor="end" className="trend-axis-label">{Math.round(value)}</text>
            </g>
          );
        })}

        {/* X labels */}
        {days.map((day, index) => (
          <text key={day.date} x={x(index)} y={height - 14} textAnchor="middle" className="trend-axis-label">
            {dayFormatter.format(new Date(day.date + "T00:00:00.000Z"))}
          </text>
        ))}

        {/* Stacked bars */}
        {days.map((day, index) => {
          let cumulative = 0;
          const barWidth = Math.max(8, plotWidth / days.length * 0.6);
          return (
            <g key={day.date}>
              {agents.map((agent) => {
                const value = day[agent.key];
                const barHeight = (value / maximum) * plotHeight;
                const barY = padding.top + plotHeight - barHeight - (cumulative / maximum) * plotHeight;
                cumulative += value;
                return value > 0 ? (
                  <rect
                    key={agent.key}
                    x={x(index) - barWidth / 2}
                    y={barY}
                    width={barWidth}
                    height={barHeight}
                    fill={agent.color}
                    rx={1}
                  >
                    <title>{agent.name}, {dayFormatter.format(new Date(day.date + "T00:00:00.000Z"))}: {value}</title>
                  </rect>
                ) : null;
              })}
            </g>
          );
        })}

        {/* 7-day rolling average line */}
        {rollingAvg.length > 1 && (
          <>
            <polyline
              points={rollingAvg.map((avg, i) => `${x(i)},${y(avg)}`).join(" ")}
              fill="none"
              stroke="var(--primary)"
              strokeWidth="2.5"
              strokeDasharray="5 3"
              opacity={0.7}
            />
            {rollingAvg.map((avg, i) => (
              <circle key={i} cx={x(i)} cy={y(avg)} r="3" fill="var(--primary)" opacity={0.7}>
                <title>7-day avg: {avg}/day</title>
              </circle>
            ))}
          </>
        )}
      </svg>

      {/* Summary stats */}
      {days.length >= 2 && (
        <div style={{ display: "flex", gap: 24, justifyContent: "center", marginTop: 12, flexWrap: "wrap" as const }}>
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
            Latest: <strong style={{ color: "var(--text)" }}>{days.at(-1)?.total}</strong> resolved
          </span>
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
            7-day avg: <strong style={{ color: "var(--primary)" }}>{rollingAvg.at(-1)}</strong>/day
          </span>
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
            Tracked agents: <strong style={{ color: "var(--text)" }}>{(days.at(-1)?.mari ?? 0) + (days.at(-1)?.michael ?? 0) + (days.at(-1)?.gian ?? 0)}</strong>
          </span>
        </div>
      )}
    </div>
  );
}

function WeeklyHistory({
  history,
  metric,
  onMetricChange,
}: {
  history: HistorySummary;
  metric: TrendMetric;
  onMetricChange: (metric: TrendMetric) => void;
}) {
  const weekly = history.weekly.slice(-12);
  const agentOrder = ["10116", "10207", "8720"];
  const latestAgents = weekly.at(-1)?.agents ?? [];
  const agents = agentOrder.flatMap((assigneeId) => {
    const agent = latestAgents.find((item) => item.assigneeId === assigneeId);
    return agent ? [agent] : [];
  });
  const enoughForTrend = weekly.length >= 8;

  return (
    <section className="history-section">
      <div className="section-heading history-heading">
        <div>
          <p className="eyebrow">Historical trends</p>
          <h2>Weekly queue averages</h2>
          <p className="history-subtitle">
            Point-in-time daily snapshots · Sydney calendar · stored locally
          </p>
        </div>
        <div className="history-coverage">
          <span>{history.snapshotDays} captured day(s)</span>
          <strong>
            {history.firstSnapshotDate
              ? `${history.firstSnapshotDate} — ${history.lastSnapshotDate}`
              : "Collection starts after the next live refresh"}
          </strong>
        </div>
      </div>

      <div className="trend-controls" aria-label="Weekly trend metric">
        {trendOptions.map((option) => (
          <button
            type="button"
            key={option.key}
            className={metric === option.key ? "active" : ""}
            onClick={() => onMetricChange(option.key)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {history.status === "unavailable" ? (
        <div className="history-empty">
          Historical storage is unavailable. {history.detail}
        </div>
      ) : weekly.length === 0 ? (
        <div className="history-empty">
          No live snapshot has been stored yet. Demo refreshes are never saved.
        </div>
      ) : enoughForTrend ? (
        <WeeklyTrendChart weekly={weekly} metric={metric} />
      ) : (
        <div className="history-empty">
          {weekly.length} weekly point{weekly.length === 1 ? "" : "s"} stored.
          The line chart will appear after 8 weekly points; exact weekly
          averages are shown below while history builds.
        </div>
      )}

      {weekly.length > 0 ? (
        <div className="history-table-wrap">
          <table className="history-table">
            <thead>
              <tr>
                <th scope="col">Week</th>
                {agents.map((agent) => (
                  <th scope="col" key={agent.assigneeId}>
                    {agent.agentName}
                  </th>
                ))}
                <th scope="col">Coverage</th>
              </tr>
            </thead>
            <tbody>
              {[...weekly].reverse().map((week) => (
                <tr key={week.weekStart}>
                  <td>{formatWeek(week.weekStart)}</td>
                  {agents.map((agent) => {
                    const value = week.agents.find(
                      (item) => item.assigneeId === agent.assigneeId,
                    );
                    return (
                      <td key={agent.assigneeId}>
                        {value
                          ? numberFormatter.format(value.metrics[metric])
                          : "—"}
                      </td>
                    );
                  })}
                  <td>
                    {Math.max(
                      0,
                      ...week.agents.map((agent) => agent.daysCaptured),
                    )}{" "}
                    day(s)
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

export default function Home() {
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [filter, setFilter] = useState<Filter>("coaching");
  const [agentFilter, setAgentFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeMetric, setActiveMetric] =
    useState<MetricDefinitionKey | null>(null);
  const [trendMetric, setTrendMetric] =
    useState<TrendMetric>("totalActive");
  const [chartMetric, setChartMetric] = useState<ChartMetricKey>("newTotal");

  const loadDashboard = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/dashboard${force ? "?refresh=1" : ""}`,
        { cache: "no-store" },
      );
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.detail || payload.error || "Load failed.");
      }

      setDashboard(payload);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to load the dashboard.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Fetch once on mount.  No polling — data is refreshed by the
    // external warmer at 00:00, 06:00, 12:00, 18:00 HKT.
    const timer = window.setTimeout(() => void loadDashboard(), 0);
    return () => window.clearTimeout(timer);
  }, [loadDashboard]);

  const filteredTickets = useMemo(() => {
    if (!dashboard) return [];
    const normalizedQuery = query.trim().toLowerCase();

    return dashboard.tickets.filter((ticket) => {
      const matchesFilter =
        filter === "all" ||
        (filter === "first-reply" && ticket.bucket === "new-over-24") ||
        (filter === "re-contact" && ticket.bucket === "backlog-over-48") ||
        (filter === "coaching" &&
          (ticket.bucket === "new-over-24" ||
            ticket.bucket === "backlog-over-48"));
      const matchesAgent =
        agentFilter === "all" || ticket.assigneeId === agentFilter;
      const matchesQuery =
        !normalizedQuery ||
        ticket.agentName.toLowerCase().includes(normalizedQuery) ||
        String(ticket.displayId).includes(normalizedQuery) ||
        ticket.subject.toLowerCase().includes(normalizedQuery) ||
        ticket.labels.some((label) =>
          label.toLowerCase().includes(normalizedQuery),
        );

      return matchesFilter && matchesAgent && matchesQuery;
    });
  }, [agentFilter, dashboard, filter, query]);

  const coachingCounts = {
    coaching:
      (dashboard?.metrics.newOver24 ?? 0) +
      (dashboard?.metrics.backlogOver48 ?? 0),
    "first-reply": dashboard?.metrics.newOver24 ?? 0,
    "re-contact": dashboard?.metrics.backlogOver48 ?? 0,
    all: dashboard?.tickets.length ?? 0,
  };

  const coachingFilterOptions: Array<{ key: Filter; label: string }> = [
    { key: "coaching", label: "Needs coaching" },
    { key: "first-reply", label: "First reply overdue" },
    { key: "re-contact", label: "Re-contact overdue" },
    { key: "all", label: "All tickets" },
  ];

  return (
    <main>
      <header className="app-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            DW
          </span>
          <div>
            <div className="brand-name">Dr. Woof</div>
            <div className="brand-subtitle">CX operations</div>
          </div>
        </div>

        <div className="header-actions">
          <div className="source-status" aria-live="polite">
            <span
              className={`status-dot ${dashboard?.source === "live" ? "status-dot-live" : ""}`}
            />
            {dashboard?.source === "live" ? "Live data" : "Demo mode"}
          </div>
          <button
            className="refresh-button"
            type="button"
            onClick={() => void loadDashboard(true)}
            disabled={loading}
          >
            <span aria-hidden="true">↻</span>
            <span className="refresh-label">
              {loading ? "Refreshing" : "Refresh"}
            </span>
          </button>
        </div>
      </header>

      <section className="dashboard-shell">
        <div className="dashboard-intro">
          <div>
            <p className="eyebrow">Three-agent support scorecard</p>
            <h1>Agent queue performance</h1>
            <p className="intro-copy">
              Current open conversations for Mari, Michael and Gian, split by
              first-reply and backlog waiting thresholds.
            </p>
          </div>

          <div className="overall-card">
            <span>Combined active queue</span>
            <strong>{numberFormatter.format(dashboard?.metrics.totalActive ?? 0)}</strong>
            <small>
              {dashboard?.reconciliation.passed ? "Reconciled" : "Review classification"}
            </small>
          </div>
        </div>

        {dashboard?.notice ? (
          <div className="notice" role="status">
            <strong>Setup required for live data.</strong>
            <span>{dashboard.notice}</span>
          </div>
        ) : null}

        {error ? (
          <div className="error-state" role="alert">
            <strong>Refresh failed.</strong>
            <span>{error}</span>
            <button type="button" onClick={() => void loadDashboard(true)}>
              Try again
            </button>
          </div>
        ) : null}

        <section className="agent-score-grid" aria-label="Agent metrics">
          {(dashboard?.agents ?? []).map((agentDashboard) => (
            <AgentScorecard
              key={agentDashboard.agent.assigneeId}
              dashboard={agentDashboard}
              onActivate={setActiveMetric}
              onDeactivate={() => setActiveMetric(null)}
            />
          ))}
        </section>

        {activeMetric ? (
          <aside
            id="metric-definition-popup"
            className="metric-definition-panel"
            role="status"
            aria-live="polite"
          >
            <strong>{metricDefinitionLabels[activeMetric]}</strong>
            <p>{metricDefinitions[activeMetric]}</p>
          </aside>
        ) : null}

        {dashboard?.history ? (
          <DailyHistorySection
            history={dashboard.history}
            metric={chartMetric}
            onMetricChange={setChartMetric}
          />
        ) : null}

        {dashboard?.resolutions && dashboard.resolutions.length > 0 ? (
          <section className="queue-health">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Clearance rate</p>
                <h2>Daily resolutions</h2>
              </div>
            </div>
            <ResolutionChart rows={dashboard.resolutions} />
          </section>
        ) : null}

        {dashboard?.history ? (
          <WeeklyHistory
            history={dashboard.history}
            metric={trendMetric}
            onMetricChange={setTrendMetric}
          />
        ) : null}

        <section className="ticket-section">
          <div className="section-heading ticket-heading">
            <div>
              <p className="eyebrow">Manager coaching queue</p>
              <h2>Coach the tickets that need intervention</h2>
              <p className="ticket-section-copy">
                Start with overdue first replies, then overdue customer
                re-contacts. Tickets are ordered by urgency and waiting time.
              </p>
            </div>
            <div className="ticket-count">
              {filteredTickets.length} ticket
              {filteredTickets.length === 1 ? "" : "s"}
              {agentFilter !== "all" ? (
                <button type="button" onClick={() => setAgentFilter("all")}>
                  Show all agents
                </button>
              ) : null}
            </div>
          </div>

          <div className="coach-agent-grid" aria-label="Filter coaching queue by agent">
            {(dashboard?.agents ?? []).map((agentDashboard) => {
              const { agent, metrics } = agentDashboard;
              const coachingTotal =
                metrics.newOver24 + metrics.backlogOver48;
              const isActive = agentFilter === agent.assigneeId;

              return (
                <button
                  key={agent.assigneeId}
                  type="button"
                  className={`coach-agent-card ${isActive ? "active" : ""}`}
                  aria-pressed={isActive}
                  onClick={() =>
                    setAgentFilter(isActive ? "all" : agent.assigneeId)
                  }
                >
                  <span className="coach-agent-card-heading">
                    <strong>{agent.name}</strong>
                    <small>{isActive ? "Showing agent" : "Filter agent"}</small>
                  </span>
                  <span className="coach-agent-total">
                    <strong>{coachingTotal}</strong>
                    <small>need coaching</small>
                  </span>
                  <span className="coach-agent-breakdown">
                    <span>{metrics.newOver24} first reply</span>
                    <span>{metrics.backlogOver48} re-contact</span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="table-controls">
            <div className="segmented-control" aria-label="Coaching focus">
              {coachingFilterOptions.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    className={filter === option.key ? "active" : ""}
                    onClick={() => setFilter(option.key)}
                  >
                    {option.label}
                    <span>{coachingCounts[option.key]}</span>
                  </button>
                ))}
            </div>

            <label className="search-field">
              <span className="sr-only">Search tickets</span>
              <span aria-hidden="true">⌕</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search agent, ticket, subject or label"
              />
            </label>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Agent</th>
                  <th scope="col">Ticket</th>
                  <th scope="col">Coaching focus</th>
                  <th scope="col">Queue state</th>
                  <th scope="col">Customer wait</th>
                  <th scope="col">Last activity</th>
                </tr>
              </thead>
              <tbody>
                {filteredTickets.map((ticket) => {
                  const bucket = bucketCopy(ticket.bucket);
                  const coaching = coachingCopy(ticket);
                  return (
                    <tr
                      className={`coaching-row coaching-row-${coaching.tone}`}
                      key={`${ticket.assigneeId}-${ticket.id}`}
                    >
                      <td>
                        <strong className="table-agent-name">{ticket.agentName}</strong>
                        <span className="cell-note">ID {ticket.assigneeId}</span>
                      </td>
                      <td>
                        <div className="ticket-primary">
                          <strong>#{ticket.displayId}</strong>
                          <span>{ticket.subject}</span>
                        </div>
                        {ticket.labels.length ? (
                          <div className="label-list">
                            {ticket.labels.slice(0, 3).map((label) => (
                              <span key={label}>{label}</span>
                            ))}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <div className={`coaching-focus coaching-focus-${coaching.tone}`}>
                          <strong>{coaching.focus}</strong>
                          <span>{coaching.action}</span>
                        </div>
                      </td>
                      <td>
                        <span className={`bucket bucket-${bucket.tone}`}>
                          {bucket.label}
                        </span>
                      </td>
                      <td>
                        <strong className="waiting-time">
                          {formatHours(ticket.hoursWaiting)}
                        </strong>
                        <span className="cell-note">
                          {ticket.isWaiting ? "Customer waiting" : "No reply due"}
                        </span>
                      </td>
                      <td>{formatDate(ticket.lastActivityAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {!loading && filteredTickets.length === 0 ? (
              <div className="empty-state">
                {filter === "coaching"
                  ? "No tickets currently need manager intervention."
                  : "No tickets match the selected coaching filters."}
              </div>
            ) : null}
          </div>
        </section>

        <footer>
          <span>
            Thresholds: first reply {dashboard?.thresholds.firstReplyHours ?? 24}h · backlog {dashboard?.thresholds.backlogHours ?? 48}h
          </span>
          <span>Updated every 3 hours (00:00, 03:00, 06:00, 09:00, 12:00, 15:00, 18:00, 21:00 HKT)</span>
        </footer>
      </section>
    </main>
  );
}
