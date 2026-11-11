CREATE TABLE `trailer_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`settings` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trailer_settings_project_id_unique` ON `trailer_settings` (`project_id`);--> statement-breakpoint
ALTER TABLE `shots` ADD `beat_kind` text DEFAULT 'video' NOT NULL;--> statement-breakpoint
ALTER TABLE `shots` ADD `card` text;