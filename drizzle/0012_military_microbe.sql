CREATE TABLE `task_reminder` (
	`task_id` text PRIMARY KEY NOT NULL,
	`lead_value` integer NOT NULL,
	`lead_unit` text NOT NULL,
	`repeat_value` integer,
	`repeat_unit` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE no action
);
