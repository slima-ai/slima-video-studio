CREATE TABLE `sound_clips` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`shot_id` text,
	`asset_hash` text NOT NULL,
	`duration_sec` real,
	`offset_sec` real DEFAULT 0 NOT NULL,
	`gain_db` real,
	`fade_in_sec` real,
	`fade_out_sec` real,
	`text` text DEFAULT '' NOT NULL,
	`voice_id` text,
	`model_id` text NOT NULL,
	`cost_usd` real,
	`cost_estimated` integer DEFAULT false NOT NULL,
	`version` integer NOT NULL,
	`adopted` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`shot_id`) REFERENCES `shots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sound_clips_group_version_uq` ON `sound_clips` (`project_id`,`kind`,`shot_id`,`version`);--> statement-breakpoint
CREATE TABLE `sound_settings` (
	`project_id` text PRIMARY KEY NOT NULL,
	`settings` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `final_cuts` ADD `base_asset_hash` text;--> statement-breakpoint
ALTER TABLE `final_cuts` ADD `sound_key` text;