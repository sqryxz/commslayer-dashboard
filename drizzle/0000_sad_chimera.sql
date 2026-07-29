CREATE TABLE `metric_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`snapshot_date` text NOT NULL,
	`week_start` text NOT NULL,
	`captured_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`source` text DEFAULT 'live' NOT NULL,
	`agent_name` text NOT NULL,
	`assignee_id` text NOT NULL,
	`new_total` integer NOT NULL,
	`new_under_24` integer NOT NULL,
	`new_over_24` integer NOT NULL,
	`backlog_total` integer NOT NULL,
	`backlog_over_48` integer NOT NULL,
	`total_active` integer NOT NULL,
	`unclassified` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `metric_snapshots_date_agent_unique` ON `metric_snapshots` (`snapshot_date`,`assignee_id`);--> statement-breakpoint
CREATE INDEX `metric_snapshots_week_agent_idx` ON `metric_snapshots` (`week_start`,`assignee_id`);