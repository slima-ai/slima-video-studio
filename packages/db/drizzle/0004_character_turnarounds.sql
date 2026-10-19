CREATE TABLE `character_turnarounds` (
	`id` text PRIMARY KEY NOT NULL,
	`character_id` text NOT NULL,
	`round` integer NOT NULL,
	`slot` integer NOT NULL,
	`sheet_hash` text NOT NULL,
	`front_hash` text NOT NULL,
	`side_hash` text NOT NULL,
	`back_hash` text NOT NULL,
	`cut_a` real NOT NULL,
	`cut_b` real NOT NULL,
	`hero_hash` text NOT NULL,
	`model_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `character_turnarounds_slot_uq` ON `character_turnarounds` (`character_id`,`round`,`slot`);