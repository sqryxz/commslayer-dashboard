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

type HistorySummary = {
  status: "ready" | "unavailable";
  storage: "local-d1";
  detail?: string;
  retentionDays: number;
  snapshotDays: number;
  firstSnapshotDate: string | null;
  lastSnapshotDate: string | null;
  weekly: WeeklyTrend[];
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
};

type Filter = "all" | "new" | "backlog" | "breached";

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

function formatDate(value: string | null) {
  return value ? dateFormatter.format(new Date(value)) : "—";
}

function formatHours(value: number | null) {
  if (value === null) return "Not waiting";
  if (value < 1) return "<1h";
  return `${numberFormatter.format(value)}h`;
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

function QueueRow({
  icon,
  label,
  value,
  definition,
  tooltipId,
  tone = "default",
}: {
  icon: string;
  label: string;
  value: number;
  definition: string;
  tooltipId: string;
  tone?: "default" | "good" | "warning" | "danger";
}) {
  return (
    <li
      className={`queue-row queue-row-${tone}`}
      tabIndex={0}
      aria-describedby={tooltipId}
    >
      <span className="queue-row-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="queue-row-label">{label}</span>
      <strong>{numberFormatter.format(value)}</strong>
      <span id={tooltipId} className="metric-tooltip" role="tooltip">
        {definition}
      </span>
    </li>
  );
}

function AgentScorecard({ dashboard }: { dashboard: AgentDashboard }) {
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
          definition={metricDefinitions.newTotal}
          tooltipId={`metric-tooltip-${agent.assigneeId}-new`}
        />
        <QueueRow
          icon="📌"
          label="<24H"
          value={metrics.newUnder24}
          definition={metricDefinitions.newUnder24}
          tooltipId={`metric-tooltip-${agent.assigneeId}-new-under-24`}
          tone="good"
        />
        <QueueRow
          icon="🐸"
          label=">24H"
          value={metrics.newOver24}
          definition={metricDefinitions.newOver24}
          tooltipId={`metric-tooltip-${agent.assigneeId}-new-over-24`}
          tone="danger"
        />
        <QueueRow
          icon="⚠️"
          label="BACKLOG"
          value={metrics.backlogTotal}
          definition={metricDefinitions.backlogTotal}
          tooltipId={`metric-tooltip-${agent.assigneeId}-backlog`}
          tone="warning"
        />
        <QueueRow
          icon="🌀"
          label=">48H"
          value={metrics.backlogOver48}
          definition={metricDefinitions.backlogOver48}
          tooltipId={`metric-tooltip-${agent.assigneeId}-backlog-over-48`}
          tone="warning"
        />
        <QueueRow
          icon="⚠️"
          label="OPEN"
          value={metrics.totalActive}
          definition={metricDefinitions.totalActive}
          tooltipId={`metric-tooltip-${agent.assigneeId}-open`}
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
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trendMetric, setTrendMetric] =
    useState<TrendMetric>("totalActive");

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
        (filter === "new" && ticket.bucket.startsWith("new")) ||
        (filter === "backlog" && ticket.bucket.startsWith("backlog")) ||
        (filter === "breached" &&
          (ticket.bucket === "new-over-24" ||
            ticket.bucket === "backlog-over-48"));
      const matchesQuery =
        !normalizedQuery ||
        ticket.agentName.toLowerCase().includes(normalizedQuery) ||
        String(ticket.displayId).includes(normalizedQuery) ||
        ticket.subject.toLowerCase().includes(normalizedQuery) ||
        ticket.labels.some((label) =>
          label.toLowerCase().includes(normalizedQuery),
        );

      return matchesFilter && matchesQuery;
    });
  }, [dashboard, filter, query]);

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
            />
          ))}
        </section>

        <section className="queue-health">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Queue health</p>
              <h2>Where attention is needed</h2>
            </div>
            <div className="refresh-meta">
              <span>Last refreshed</span>
              <strong>{formatDate(dashboard?.refreshedAt ?? null)}</strong>
            </div>
          </div>

          <div className="health-grid">
            {(dashboard?.agents ?? []).map((agentDashboard) => {
              const { metrics, agent } = agentDashboard;
              const newTargetRate =
                metrics.newTotal > 0
                  ? Math.round((metrics.newUnder24 / metrics.newTotal) * 100)
                  : 100;
              const backlogBreachRate =
                metrics.backlogTotal > 0
                  ? Math.round((metrics.backlogOver48 / metrics.backlogTotal) * 100)
                  : 0;

              return (
                <article className="health-card" key={agent.assigneeId}>
                  <div className="health-card-heading">
                    <span>{agent.name}</span>
                    <strong>{newTargetRate}% within 24h</strong>
                  </div>
                  <div
                    className="progress-track"
                    role="progressbar"
                    aria-label={`${agent.name} new tickets within 24 hours`}
                    aria-valuenow={newTargetRate}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <span style={{ width: `${newTargetRate}%` }} />
                  </div>
                  <p>
                    {metrics.newOver24} new ticket(s) over target · {backlogBreachRate}% of
                    backlog over 48h.
                  </p>
                </article>
              );
            })}
          </div>
        </section>

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
              <p className="eyebrow">Ticket detail</p>
              <h2>Work the queue</h2>
            </div>
            <div className="ticket-count">
              {filteredTickets.length} ticket
              {filteredTickets.length === 1 ? "" : "s"}
            </div>
          </div>

          <div className="table-controls">
            <div className="segmented-control" aria-label="Filter tickets">
              {(["all", "new", "backlog", "breached"] as Filter[]).map(
                (option) => (
                  <button
                    key={option}
                    type="button"
                    className={filter === option ? "active" : ""}
                    onClick={() => setFilter(option)}
                  >
                    {option === "breached"
                      ? "Over target"
                      : option.charAt(0).toUpperCase() + option.slice(1)}
                  </button>
                ),
              )}
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
                  <th scope="col">Queue state</th>
                  <th scope="col">Waiting</th>
                  <th scope="col">First reply</th>
                  <th scope="col">Last activity</th>
                </tr>
              </thead>
              <tbody>
                {filteredTickets.map((ticket) => {
                  const bucket = bucketCopy(ticket.bucket);
                  return (
                    <tr key={`${ticket.assigneeId}-${ticket.id}`}>
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
                      <td>
                        <span>{formatDate(ticket.firstReplyAt)}</span>
                        <span className="cell-note">
                          {ticket.firstResponseHours === null
                            ? "No first reply"
                            : `${formatHours(ticket.firstResponseHours)} response`}
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
                No tickets match the selected filters.
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
