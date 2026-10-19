CREATE TABLE `final_cuts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`version` integer NOT NULL,
	`asset_hash` text NOT NULL,
	`duration_sec` real,
	`take_ids` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `final_cuts_project_version_uq` ON `final_cuts` (`project_id`,`version`);