CREATE TABLE `character_references` (
	`id` text PRIMARY KEY NOT NULL,
	`character_id` text NOT NULL,
	`asset_hash` text NOT NULL,
	`purpose` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `character_references_uq` ON `character_references` (`character_id`,`asset_hash`,`purpose`);