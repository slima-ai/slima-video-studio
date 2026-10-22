// 由 scripts/embed-migrations.mjs 產生，請勿手動修改。
// 更新方式：pnpm --filter @svs/db db:generate

export interface Migration {
  /** drizzle-kit 產生的檔名（不含副檔名），例如 0000_content。 */
  tag: string
  statements: readonly string[]
}

export const MIGRATIONS: readonly Migration[] = [
  {
    "tag": "0000_content",
    "statements": [
      "CREATE TABLE `acts` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`project_id` text NOT NULL,\n\t`title` text NOT NULL,\n\t`summary` text DEFAULT '' NOT NULL,\n\t`position` integer NOT NULL,\n\tFOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade\n);",
      "CREATE TABLE `character_packs` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`character_id` text NOT NULL,\n\t`version` integer NOT NULL,\n\t`status` text NOT NULL,\n\t`anchor_text` text DEFAULT '' NOT NULL,\n\t`hero_asset_hash` text,\n\t`turnaround` text,\n\t`created_at` text NOT NULL,\n\tFOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade\n);",
      "CREATE UNIQUE INDEX `character_packs_version_uq` ON `character_packs` (`character_id`,`version`);",
      "CREATE TABLE `characters` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`project_id` text NOT NULL,\n\t`name` text NOT NULL,\n\t`age` text,\n\t`personality` text DEFAULT '' NOT NULL,\n\t`appearance` text DEFAULT '' NOT NULL,\n\t`costumes` text NOT NULL,\n\t`style_id` text,\n\t`voices` text NOT NULL,\n\t`current_pack_id` text,\n\t`created_at` text NOT NULL,\n\t`updated_at` text NOT NULL,\n\tFOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade\n);",
      "CREATE INDEX `characters_project_idx` ON `characters` (`project_id`);",
      "CREATE TABLE `locations` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`project_id` text NOT NULL,\n\t`name` text NOT NULL,\n\t`description` text DEFAULT '' NOT NULL,\n\t`anchor_text` text DEFAULT '' NOT NULL,\n\t`main_asset_hash` text,\n\t`angle_asset_hashes` text NOT NULL,\n\t`status` text NOT NULL,\n\tFOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade\n);",
      "CREATE TABLE `projects` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`name` text NOT NULL,\n\t`schema_version` integer NOT NULL,\n\t`aspect_ratio` text DEFAULT '16:9' NOT NULL,\n\t`default_style_id` text,\n\t`budget` text NOT NULL,\n\t`created_at` text NOT NULL,\n\t`updated_at` text NOT NULL\n);",
      "CREATE TABLE `scenes` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`project_id` text NOT NULL,\n\t`act_id` text,\n\t`title` text NOT NULL,\n\t`summary` text DEFAULT '' NOT NULL,\n\t`location_id` text,\n\t`time_of_day` text,\n\t`mood` text,\n\t`estimated_seconds` real,\n\t`position` integer NOT NULL,\n\tFOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,\n\tFOREIGN KEY (`act_id`) REFERENCES `acts`(`id`) ON UPDATE no action ON DELETE set null\n);",
      "CREATE INDEX `scenes_project_idx` ON `scenes` (`project_id`,`position`);",
      "CREATE TABLE `shots` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`project_id` text NOT NULL,\n\t`scene_id` text,\n\t`number` integer NOT NULL,\n\t`position` integer NOT NULL,\n\t`size` text NOT NULL,\n\t`angle` text NOT NULL,\n\t`camera_move` text,\n\t`duration_sec` real NOT NULL,\n\t`description` text DEFAULT '' NOT NULL,\n\t`prompt` text,\n\t`dialogue` text DEFAULT '' NOT NULL,\n\t`characters` text NOT NULL,\n\t`location_id` text,\n\t`lighting` text,\n\t`mood` text,\n\t`status` text NOT NULL,\n\t`active_take_id` text,\n\tFOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,\n\tFOREIGN KEY (`scene_id`) REFERENCES `scenes`(`id`) ON UPDATE no action ON DELETE set null\n);",
      "CREATE INDEX `shots_project_idx` ON `shots` (`project_id`,`position`);",
      "CREATE TABLE `slima_links` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`project_id` text NOT NULL,\n\t`entity_type` text NOT NULL,\n\t`entity_id` text NOT NULL,\n\t`book_token` text NOT NULL,\n\t`path` text NOT NULL,\n\t`remote_version` text,\n\t`imported_at` text NOT NULL,\n\tFOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade\n);",
      "CREATE TABLE `styles` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`project_id` text,\n\t`name` text NOT NULL,\n\t`kind` text NOT NULL,\n\t`prompt_fragment` text DEFAULT '' NOT NULL,\n\t`palette` text NOT NULL,\n\tFOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade\n);",
      "CREATE TABLE `takes` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`shot_id` text NOT NULL,\n\t`kind` text NOT NULL,\n\t`version` integer NOT NULL,\n\t`asset_hash` text NOT NULL,\n\t`adopted` integer DEFAULT false NOT NULL,\n\t`model_id` text NOT NULL,\n\t`seed` integer,\n\t`run_id` text,\n\t`node_run_id` text,\n\t`created_at` text NOT NULL,\n\tFOREIGN KEY (`shot_id`) REFERENCES `shots`(`id`) ON UPDATE no action ON DELETE cascade\n);",
      "CREATE UNIQUE INDEX `takes_shot_kind_version_uq` ON `takes` (`shot_id`,`kind`,`version`);"
    ]
  },
  {
    "tag": "0001_execution",
    "statements": [
      "CREATE TABLE `assets` (\n\t`hash` text PRIMARY KEY NOT NULL,\n\t`kind` text NOT NULL,\n\t`mime` text NOT NULL,\n\t`bytes` integer NOT NULL,\n\t`width` integer,\n\t`height` integer,\n\t`duration_sec` real,\n\t`created_at` text NOT NULL\n);",
      "CREATE TABLE `cost_ledger` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`project_id` text NOT NULL,\n\t`run_id` text,\n\t`job_id` text,\n\t`provider` text NOT NULL,\n\t`model_id` text NOT NULL,\n\t`amount_usd` real NOT NULL,\n\t`estimated` integer NOT NULL,\n\t`created_at` text NOT NULL,\n\tFOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade\n);",
      "CREATE INDEX `cost_ledger_project_idx` ON `cost_ledger` (`project_id`,`created_at`);",
      "CREATE TABLE `jobs` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`node_run_id` text,\n\t`provider` text NOT NULL,\n\t`model_id` text NOT NULL,\n\t`kind` text NOT NULL,\n\t`status` text NOT NULL,\n\t`provider_job_id` text,\n\t`attempt` integer DEFAULT 0 NOT NULL,\n\t`max_attempts` integer DEFAULT 3 NOT NULL,\n\t`next_run_at` text,\n\t`error` text,\n\t`created_at` text NOT NULL,\n\t`updated_at` text NOT NULL\n);",
      "CREATE INDEX `jobs_status_idx` ON `jobs` (`status`,`next_run_at`);",
      "CREATE TABLE `node_runs` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`run_id` text NOT NULL,\n\t`node_id` text NOT NULL,\n\t`parent_node_run_id` text,\n\t`status` text NOT NULL,\n\t`cache_key` text NOT NULL,\n\t`output_hash` text,\n\t`output` text,\n\t`error` text,\n\t`started_at` text,\n\t`finished_at` text,\n\tFOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade\n);",
      "CREATE INDEX `node_runs_run_idx` ON `node_runs` (`run_id`);",
      "CREATE INDEX `node_runs_cache_idx` ON `node_runs` (`cache_key`,`status`);",
      "CREATE TABLE `runs` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`project_id` text NOT NULL,\n\t`workflow_id` text NOT NULL,\n\t`status` text NOT NULL,\n\t`estimated_cost_usd` real DEFAULT 0 NOT NULL,\n\t`actual_cost_usd` real DEFAULT 0 NOT NULL,\n\t`started_at` text,\n\t`finished_at` text,\n\t`created_at` text NOT NULL,\n\tFOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade\n);",
      "CREATE INDEX `runs_project_idx` ON `runs` (`project_id`,`created_at`);",
      "CREATE TABLE `workflows` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`project_id` text,\n\t`name` text NOT NULL,\n\t`version` integer NOT NULL,\n\t`nodes` text NOT NULL,\n\t`edges` text NOT NULL,\n\t`created_at` text NOT NULL,\n\t`updated_at` text NOT NULL,\n\tFOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade\n);"
    ]
  },
  {
    "tag": "0002_job_payload",
    "statements": [
      "ALTER TABLE `jobs` ADD `input` text;",
      "ALTER TABLE `jobs` ADD `output` text;",
      "ALTER TABLE `jobs` ADD `cost_usd` real;"
    ]
  },
  {
    "tag": "0003_character_concepts",
    "statements": [
      "CREATE TABLE `character_concepts` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`character_id` text NOT NULL,\n\t`round` integer NOT NULL,\n\t`slot` integer NOT NULL,\n\t`asset_hash` text NOT NULL,\n\t`model_id` text NOT NULL,\n\t`created_at` text NOT NULL,\n\tFOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade\n);",
      "CREATE UNIQUE INDEX `character_concepts_slot_uq` ON `character_concepts` (`character_id`,`round`,`slot`);"
    ]
  },
  {
    "tag": "0004_character_turnarounds",
    "statements": [
      "CREATE TABLE `character_turnarounds` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`character_id` text NOT NULL,\n\t`round` integer NOT NULL,\n\t`slot` integer NOT NULL,\n\t`sheet_hash` text NOT NULL,\n\t`front_hash` text NOT NULL,\n\t`side_hash` text NOT NULL,\n\t`back_hash` text NOT NULL,\n\t`cut_a` real NOT NULL,\n\t`cut_b` real NOT NULL,\n\t`hero_hash` text NOT NULL,\n\t`model_id` text NOT NULL,\n\t`created_at` text NOT NULL,\n\tFOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade\n);",
      "CREATE UNIQUE INDEX `character_turnarounds_slot_uq` ON `character_turnarounds` (`character_id`,`round`,`slot`);"
    ]
  },
  {
    "tag": "0005_shot_time_of_day",
    "statements": [
      "ALTER TABLE `shots` ADD `time_of_day` text;"
    ]
  },
  {
    "tag": "0006_location_concepts",
    "statements": [
      "CREATE TABLE `location_concepts` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`location_id` text NOT NULL,\n\t`round` integer NOT NULL,\n\t`slot` integer NOT NULL,\n\t`asset_hash` text NOT NULL,\n\t`model_id` text NOT NULL,\n\t`created_at` text NOT NULL,\n\tFOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE cascade\n);",
      "CREATE UNIQUE INDEX `location_concepts_slot_uq` ON `location_concepts` (`location_id`,`round`,`slot`);"
    ]
  },
  {
    "tag": "0007_cost_node_run",
    "statements": [
      "ALTER TABLE `cost_ledger` ADD `node_run_id` text;"
    ]
  },
  {
    "tag": "0008_canvas_home",
    "statements": [
      "CREATE TABLE `canvas_edges` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`project_id` text NOT NULL,\n\t`source_key` text NOT NULL,\n\t`source_port` text NOT NULL,\n\t`target_key` text NOT NULL,\n\t`target_port` text NOT NULL,\n\t`kind` text DEFAULT 'data' NOT NULL,\n\tFOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade\n);",
      "CREATE TABLE `canvas_layout` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`project_id` text NOT NULL,\n\t`x` real NOT NULL,\n\t`y` real NOT NULL,\n\t`zoom` real,\n\tFOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade\n);",
      "CREATE TABLE `canvas_nodes` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`project_id` text NOT NULL,\n\t`type` text NOT NULL,\n\t`params` text NOT NULL,\n\t`x` real NOT NULL,\n\t`y` real NOT NULL,\n\t`created_at` text NOT NULL,\n\tFOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade\n);",
      "PRAGMA foreign_keys=OFF;",
      "CREATE TABLE `__new_takes` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`shot_id` text,\n\t`owner_type` text DEFAULT 'shot' NOT NULL,\n\t`owner_id` text NOT NULL,\n\t`kind` text NOT NULL,\n\t`version` integer NOT NULL,\n\t`asset_hash` text NOT NULL,\n\t`adopted` integer DEFAULT false NOT NULL,\n\t`model_id` text NOT NULL,\n\t`seed` integer,\n\t`run_id` text,\n\t`node_run_id` text,\n\t`input_hash` text,\n\t`created_at` text NOT NULL,\n\tFOREIGN KEY (`shot_id`) REFERENCES `shots`(`id`) ON UPDATE no action ON DELETE cascade\n);",
      "-- 既有的版本都是鏡頭擁有的：擁有者就是原本的鏡頭，內容雜湊未知（空）\nINSERT INTO `__new_takes`(\"id\", \"shot_id\", \"owner_type\", \"owner_id\", \"kind\", \"version\", \"asset_hash\", \"adopted\", \"model_id\", \"seed\", \"run_id\", \"node_run_id\", \"input_hash\", \"created_at\") SELECT \"id\", \"shot_id\", 'shot', \"shot_id\", \"kind\", \"version\", \"asset_hash\", \"adopted\", \"model_id\", \"seed\", \"run_id\", \"node_run_id\", NULL, \"created_at\" FROM `takes`;",
      "DROP TABLE `takes`;",
      "ALTER TABLE `__new_takes` RENAME TO `takes`;",
      "PRAGMA foreign_keys=ON;",
      "CREATE INDEX `takes_shot_idx` ON `takes` (`shot_id`);",
      "CREATE UNIQUE INDEX `takes_owner_kind_version_uq` ON `takes` (`owner_type`,`owner_id`,`kind`,`version`);",
      "ALTER TABLE `shots` ADD `in_cut` integer DEFAULT true NOT NULL;"
    ]
  },
  {
    "tag": "0009_final_cuts",
    "statements": [
      "CREATE TABLE `final_cuts` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`project_id` text NOT NULL,\n\t`version` integer NOT NULL,\n\t`asset_hash` text NOT NULL,\n\t`duration_sec` real,\n\t`take_ids` text NOT NULL,\n\t`created_at` text NOT NULL,\n\tFOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade\n);",
      "CREATE UNIQUE INDEX `final_cuts_project_version_uq` ON `final_cuts` (`project_id`,`version`);"
    ]
  },
  {
    "tag": "0010_project_models",
    "statements": [
      "ALTER TABLE `projects` ADD `models` text DEFAULT '{}' NOT NULL;"
    ]
  },
  {
    "tag": "0011_sound_clips",
    "statements": [
      "CREATE TABLE `sound_clips` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`project_id` text NOT NULL,\n\t`kind` text NOT NULL,\n\t`shot_id` text,\n\t`asset_hash` text NOT NULL,\n\t`duration_sec` real,\n\t`offset_sec` real DEFAULT 0 NOT NULL,\n\t`gain_db` real,\n\t`fade_in_sec` real,\n\t`fade_out_sec` real,\n\t`text` text DEFAULT '' NOT NULL,\n\t`voice_id` text,\n\t`model_id` text NOT NULL,\n\t`cost_usd` real,\n\t`cost_estimated` integer DEFAULT false NOT NULL,\n\t`version` integer NOT NULL,\n\t`adopted` integer DEFAULT false NOT NULL,\n\t`created_at` text NOT NULL,\n\tFOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,\n\tFOREIGN KEY (`shot_id`) REFERENCES `shots`(`id`) ON UPDATE no action ON DELETE cascade\n);",
      "CREATE UNIQUE INDEX `sound_clips_group_version_uq` ON `sound_clips` (`project_id`,`kind`,`shot_id`,`version`);",
      "CREATE TABLE `sound_settings` (\n\t`project_id` text PRIMARY KEY NOT NULL,\n\t`settings` text NOT NULL,\n\tFOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade\n);",
      "ALTER TABLE `final_cuts` ADD `base_asset_hash` text;",
      "ALTER TABLE `final_cuts` ADD `sound_key` text;"
    ]
  },
  {
    "tag": "0012_character_references",
    "statements": [
      "CREATE TABLE `character_references` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`character_id` text NOT NULL,\n\t`asset_hash` text NOT NULL,\n\t`purpose` text NOT NULL,\n\t`label` text DEFAULT '' NOT NULL,\n\t`created_at` text NOT NULL,\n\tFOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade\n);",
      "CREATE UNIQUE INDEX `character_references_uq` ON `character_references` (`character_id`,`asset_hash`,`purpose`);"
    ]
  },
  {
    "tag": "0013_location_references",
    "statements": [
      "CREATE TABLE `location_references` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`location_id` text NOT NULL,\n\t`asset_hash` text NOT NULL,\n\t`purpose` text NOT NULL,\n\t`label` text DEFAULT '' NOT NULL,\n\t`created_at` text NOT NULL,\n\tFOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE cascade\n);",
      "CREATE UNIQUE INDEX `location_references_uq` ON `location_references` (`location_id`,`asset_hash`,`purpose`);"
    ]
  }
]
