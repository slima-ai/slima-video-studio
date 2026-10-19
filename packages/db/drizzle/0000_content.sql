CREATE TABLE `acts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `character_packs` (
	`id` text PRIMARY KEY NOT NULL,
	`character_id` text NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`anchor_text` text DEFAULT '' NOT NULL,
	`hero_asset_hash` text,
	`turnaround` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `character_packs_version_uq` ON `character_packs` (`character_id`,`version`);--> statement-breakpoint
CREATE TABLE `characters` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`age` text,
	`personality` text DEFAULT '' NOT NULL,
	`appearance` text DEFAULT '' NOT NULL,
	`costumes` text NOT NULL,
	`style_id` text,
	`voices` text NOT NULL,
	`current_pack_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `characters_project_idx` ON `characters` (`project_id`);--> statement-breakpoint
CREATE TABLE `locations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`anchor_text` text DEFAULT '' NOT NULL,
	`main_asset_hash` text,
	`angle_asset_hashes` text NOT NULL,
	`status` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`schema_version` integer NOT NULL,
	`aspect_ratio` text DEFAULT '16:9' NOT NULL,
	`default_style_id` text,
	`budget` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scenes` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`act_id` text,
	`title` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`location_id` text,
	`time_of_day` text,
	`mood` text,
	`estimated_seconds` real,
	`position` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`act_id`) REFERENCES `acts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `scenes_project_idx` ON `scenes` (`project_id`,`position`);--> statement-breakpoint
CREATE TABLE `shots` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`scene_id` text,
	`number` integer NOT NULL,
	`position` integer NOT NULL,
	`size` text NOT NULL,
	`angle` text NOT NULL,
	`camera_move` text,
	`duration_sec` real NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`prompt` text,
	`dialogue` text DEFAULT '' NOT NULL,
	`characters` text NOT NULL,
	`location_id` text,
	`lighting` text,
	`mood` text,
	`status` text NOT NULL,
	`active_take_id` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scene_id`) REFERENCES `scenes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `shots_project_idx` ON `shots` (`project_id`,`position`);--> statement-breakpoint
CREATE TABLE `slima_links` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`book_token` text NOT NULL,
	`path` text NOT NULL,
	`remote_version` text,
	`imported_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `styles` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`prompt_fragment` text DEFAULT '' NOT NULL,
	`palette` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `takes` (
	`id` text PRIMARY KEY NOT NULL,
	`shot_id` text NOT NULL,
	`kind` text NOT NULL,
	`version` integer NOT NULL,
	`asset_hash` text NOT NULL,
	`adopted` integer DEFAULT false NOT NULL,
	`model_id` text NOT NULL,
	`seed` integer,
	`run_id` text,
	`node_run_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`shot_id`) REFERENCES `shots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `takes_shot_kind_version_uq` ON `takes` (`shot_id`,`kind`,`version`);