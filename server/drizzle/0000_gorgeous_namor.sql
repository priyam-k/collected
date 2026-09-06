CREATE TABLE `applications` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text,
	`company` text NOT NULL,
	`title` text NOT NULL,
	`url` text,
	`applied_at` text,
	`status` text DEFAULT 'applied' NOT NULL,
	`contact` text,
	`next_action` text,
	`next_action_at` text,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `course_content` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`kind` text NOT NULL,
	`external_id` text NOT NULL,
	`module_name` text,
	`title` text NOT NULL,
	`url` text,
	`position` integer,
	`raw` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `course_content_unique_idx` ON `course_content` (`course_id`,`kind`,`external_id`);--> statement-breakpoint
CREATE INDEX `course_content_course_idx` ON `course_content` (`course_id`);--> statement-breakpoint
CREATE TABLE `courses` (
	`id` text PRIMARY KEY NOT NULL,
	`term` text NOT NULL,
	`code` text NOT NULL,
	`section` text,
	`name` text,
	`role` text DEFAULT 'student' NOT NULL,
	`canvas_course_id` text,
	`gradescope_course_id` text,
	`submits_via` text DEFAULT 'both' NOT NULL,
	`color` text,
	`links` text NOT NULL,
	`schedule` text NOT NULL,
	`notes` text,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `courses_canvas_idx` ON `courses` (`canvas_course_id`);--> statement-breakpoint
CREATE INDEX `courses_gradescope_idx` ON `courses` (`gradescope_course_id`);--> statement-breakpoint
CREATE TABLE `item_links` (
	`a_item_id` text NOT NULL,
	`b_item_id` text NOT NULL,
	`method` text DEFAULT 'auto' NOT NULL,
	`confidence` real,
	`created_at` text NOT NULL,
	PRIMARY KEY(`a_item_id`, `b_item_id`)
);
--> statement-breakpoint
CREATE INDEX `item_links_b_idx` ON `item_links` (`b_item_id`);--> statement-breakpoint
CREATE TABLE `items` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`external_id` text NOT NULL,
	`kind` text NOT NULL,
	`course_id` text,
	`title` text NOT NULL,
	`description` text,
	`url` text,
	`starts_at` text,
	`ends_at` text,
	`due_at` text,
	`all_day` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`points` real,
	`score` real,
	`labels` text NOT NULL,
	`raw` text NOT NULL,
	`first_seen_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `items_source_external_idx` ON `items` (`source`,`external_id`);--> statement-breakpoint
CREATE INDEX `items_due_idx` ON `items` (`due_at`);--> statement-breakpoint
CREATE INDEX `items_starts_idx` ON `items` (`starts_at`);--> statement-breakpoint
CREATE INDEX `items_course_idx` ON `items` (`course_id`);--> statement-breakpoint
CREATE INDEX `items_kind_idx` ON `items` (`kind`);--> statement-breakpoint
CREATE TABLE `job_state` (
	`job_id` text PRIMARY KEY NOT NULL,
	`state` text DEFAULT 'new' NOT NULL,
	`notes` text,
	`resume_path` text,
	`seen_at` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`external_id` text NOT NULL,
	`company` text NOT NULL,
	`title` text NOT NULL,
	`locations` text NOT NULL,
	`url` text NOT NULL,
	`terms` text NOT NULL,
	`sponsorship` text,
	`degrees` text NOT NULL,
	`posted_at` text,
	`active` integer DEFAULT true NOT NULL,
	`matches_filter` integer DEFAULT false NOT NULL,
	`score` real,
	`first_seen_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_source_external_idx` ON `jobs` (`source`,`external_id`);--> statement-breakpoint
CREATE INDEX `jobs_posted_idx` ON `jobs` (`posted_at`);--> statement-breakpoint
CREATE INDEX `jobs_matches_idx` ON `jobs` (`matches_filter`);--> statement-breakpoint
CREATE TABLE `layouts` (
	`breakpoint` text PRIMARY KEY NOT NULL,
	`layout` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `overrides` (
	`item_id` text PRIMARY KEY NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`done` integer DEFAULT false NOT NULL,
	`snoozed_until` text,
	`note` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'disconnected' NOT NULL,
	`last_run_at` text,
	`last_success_at` text,
	`last_error` text,
	`config_enc` text,
	`meta` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `todoist_map` (
	`item_id` text PRIMARY KEY NOT NULL,
	`todoist_task_id` text NOT NULL,
	`last_pushed_hash` text,
	`closed_by_us` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `todoist_map_task_idx` ON `todoist_map` (`todoist_task_id`);--> statement-breakpoint
CREATE TABLE `widget_instances` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`config` text NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
