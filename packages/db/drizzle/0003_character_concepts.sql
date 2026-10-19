CREATE TABLE `character_concepts` (
	`id` text PRIMARY KEY NOT NULL,
	`character_id` text NOT NULL,
	`round` integer NOT NULL,
	`slot` integer NOT NULL,
	`asset_hash` text NOT NULL,
	`model_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `character_concepts_slot_uq` ON `character_concepts` (`character_id`,`round`,`slot`);