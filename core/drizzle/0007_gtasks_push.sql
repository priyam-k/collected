CREATE TABLE `gtasks_map` (
	`item_id` text PRIMARY KEY NOT NULL,
	`gtasks_task_id` text NOT NULL,
	`last_pushed_hash` text,
	`closed_by_us` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gtasks_map_task_idx` ON `gtasks_map` (`gtasks_task_id`);