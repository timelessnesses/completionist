CREATE TABLE `issue_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`user_id` text NOT NULL,
	`file_name` text NOT NULL,
	`file_url` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `issue_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`user_id` text NOT NULL,
	`comment` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `issues` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`creator_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`closed_at` integer,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`creator_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `push_subs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`auth` text NOT NULL,
	`p256dh` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `task` (
	`id` text PRIMARY KEY NOT NULL,
	`parent` text,
	`name` text NOT NULL,
	`description` text,
	`color` text NOT NULL,
	`owner` text NOT NULL,
	`created_at` integer NOT NULL,
	`end_at` integer NOT NULL,
	`status` text NOT NULL,
	FOREIGN KEY (`parent`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `task_assignee` (
	`task_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`task_id`, `user_id`),
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `task_attachment` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`user_id` text NOT NULL,
	`file_name` text NOT NULL,
	`file_url` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `task_comment` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`user_id` text NOT NULL,
	`comment` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `task_dependency` (
	`task_id` text NOT NULL,
	`dependency_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`task_id`, `dependency_id`),
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`dependency_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `task_tag` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`tag` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`logged_in_when` integer,
	`jwt_expires_at` integer,
	`profile_picture_url` text,
	`refresh_token` text
);
--> statement-breakpoint
CREATE TABLE `user_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`email` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
