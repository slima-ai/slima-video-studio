CREATE TABLE `location_references` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`asset_hash` text NOT NULL,
	`purpose` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `location_references_uq` ON `location_references` (`location_id`,`asset_hash`,`purpose`);