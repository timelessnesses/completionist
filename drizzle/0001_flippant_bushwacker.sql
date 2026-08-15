CREATE TABLE `google_calendar_tokens` (
	`access_token` text NOT NULL,
	`refresh_token` text NOT NULL,
	`user` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `task` ADD `start_at` integer NOT NULL;--> statement-breakpoint
ALTER TABLE `task` ADD `all_day` integer NOT NULL;--> statement-breakpoint
ALTER TABLE `task` ADD `importance_value` integer NOT NULL;