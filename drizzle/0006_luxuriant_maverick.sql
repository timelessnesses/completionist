PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`logged_in_when` integer,
	`jwt_expires_at` integer,
	`profile_picture_url` text,
	`refresh_token` text,
	`refresh_token_expiration` integer,
	`owner` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_user`("id", "name", "logged_in_when", "jwt_expires_at", "profile_picture_url", "refresh_token", "refresh_token_expiration", "owner") SELECT "id", "name", "logged_in_when", "jwt_expires_at", "profile_picture_url", "refresh_token", "refresh_token_expiration", "owner" FROM `user`;--> statement-breakpoint
DROP TABLE `user`;--> statement-breakpoint
ALTER TABLE `__new_user` RENAME TO `user`;--> statement-breakpoint
PRAGMA foreign_keys=ON;