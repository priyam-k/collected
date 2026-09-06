ALTER TABLE `jobs` ADD `category` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `visible` integer DEFAULT true NOT NULL;