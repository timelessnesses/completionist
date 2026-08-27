import type {
	Color,
	task,
	task_assignee,
	task_assigned_tags,
	task_attachment,
	task_comment,
	task_dependency,
	task_tag,
	user
} from '$lib/server/db/schema';
import type { InferSelectModel } from 'drizzle-orm';

export type CalendarEvent = InferSelectModel<typeof task>;

export interface Person {
	id: string;
	name: string;
	owner?: boolean;
	status?: 'Active' | 'Offline';
	avatar?: string | null;
}

export type TaskColor = Color;
export type FilterTag = InferSelectModel<typeof task_tag>;
export type UserSummary = InferSelectModel<typeof user>;
export type TaskAssigneeLink = InferSelectModel<typeof task_assignee> & { user?: UserSummary };
export type TaskDependencyLink = InferSelectModel<typeof task_dependency> & {
	dependency?: CalendarEvent;
	task?: CalendarEvent;
};
export type TaskCommentEntry = InferSelectModel<typeof task_comment> & { user?: UserSummary };
export type TaskAttachmentEntry = InferSelectModel<typeof task_attachment> & { user?: UserSummary };
export type TaskTagLink = InferSelectModel<typeof task_assigned_tags> & { tag?: FilterTag };

export type RichTask = CalendarEvent & {
	parentTask?: CalendarEvent | null;
	subtasks?: CalendarEvent[];
	assignees?: TaskAssigneeLink[];
	dependencies?: TaskDependencyLink[];
	dependents?: TaskDependencyLink[];
	comments?: TaskCommentEntry[];
	attachments?: TaskAttachmentEntry[];
	tags?: TaskTagLink[];
};
