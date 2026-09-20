CREATE INDEX `task_idx` ON `task` (`id`);--> statement-breakpoint
CREATE INDEX `task_parent_idx` ON `task` (`parent`);--> statement-breakpoint
CREATE INDEX `task_owner_idx` ON `task` (`owner`);--> statement-breakpoint
CREATE INDEX `task_assigned_tags_tag_idx` ON `task_assigned_tags` (`tag_id`);--> statement-breakpoint
CREATE INDEX `task_assignee_user_idx` ON `task_assignee` (`user_id`);--> statement-breakpoint
CREATE INDEX `task_attachment_task_idx` ON `task_attachment` (`task_id`);--> statement-breakpoint
CREATE INDEX `task_comment_task_idx` ON `task_comment` (`task_id`);--> statement-breakpoint
CREATE INDEX `task_dependency_dependency_idx` ON `task_dependency` (`dependency_id`);