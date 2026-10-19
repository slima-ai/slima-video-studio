CREATE TABLE `canvas_edges` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`source_key` text NOT NULL,
	`source_port` text NOT NULL,
	`target_key` text NOT NULL,
	`target_port` text NOT NULL,
	`kind` text DEFAULT 'data' NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `canvas_layout` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`x` real NOT NULL,
	`y` real NOT NULL,
	`zoom` real,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `canvas_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`type` text NOT NULL,
	`params` text NOT NULL,
	`x` real NOT NULL,
	`y` real NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_takes` (
	`id` text PRIMARY KEY NOT NULL,
	`shot_id` text,
	`owner_type` text DEFAULT 'shot' NOT NULL,
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`version` integer NOT NULL,
	`asset_hash` text NOT NULL,
	`adopted` integer DEFAULT false NOT NULL,
	`model_id` text NOT NULL,
	`seed` integer,
	`run_id` text,
	`node_run_id` text,
	`input_hash` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`shot_id`) REFERENCES `shots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- 既有的版本都是鏡頭擁有的：擁有者就是原本的鏡頭，內容雜湊未知（空）
INSERT INTO `__new_takes`("id", "shot_id", "owner_type", "owner_id", "kind", "version", "asset_hash", "adopted", "model_id", "seed", "run_id", "node_run_id", "input_hash", "created_at") SELECT "id", "shot_id", 'shot', "shot_id", "kind", "version", "asset_hash", "adopted", "model_id", "seed", "run_id", "node_run_id", NULL, "created_at" FROM `takes`;--> statement-breakpoint
DROP TABLE `takes`;--> statement-breakpoint
ALTER TABLE `__new_takes` RENAME TO `takes`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `takes_shot_idx` ON `takes` (`shot_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `takes_owner_kind_version_uq` ON `takes` (`owner_type`,`owner_id`,`kind`,`version`);--> statement-breakpoint
ALTER TABLE `shots` ADD `in_cut` integer DEFAULT true NOT NULL;