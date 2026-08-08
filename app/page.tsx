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
  inflow?: InflowRow[];
};

type ResolutionRow = {
  date: string;
  total: number;
  mari: number;
  michael: number;
  gian: number;
  unassigned: number;
};

type InflowRow = {
  date: string;
  total: number;
  sarah: number;
  mari: number;
  michael: number;
  gian: number;
  other: number;
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
          <i style={{ background: "var(--text-dim)", opacity: 0.8 }} />
          Total
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

        {/* Total line — actual sum of all agents per day */}
        {totalValues.length > 1 && (
          <g>
            <polyline
              points={totalValues.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
              fill="none"
              stroke="var(--text-dim)"
              strokeWidth="2.5"
              strokeDasharray="6 4"
              opacity={0.8}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {totalValues.map((v, i) => (
              <circle
                key={`total-${days[i].snapshotDate}`}
                cx={x(i)}
                cy={y(v)}
                r="3.5"
                fill="var(--off-white)"
                stroke="var(--text-dim)"
                strokeWidth="2.5"
                opacity={0.8}
              >
                <title>
                  Total, {dayFormatter.format(new Date(days[i].snapshotDate + "T00:00:00.000Z"))}: {v}
                </title>
              </circle>
            ))}
          </g>
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

function TicketFlowChart({
  inflow,
  resolutions,
}: {
  inflow: InflowRow[];
  resolutions: ResolutionRow[];
}) {
  // Merge inflow and resolution data by date
  const inflowDays = inflow.slice(-14);
  const resDays = resolutions.slice(-14);

  // Build merged date list
  const allDates = Array.from(
    new Set([...inflowDays.map((d) => d.date), ...resDays.map((d) => d.date)]),
  )
    .sort()
    .slice(-14);

  const merged = allDates.map((date) => {
    const inf = inflowDays.find((d) => d.date === date);
    const res = resDays.find((d) => d.date === date);
    return {
      date,
      inflow: inf?.total ?? 0,
      sarahInflow: inf?.sarah ?? 0,
      humanInflow: (inf?.mari ?? 0) + (inf?.michael ?? 0) + (inf?.gian ?? 0) + (inf?.other ?? 0),
      sarahResolved: res?.unassigned ?? 0,
      mariResolved: res?.mari ?? 0,
      michaelResolved: res?.michael ?? 0,
      gianResolved: res?.gian ?? 0,
      humanResolved: (res?.mari ?? 0) + (res?.michael ?? 0) + (res?.gian ?? 0),
      totalResolved: res?.total ?? 0,
    };
  });

  const width = 900;
  const height = 320;
  const padding = { top: 30, right: 30, bottom: 50, left: 55 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const maximum = Math.max(1, ...merged.map((d) => Math.max(d.inflow, d.totalResolved)));
  const barGroupWidth = plotWidth / Math.max(1, merged.length);
  const barWidth = Math.max(12, barGroupWidth * 0.3);

  const y = (v: number) => padding.top + plotHeight - (v / maximum) * plotHeight;
  const xLeft = (i: number) =>
    padding.left + i * barGroupWidth + barGroupWidth / 2 - barWidth - 4;
  const xRight = (i: number) =>
    padding.left + i * barGroupWidth + barGroupWidth / 2 + 4;

  const dayFormatter = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short" });

  // Summary stats (last 7 days)
  const recent = merged.slice(-7);
  const avgInflow = Math.round(recent.reduce((s, d) => s + d.inflow, 0) / Math.max(1, recent.length));
  const avgSarahResolved = Math.round(
    recent.reduce((s, d) => s + d.sarahResolved, 0) / Math.max(1, recent.length),
  );
  const avgHumanResolved = Math.round(
    recent.reduce((s, d) => s + d.humanResolved, 0) / Math.max(1, recent.length),
  );
  const sarahRate = avgInflow > 0 ? Math.round((avgSarahResolved / avgInflow) * 100) : 0;

  return (
    <div className="trend-chart-wrap">
      {/* Legend */}
      <div className="trend-legend" aria-label="Ticket flow legend">
        <span>
          <i style={{ background: "#8b5cf6" }} />
          Inflow (tickets entered)
        </span>
        <span>
          <i style={{ background: "#22c55e" }} />
          Sarah resolved (AI)
        </span>
        <span>
          <i style={{ background: "#26b2dd" }} />
          Mari resolved
        </span>
        <span>
          <i style={{ background: "#d3aa22" }} />
          Michael resolved
        </span>
        <span>
          <i style={{ background: "#d96e5f" }} />
          Gian resolved
        </span>
      </div>

      <svg
        className="trend-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Daily ticket flow: inflow vs resolutions by agent"
      >
        {/* Grid */}
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
                x={padding.left - 12}
                y={gridY + 4}
                textAnchor="end"
                className="trend-axis-label"
              >
                {Math.round(value)}
              </text>
            </g>
          );
        })}

        {/* Inflow bars (left side, purple) */}
        {merged.map((day, i) => (
          <rect
            key={`inf-${day.date}`}
            x={xLeft(i)}
            y={y(day.inflow)}
            width={barWidth}
            height={Math.max(0, padding.top + plotHeight - y(day.inflow))}
            fill="#8b5cf6"
            rx={2}
            opacity={0.8}
          >
            <title>
              Inflow · {dayFormatter.format(new Date(day.date + "T00:00:00.000Z"))}: {day.inflow} tickets entered
            </title>
          </rect>
        ))}

        {/* Resolution stacked bars (right side) */}
        {merged.map((day, i) => {
          let cumulative = 0;
          const segments = [
            { value: day.sarahResolved, color: "#22c55e", name: "Sarah (AI)" },
            { value: day.mariResolved, color: "#26b2dd", name: "Mari" },
            { value: day.michaelResolved, color: "#d3aa22", name: "Michael" },
            { value: day.gianResolved, color: "#d96e5f", name: "Gian" },
          ];
          return (
            <g key={`res-${day.date}`}>
              {segments.map((seg) => {
                const segHeight = (seg.value / maximum) * plotHeight;
                const segY =
                  padding.top + plotHeight - segHeight - (cumulative / maximum) * plotHeight;
                cumulative += seg.value;
                return seg.value > 0 ? (
                  <rect
                    key={seg.name}
                    x={xRight(i)}
                    y={segY}
                    width={barWidth}
                    height={segHeight}
                    fill={seg.color}
                    rx={1}
                  >
                    <title>
                      {seg.name} · {dayFormatter.format(new Date(day.date + "T00:00:00.000Z"))}: {seg.value}
                    </title>
                  </rect>
                ) : null;
              })}
            </g>
          );
        })}

        {/* X labels */}
        {merged.map((day, i) => (
          <text
            key={day.date}
            x={padding.left + i * barGroupWidth + barGroupWidth / 2}
            y={height - 14}
            textAnchor="middle"
            className="trend-axis-label"
          >
            {dayFormatter.format(new Date(day.date + "T00:00:00.000Z"))}
          </text>
        ))}

        {/* Section labels */}
        <text
          x={padding.left + plotWidth * 0.25}
          y={14}
          textAnchor="middle"
          fill="#8b5cf6"
          style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.05em" }}
        >
          INFLOW
        </text>
        <text
          x={padding.left + plotWidth * 0.75}
          y={14}
          textAnchor="middle"
          fill="var(--text-muted)"
          style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.05em" }}
        >
          RESOLVED
        </text>
      </svg>

      {/* Summary stats */}
      {merged.length >= 2 && (
        <div
          style={{
            display: "flex",
            gap: 24,
            justifyContent: "center",
            marginTop: 12,
            flexWrap: "wrap" as const,
          }}
        >
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
            Avg inflow:{" "}
            <strong style={{ color: "#8b5cf6" }}>{avgInflow}</strong>/day
          </span>
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
            Sarah resolves:{" "}
            <strong style={{ color: "#22c55e" }}>{avgSarahResolved}</strong>/day ({sarahRate}%)
          </span>
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
            Humans resolve:{" "}
            <strong style={{ color: "var(--text)" }}>{avgHumanResolved}</strong>/day
          </span>
        </div>
      )}
    </div>
  );
}

function WeeklyFlowSummary({
  inflow,
  resolutions,
}: {
  inflow: InflowRow[];
  resolutions: ResolutionRow[];
}) {
  // Merge inflow and resolution data by date (same logic as TicketFlowChart)
  const inflowDays = inflow.slice(-14);
  const resDays = resolutions.slice(-14);
  const allDates = Array.from(
    new Set([...inflowDays.map((d) => d.date), ...resDays.map((d) => d.date)]),
  ).sort();

  const merged = allDates.map((date) => {
    const inf = inflowDays.find((d) => d.date === date);
    const res = resDays.find((d) => d.date === date);
    return {
      date,
      inflow: inf?.total ?? 0,
      sarahResolved: res?.unassigned ?? 0,
      mariResolved: res?.mari ?? 0,
      michaelResolved: res?.michael ?? 0,
      gianResolved: res?.gian ?? 0,
    };
  });

  // Group into Mon–Sun weeks
  const weeksMap = new Map<string, {
    weekStart: string;
    weekLabel: string;
    inflow: number;
    sarah: number;
    mari: number;
    michael: number;
    gian: number;
  }>();

  for (const day of merged) {
    const d = new Date(day.date + "T00:00:00.000Z");
    const dayOfWeek = d.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    // Monday as start of week
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() + mondayOffset);
    const weekStart = monday.toISOString().slice(0, 10);
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);

    const fmt = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short" });
    const weekLabel = `${fmt.format(monday)} – ${fmt.format(sunday)}`;

    if (!weeksMap.has(weekStart)) {
      weeksMap.set(weekStart, {
        weekStart,
        weekLabel,
        inflow: 0,
        sarah: 0,
        mari: 0,
        michael: 0,
        gian: 0,
      });
    }
    const wk = weeksMap.get(weekStart)!;
    wk.inflow += day.inflow;
    wk.sarah += day.sarahResolved;
    wk.mari += day.mariResolved;
    wk.michael += day.michaelResolved;
    wk.gian += day.gianResolved;
  }

  const weeks = Array.from(weeksMap.values()).sort((a, b) =>
    a.weekStart < b.weekStart ? -1 : 1,
  );

  const cellStyle: React.CSSProperties = {
    padding: "6px 10px",
    borderBottom: "1px solid var(--border)",
    fontSize: 13,
    textAlign: "right" as const,
    fontVariantNumeric: "tabular-nums",
  };
  const headerStyle: React.CSSProperties = {
    ...cellStyle,
    fontWeight: 600,
    color: "var(--text-muted)",
    fontSize: 11,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
  };

  return (
    <div style={{ marginTop: 16, overflowX: "auto" as const }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse" as const,
          fontSize: 13,
        }}
      >
        <thead>
          <tr>
            <th style={{ ...headerStyle, textAlign: "left" as const }}>Week (Mon–Sun)</th>
            <th style={headerStyle}>Inflow</th>
            <th style={{ ...headerStyle, color: "#22c55e" }}>Sarah (AI)</th>
            <th style={{ ...headerStyle, color: "#26b2dd" }}>Mari</th>
            <th style={{ ...headerStyle, color: "#d3aa22" }}>Michael</th>
            <th style={{ ...headerStyle, color: "#d96e5f" }}>Gian</th>
            <th style={headerStyle}>Sarah rate</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((wk) => {
            const rate = wk.inflow > 0 ? Math.round((wk.sarah / wk.inflow) * 100) : 0;
            return (
              <tr key={wk.weekStart}>
                <td style={{ ...cellStyle, textAlign: "left" as const, color: "var(--text)" }}>
                  {wk.weekLabel}
                </td>
                <td style={{ ...cellStyle, color: "#8b5cf6", fontWeight: 600 }}>{wk.inflow}</td>
                <td style={{ ...cellStyle, color: "#22c55e", fontWeight: 600 }}>{wk.sarah}</td>
                <td style={cellStyle}>{wk.mari}</td>
                <td style={cellStyle}>{wk.michael}</td>
                <td style={cellStyle}>{wk.gian}</td>
                <td style={{ ...cellStyle, fontWeight: 600, color: rate >= 50 ? "#22c55e" : "var(--text)" }}>
                  {rate}%
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 8, marginBottom: 0 }}>
        Sarah resolution rate = Sarah resolved ÷ total inflow for that week. Weeks are Monday–Sunday GMT+8.
      </p>
    </div>
  );
}

function ResolutionChart({ rows }: { rows: ResolutionRow[] }) {
  const days = rows.slice(-14);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const width = 900;
  const height = 250;
  const padding = { top: 22, right: 28, bottom: 42, left: 48 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const agents = [
    { key: "mari" as const, name: "Mari", color: "#26b2dd" },
    { key: "michael" as const, name: "Michael", color: "#d3aa22" },
    { key: "gian" as const, name: "Gian", color: "#d96e5f" },
    { key: "unassigned" as const, name: "Sarah (AI)", color: "#22c55e" },
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
  const barWidth = Math.max(8, plotWidth / Math.max(1, days.length) * 0.6);

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
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-dim)" }}>
          {selectedDay !== null ? "Click again to dismiss" : "Click a bar for breakdown"}
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
          <text
            key={day.date}
            x={x(index)}
            y={height - 14}
            textAnchor="middle"
            className="trend-axis-label"
            style={{ fontWeight: selectedDay === index ? 700 : 400, fill: selectedDay === index ? "var(--primary)" : undefined }}
          >
            {dayFormatter.format(new Date(day.date + "T00:00:00.000Z"))}
          </text>
        ))}

        {/* Stacked bars — clickable */}
        {days.map((day, index) => {
          let cumulative = 0;
          const isSel = selectedDay === index;
          return (
            <g
              key={day.date}
              onClick={() => setSelectedDay(isSel ? null : index)}
              style={{ cursor: "pointer" }}
            >
              {/* Invisible wide hit area */}
              <rect
                x={x(index) - barWidth * 0.9}
                y={padding.top}
                width={barWidth * 1.8}
                height={plotHeight}
                fill="transparent"
              />
              {/* Highlight outline when selected */}
              {isSel && (
                <rect
                  x={x(index) - barWidth / 2 - 2}
                  y={y(day.total) - 2}
                  width={barWidth + 4}
                  height={padding.top + plotHeight - y(day.total) + 4}
                  fill="none"
                  stroke="var(--primary)"
                  strokeWidth="1.5"
                  rx={2}
                  opacity={0.6}
                />
              )}
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
                    opacity={selectedDay === null || isSel ? 1 : 0.35}
                    style={{ transition: "opacity 0.2s" }}
                  >
                    <title>{agent.name}, {dayFormatter.format(new Date(day.date + "T00:00:00.000Z"))}: {value} ({Math.round(value / day.total * 100)}%)</title>
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

      {/* Breakdown panel when a day is selected */}
      {selectedDay !== null && days[selectedDay] ? (
        <div style={{
          display: "flex",
          gap: 16,
          justifyContent: "center",
          marginTop: 10,
          flexWrap: "wrap" as const,
          padding: "10px 16px",
          border: "1px solid var(--border)",
          borderRadius: 6,
          background: "var(--surface-elevated, var(--surface, #111))",
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", minWidth: "fit-content" }}>
            {dayFormatter.format(new Date(days[selectedDay].date + "T00:00:00.000Z"))}:
          </span>
          {agents.map((agent) => {
            const value = days[selectedDay][agent.key];
            const total = days[selectedDay].total || 1;
            const pct = Math.round(value / total * 100);
            return (
              <span key={agent.key} style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                <i style={{ width: 10, height: 10, borderRadius: 2, background: agent.color, display: "inline-block" }} />
                <span style={{ color: "var(--text-muted)" }}>{agent.name}</span>
                <strong style={{ color: agent.color }}>{value}</strong>
                <span style={{ color: "var(--text-dim)" }}>({pct}%)</span>
              </span>
            );
          })}
        </div>
      ) : null}

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
            Sarah (AI): <strong style={{ color: "#22c55e" }}>{days.at(-1)?.unassigned ?? 0}</strong>
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

        {dashboard?.inflow && dashboard.inflow.length > 0 && dashboard?.resolutions ? (
          <section className="queue-health">
            <div className="section-heading">
              <div>
                <p className="eyebrow">End-to-end ticket flow</p>
                <h2>From queue entry to resolution</h2>
                <p className="history-subtitle">
                  Daily inflow (purple) vs resolutions by Sarah (AI) and human agents · Last 14 days
                </p>
              </div>
            </div>
            <TicketFlowChart
              inflow={dashboard.inflow}
              resolutions={dashboard.resolutions}
            />
            <details
              style={{
                marginTop: 12,
                padding: "12px 16px",
                border: "1px solid var(--border)",
                borderRadius: 6,
                background: "var(--surface-elevated, var(--surface, #111))",
                fontSize: 13,
                lineHeight: 1.7,
                color: "var(--text-muted)",
              }}
            >
              <summary
                style={{ cursor: "pointer", fontWeight: 600, color: "var(--text)" }}
              >
                How each stage is calculated
              </summary>
              <dl style={{ marginTop: 10, marginBottom: 0, display: "grid", gap: 10 }}>
                <div>
                  <dt style={{ fontWeight: 600, color: "#8b5cf6", display: "inline" }}>
                    Inflow
                  </dt>
                  <dd style={{ display: "inline", marginLeft: 6 }}>
                    All conversations created that day (by <code>created_at</code> date).
                    Every ticket enters the queue through Sarah first, so this equals total
                    daily ticket volume. Includes both open and already-resolved tickets.
                  </dd>
                </div>
                <div>
                  <dt style={{ fontWeight: 600, color: "#22c55e", display: "inline" }}>
                    Sarah resolved (AI)
                  </dt>
                  <dd style={{ display: "inline", marginLeft: 6 }}>
                    Resolved conversations where the final <code>assignee_id</code> is null.
                    Sarah is the AI bot auto-assigned to every conversation. If she handles
                    it end-to-end (e.g. auto-labels, replies, or detects no response needed),
                    the ticket stays unassigned. She then marks it resolved.
                  </dd>
                </div>
                <div>
                  <dt style={{ fontWeight: 600, color: "#26b2dd", display: "inline" }}>
                    Mari / Michael / Gian resolved
                  </dt>
                  <dd style={{ display: "inline", marginLeft: 6 }}>
                    Resolved conversations where the final <code>assignee_id</code> matches
                    that human agent. These are tickets Sarah escalated — she was
                    {" "}<em>removed from the conversation: no matching guidance detected</em>
                    {" "}— and a human took over. Counted by <code>updated_at</code> date
                    (proxy for resolution date, since the API has no <code>resolved_at</code>{" "}
                    field).
                  </dd>
                </div>
                <div>
                  <dt style={{ fontWeight: 600, color: "var(--text-dim)", display: "inline" }}>
                    Inflow vs resolution mismatch
                  </dt>
                  <dd style={{ display: "inline", marginLeft: 6 }}>
                    Inflow and resolution counts are grouped by different dates
                    (<code>created_at</code> vs <code>updated_at</code>), so they won't match
                    on any single day. A ticket created Monday may be resolved Wednesday.
                    Over 7-day windows they roughly balance (~130–200/day each).
                  </dd>
                </div>
                <div>
                  <dt style={{ fontWeight: 600, color: "var(--text-dim)", display: "inline" }}>
                    Data source
                  </dt>
                  <dd style={{ display: "inline", marginLeft: 6 }}>
                    Commslayer API <code>/conversations?filter[status]=resolved</code>,
                    refreshed every 3 hours by the cache warmer. 14-day rolling window.
                  </dd>
                </div>
              </dl>
            </details>
            <WeeklyFlowSummary
              inflow={dashboard.inflow}
              resolutions={dashboard.resolutions}
            />
          </section>
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
