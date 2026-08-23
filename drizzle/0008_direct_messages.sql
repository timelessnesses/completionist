CREATE TABLE `direct_message` (
	`id` text PRIMARY KEY NOT NULL,
	`from_user_id` text NOT NULL,
	`to_user_id` text NOT NULL,
	`message` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`from_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `direct_message_attachment` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`file_name` text NOT NULL,
	`file_url` text NOT NULL,
	`file_key` text NOT NULL,
	`content_type` text,
	`size` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `direct_message`(`id`) ON UPDATE no action ON DELETE no action
);
