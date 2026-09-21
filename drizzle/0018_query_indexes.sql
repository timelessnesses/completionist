DROP INDEX `task_idx`;--> statement-breakpoint
CREATE INDEX `task_reminder_scan_idx` ON `task` (`deleted_at`,`completed`,`end_at`);--> statement-breakpoint
CREATE INDEX `task_created_at_idx` ON `task` (`created_at`);--> statement-breakpoint
CREATE INDEX `admin_audit_log_actor_idx` ON `admin_audit_log` (`actor_id`);--> statement-breakpoint
CREATE INDEX `direct_message_conversation_idx` ON `direct_message` (`from_user_id`,`to_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `direct_message_recipient_idx` ON `direct_message` (`to_user_id`);--> statement-breakpoint
CREATE INDEX `direct_message_attachment_message_idx` ON `direct_message_attachment` (`message_id`);--> statement-breakpoint
CREATE INDEX `fcm_tokens_user_token_idx` ON `fcm_tokens` (`user_id`,`token`);--> statement-breakpoint
CREATE INDEX `fcm_tokens_token_idx` ON `fcm_tokens` (`token`);--> statement-breakpoint
CREATE INDEX `issue_attachments_issue_idx` ON `issue_attachments` (`issue_id`);--> statement-breakpoint
CREATE INDEX `issue_attachments_user_idx` ON `issue_attachments` (`user_id`);--> statement-breakpoint
CREATE INDEX `issue_comments_issue_idx` ON `issue_comments` (`issue_id`);--> statement-breakpoint
CREATE INDEX `issue_comments_user_idx` ON `issue_comments` (`user_id`);--> statement-breakpoint
CREATE INDEX `issues_task_idx` ON `issues` (`task_id`);--> statement-breakpoint
CREATE INDEX `issues_creator_idx` ON `issues` (`creator_id`);--> statement-breakpoint
CREATE INDEX `push_subs_user_endpoint_idx` ON `push_subs` (`user_id`,`endpoint`);--> statement-breakpoint
CREATE INDEX `task_attachment_user_idx` ON `task_attachment` (`user_id`);--> statement-breakpoint
CREATE INDEX `task_comment_user_idx` ON `task_comment` (`user_id`);--> statement-breakpoint
CREATE INDEX `task_tags_tag_idx` ON `task_tags` (`tag`);--> statement-breakpoint
CREATE INDEX `user_refresh_token_idx` ON `user` (`refresh_token`);--> statement-breakpoint
CREATE INDEX `user_identities_user_provider_idx` ON `user_identities` (`user_id`,`provider`);--> statement-breakpoint
CREATE INDEX `user_identities_provider_account_idx` ON `user_identities` (`provider`,`provider_user_id`);--> statement-breakpoint
CREATE INDEX `user_identities_email_provider_idx` ON `user_identities` (`email`,`provider`);