CREATE TABLE `access_policy` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`allow_org_members` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `user` ADD `whitelisted` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `deleted_at` integer;