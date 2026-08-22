import { relations } from 'drizzle-orm';
import { customType } from 'drizzle-orm/sqlite-core';
import {
	integer,
	primaryKey,
	sqliteTable,
	text,
	type AnySQLiteColumn
} from 'drizzle-orm/sqlite-core';

export type Color = {
	r: number;
	g: number;
	b: number;
};

const colorHexType = customType<{
	data: Color;
	driverData: string;
}>({
	dataType() {
		return 'text';
	},
	fromDriver(value: string): Color {
		if (typeof value === 'string') {
			const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(value);
			if (result) {
				return {
					r: parseInt(result[1], 16),
					g: parseInt(result[2], 16),
					b: parseInt(result[3], 16)
				};
			}
		}
		throw new Error(`Invalid color hex string: ${value}`);
	},
	toDriver(value: Color): string {
		if (
			typeof value === 'object' &&
			value !== null &&
			'r' in value &&
			'g' in value &&
			'b' in value
		) {
			if (
				typeof value.r !== 'number' ||
				typeof value.g !== 'number' ||
				typeof value.b !== 'number'
			) {
				throw new Error(`Invalid color object: ${value}`);
			}
			return `#${numberToHex(value.r)}${numberToHex(value.g)}${numberToHex(value.b)}`;
		}
		throw new Error(`Invalid color object: ${value}`);
	}
});

function numberToHex(n: number): string {
	const hex = n.toString(16);
	return hex.length === 1 ? '0' + hex : hex;
}

export const task = sqliteTable('task', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	parent: text('parent').references((): AnySQLiteColumn => task.id),
	task_name: text('name').notNull(),
	description: text('description'),
	color: colorHexType('color').notNull(),
	owner: text('owner')
		.references((): AnySQLiteColumn => user.id)
		.notNull(),
	created_at: integer('created_at', { mode: 'timestamp_ms' })
		.notNull()
		.$defaultFn(() => new Date()),
	end_at: integer('end_at', { mode: 'timestamp_ms' }).notNull(),
	status: text('status').notNull().$type<'todo' | 'progress' | 'completed' | 'cancelled'>(),
	start_at: integer('start_at', { mode: 'timestamp_ms' }).notNull(),
	// bruv
	all_day: integer('all_day').notNull().$type<0 | 1>(),
	// higher importance_value means higher importance
	importance_value: integer('importance_value').notNull()
});

export const user = sqliteTable('user', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	name: text('name').notNull(),
	logged_in_when: integer('logged_in_when', { mode: 'timestamp_ms' }),
	jwt_expires_at: integer('jwt_expires_at', { mode: 'timestamp_ms' }),
	profile_picture_url: text('profile_picture_url'),
	refresh_token: text('refresh_token'),
	refresh_token_expiration: integer('refresh_token_expiration', { mode: 'timestamp_ms' }),
	owner: integer('owner').$type<0 | 1>().notNull().default(0)
});

export const task_assignee = sqliteTable(
	'task_assignee',
	{
		task_id: text('task_id')
			.references((): AnySQLiteColumn => task.id)
			.notNull(),
		user_id: text('user_id')
			.references((): AnySQLiteColumn => user.id)
			.notNull(),
		created_at: integer('created_at', { mode: 'timestamp_ms' })
			.notNull()
			.$defaultFn(() => new Date())
	},
	(table) => {
		return [primaryKey({ columns: [table.task_id, table.user_id] })];
	}
);

export const task_dependency = sqliteTable(
	'task_dependency',
	{
		task_id: text('task_id')
			.references((): AnySQLiteColumn => task.id)
			.notNull(),
		dependency_id: text('dependency_id')
			.references((): AnySQLiteColumn => task.id)
			.notNull(),
		created_at: integer('created_at', { mode: 'timestamp_ms' })
			.notNull()
			.$defaultFn(() => new Date())
	},
	(table) => {
		return [primaryKey({ columns: [table.task_id, table.dependency_id] })];
	}
);

export const task_comment = sqliteTable('task_comment', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	task_id: text('task_id')
		.references((): AnySQLiteColumn => task.id)
		.notNull(),
	user_id: text('user_id')
		.references((): AnySQLiteColumn => user.id)
		.notNull(),
	comment: text('comment').notNull(),
	created_at: integer('created_at', { mode: 'timestamp_ms' })
		.notNull()
		.$defaultFn(() => new Date())
});

export const task_attachment = sqliteTable('task_attachment', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	task_id: text('task_id')
		.references((): AnySQLiteColumn => task.id)
		.notNull(),
	user_id: text('user_id')
		.references((): AnySQLiteColumn => user.id)
		.notNull(),
	file_name: text('file_name').notNull(),
	file_url: text('file_url').notNull(),
	created_at: integer('created_at', { mode: 'timestamp_ms' })
		.notNull()
		.$defaultFn(() => new Date())
});

export const user_identities = sqliteTable('user_identities', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	user_id: text('user_id')
		.references((): AnySQLiteColumn => user.id)
		.notNull(),
	provider: text('provider').notNull(),
	provider_user_id: text('provider_user_id').notNull(),
	created_at: integer('created_at', { mode: 'timestamp_ms' })
		.notNull()
		.$defaultFn(() => new Date()),
	email: text('email')
});

export const push_subscriptions = sqliteTable('push_subs', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	user_id: text('user_id')
		.references((): AnySQLiteColumn => user.id)
		.notNull(),
	endpoint: text('endpoint').notNull(),
	auth: text('auth').notNull(),
	p256dh: text('p256dh').notNull()
});

export const fcm_tokens = sqliteTable('fcm_tokens', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	user_id: text('user_id')
		.references((): AnySQLiteColumn => user.id)
		.notNull(),
	token: text('token').notNull(),
	created_at: integer('created_at', { mode: 'timestamp_ms' })
		.notNull()
		.$defaultFn(() => new Date())
});

export const issues = sqliteTable('issues', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	task_id: text('task_id')
		.references((): AnySQLiteColumn => task.id)
		.notNull(),
	creator_id: text('creator_id')
		.references((): AnySQLiteColumn => user.id)
		.notNull(),
	title: text('title').notNull(),
	description: text('description'),
	status: text('status').notNull().$type<'open' | 'closed'>(),
	created_at: integer('created_at', { mode: 'timestamp_ms' })
		.notNull()
		.$defaultFn(() => new Date()),
	closed_at: integer('closed_at', { mode: 'timestamp_ms' })
});

export const issue_comments = sqliteTable('issue_comments', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	issue_id: text('issue_id')
		.references((): AnySQLiteColumn => issues.id)
		.notNull(),
	user_id: text('user_id')
		.references((): AnySQLiteColumn => user.id)
		.notNull(),
	comment: text('comment').notNull(),
	created_at: integer('created_at', { mode: 'timestamp_ms' })
		.notNull()
		.$defaultFn(() => new Date())
});

export const issue_attachments = sqliteTable('issue_attachments', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	issue_id: text('issue_id')
		.references((): AnySQLiteColumn => issues.id)
		.notNull(),
	user_id: text('user_id')
		.references((): AnySQLiteColumn => user.id)
		.notNull(),
	file_name: text('file_name').notNull(),
	file_url: text('file_url').notNull(),
	created_at: integer('created_at', { mode: 'timestamp_ms' })
		.notNull()
		.$defaultFn(() => new Date())
});

export const task_tag = sqliteTable('task_tags', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	tag: text('tag').notNull(),
	created_at: integer('created_at', { mode: 'timestamp_ms' })
		.notNull()
		.$defaultFn(() => new Date()),
	color: colorHexType('color').notNull()
});

export const task_assigned_tags = sqliteTable(
	'task_assigned_tags',
	{
		task_id: text('task_id')
			.references((): AnySQLiteColumn => task.id)
			.notNull(),
		tag_id: text('tag_id')
			.references((): AnySQLiteColumn => task_tag.id)
			.notNull()
	},
	(table) => {
		return [primaryKey({ columns: [table.task_id, table.tag_id] })];
	}
);

// ─────────────────────────────────────────────────────────────────────────
// Relations
// ─────────────────────────────────────────────────────────────────────────

export const taskRelations = relations(task, ({ one, many }) => ({
	// self-referencing parent/children
	parentTask: one(task, {
		fields: [task.parent],
		references: [task.id],
		relationName: 'task_parent'
	}),
	subtasks: many(task, { relationName: 'task_parent' }),

	owner_user: one(user, {
		fields: [task.owner],
		references: [user.id]
	}),

	assignees: many(task_assignee),
	comments: many(task_comment),
	attachments: many(task_attachment),
	issues: many(issues),
	tags: many(task_assigned_tags),

	// task_dependency has two FKs pointing at task, so each needs its own relationName
	dependencies: many(task_dependency, { relationName: 'task_dependency_task' }),
	dependents: many(task_dependency, { relationName: 'task_dependency_dependency' })
}));

export const userRelations = relations(user, ({ many }) => ({
	owned_tasks: many(task),
	task_assignments: many(task_assignee),
	task_comments: many(task_comment),
	task_attachments: many(task_attachment),
	identities: many(user_identities),
	push_subscriptions: many(push_subscriptions),
	fcm_tokens: many(fcm_tokens),
	created_issues: many(issues),
	issue_comments: many(issue_comments),
	issue_attachments: many(issue_attachments)
}));

export const taskAssigneeRelations = relations(task_assignee, ({ one }) => ({
	task: one(task, {
		fields: [task_assignee.task_id],
		references: [task.id]
	}),
	user: one(user, {
		fields: [task_assignee.user_id],
		references: [user.id]
	})
}));

export const taskDependencyRelations = relations(task_dependency, ({ one }) => ({
	task: one(task, {
		fields: [task_dependency.task_id],
		references: [task.id],
		relationName: 'task_dependency_task'
	}),
	dependency: one(task, {
		fields: [task_dependency.dependency_id],
		references: [task.id],
		relationName: 'task_dependency_dependency'
	})
}));

export const taskCommentRelations = relations(task_comment, ({ one }) => ({
	task: one(task, {
		fields: [task_comment.task_id],
		references: [task.id]
	}),
	user: one(user, {
		fields: [task_comment.user_id],
		references: [user.id]
	})
}));

export const taskAttachmentRelations = relations(task_attachment, ({ one }) => ({
	task: one(task, {
		fields: [task_attachment.task_id],
		references: [task.id]
	}),
	user: one(user, {
		fields: [task_attachment.user_id],
		references: [user.id]
	})
}));

export const userIdentitiesRelations = relations(user_identities, ({ one }) => ({
	user: one(user, {
		fields: [user_identities.user_id],
		references: [user.id]
	})
}));

export const pushSubscriptionsRelations = relations(push_subscriptions, ({ one }) => ({
	user: one(user, {
		fields: [push_subscriptions.user_id],
		references: [user.id]
	})
}));

export const fcmTokensRelations = relations(fcm_tokens, ({ one }) => ({
	user: one(user, {
		fields: [fcm_tokens.user_id],
		references: [user.id]
	})
}));

export const issuesRelations = relations(issues, ({ one, many }) => ({
	task: one(task, {
		fields: [issues.task_id],
		references: [task.id]
	}),
	creator: one(user, {
		fields: [issues.creator_id],
		references: [user.id]
	}),
	comments: many(issue_comments),
	attachments: many(issue_attachments)
}));

export const issueCommentsRelations = relations(issue_comments, ({ one }) => ({
	issue: one(issues, {
		fields: [issue_comments.issue_id],
		references: [issues.id]
	}),
	user: one(user, {
		fields: [issue_comments.user_id],
		references: [user.id]
	})
}));

export const issueAttachmentsRelations = relations(issue_attachments, ({ one }) => ({
	issue: one(issues, {
		fields: [issue_attachments.issue_id],
		references: [issues.id]
	}),
	user: one(user, {
		fields: [issue_attachments.user_id],
		references: [user.id]
	})
}));

export const taskTagRelations = relations(task_tag, ({ many }) => ({
	tasks: many(task_assigned_tags)
}));

export const taskAssignedTagsRelations = relations(task_assigned_tags, ({ one }) => ({
	task: one(task, {
		fields: [task_assigned_tags.task_id],
		references: [task.id]
	}),
	tag: one(task_tag, {
		fields: [task_assigned_tags.tag_id],
		references: [task_tag.id]
	})
}));
