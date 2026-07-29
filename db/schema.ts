import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const metricSnapshots = sqliteTable(
  "metric_snapshots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    snapshotDate: text("snapshot_date").notNull(),
    weekStart: text("week_start").notNull(),
    capturedAt: text("captured_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    source: text("source").notNull().default("live"),
    agentName: text("agent_name").notNull(),
    assigneeId: text("assignee_id").notNull(),
    newTotal: integer("new_total").notNull(),
    newUnder24: integer("new_under_24").notNull(),
    newOver24: integer("new_over_24").notNull(),
    backlogTotal: integer("backlog_total").notNull(),
    backlogOver48: integer("backlog_over_48").notNull(),
    totalActive: integer("total_active").notNull(),
    unclassified: integer("unclassified").notNull(),
  },
  (table) => [
    uniqueIndex("metric_snapshots_date_agent_unique").on(
      table.snapshotDate,
      table.assigneeId,
    ),
    index("metric_snapshots_week_agent_idx").on(
      table.weekStart,
      table.assigneeId,
    ),
  ],
);
