CREATE TABLE `location_concepts` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`round` integer NOT NULL,
	`slot` integer NOT NULL,
	`asset_hash` text NOT NULL,
	`model_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `location_concepts_slot_uq` ON `location_concepts` (`location_id`,`round`,`slot`);