ALTER TABLE `jobs` ADD `req_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_source_req_idx` ON `jobs` (`source`,`req_id`) WHERE req_id is not null;