PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_task_reminder` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`lead_value` integer NOT NULL,
	`lead_unit` text NOT NULL,
	`repeat_value` integer,
	`repeat_unit` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_task_reminder`("id", "task_id", "lead_value", "lead_unit", "repeat_value", "repeat_unit", "created_at") SELECT "task_id", "task_id", "lead_value", "lead_unit", "repeat_value", "repeat_unit", "created_at" FROM `task_reminder`;--> statement-breakpoint
DROP TABLE `task_reminder`;--> statement-breakpoint
ALTER TABLE `__new_task_reminder` RENAME TO `task_reminder`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `task_reminder_task_idx` ON `task_reminder` (`task_id`);
