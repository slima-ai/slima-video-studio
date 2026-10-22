CREATE TABLE `shot_pins` (
	`id` text PRIMARY KEY NOT NULL,
	`shot_id` text NOT NULL,
	`asset_hash` text NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`shot_id`) REFERENCES `shots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shot_pins_uq` ON `shot_pins` (`shot_id`,`asset_hash`);