CREATE TABLE `file_sync_state` (
	`course_id` text NOT NULL,
	`file_id` text NOT NULL,
	`manual_target` text,
	`model_target` text,
	`model_confidence` real,
	`model_probabilities` text,
	`model_at` text,
	`placed_target` text,
	`placed_path` text,
	`placed_device` text,
	`placed_at` text,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`course_id`, `file_id`)
);
--> statement-breakpoint
ALTER TABLE `courses` ADD `file_sync` text;