import { integer, primaryKey, sqliteTable, text, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { start } from 'repl';

export const task = sqliteTable('task', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	parent: text('parent').references((): AnySQLiteColumn => task.id),
	task_name: text('name').notNull(),
	description: text('description'),
	color: text('color').notNull(),
	owner: text('owner').references((): AnySQLiteColumn => user.id).notNull(),
	created_at: integer('created_at', { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
	end_at: integer('end_at', { mode: "timestamp_ms" }).notNull(),
	status: text('status').notNull().$type<"todo" | "progress" | "completed" | "cancelled">(),
	start_at: integer('start_at', { mode: "timestamp_ms" }).notNull(),
	// bruv
	all_day: integer('all_day').notNull().$type<0 | 1>(),
	// higher importance_value means higher importance
	importance_value: integer('importance_value').notNull(),
});

export const user = sqliteTable('user', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	name: text('name').notNull(),
	// please treat it as unix timestamp in milliseconds, not seconds
	// pass it to new
	logged_in_when: integer('logged_in_when', { mode: "timestamp_ms"}),
	jwt_expires_at: integer('jwt_expires_at', { mode: "timestamp_ms" }),
	profile_picture_url: text('profile_picture_url'),
	refresh_token: text('refresh_token'),
});

export const task_assignee = sqliteTable('task_assignee', {
	task_id: text('task_id').references((): AnySQLiteColumn => task.id).notNull(),
	user_id: text('user_id').references((): AnySQLiteColumn => user.id).notNull(),
	created_at: integer('created_at', { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => {
	return [primaryKey({ columns: [table.task_id, table.user_id] })];
});

export const task_dependency = sqliteTable('task_dependency', {
	task_id: text('task_id').references((): AnySQLiteColumn => task.id).notNull(),
	dependency_id: text('dependency_id').references((): AnySQLiteColumn => task.id).notNull(),
	created_at: integer('created_at', { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => {
	return [primaryKey({ columns: [table.task_id, table.dependency_id] })];
});

export const task_comment = sqliteTable('task_comment', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	task_id: text('task_id').references((): AnySQLiteColumn => task.id).notNull(),
	user_id: text('user_id').references((): AnySQLiteColumn => user.id).notNull(),
	comment: text('comment').notNull(),
	created_at: integer('created_at', { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const task_attachment = sqliteTable('task_attachment', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	task_id: text('task_id').references((): AnySQLiteColumn => task.id).notNull(),
	user_id: text('user_id').references((): AnySQLiteColumn => user.id).notNull(),
	file_name: text('file_name').notNull(),
	file_url: text('file_url').notNull(),
	created_at: integer('created_at', { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const task_tag = sqliteTable('task_tag', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	task_id: text('task_id').references((): AnySQLiteColumn => task.id).notNull(),
	tag: text('tag').notNull(),
	created_at: integer('created_at', { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const user_identities = sqliteTable('user_identities', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	user_id: text('user_id').references((): AnySQLiteColumn => user.id).notNull(),
	provider: text('provider').notNull(),
	provider_user_id: text('provider_user_id').notNull(),
	created_at: integer('created_at', { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
	email: text('email'),
});

export const push_subscriptions = sqliteTable('push_subs', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	user_id: text('user_id').references((): AnySQLiteColumn => user.id).notNull(),
	endpoint: text('endpoint').notNull(),
	auth: text('auth').notNull(),
	p256dh: text('p256dh').notNull(),
});

export const issues = sqliteTable('issues', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	task_id: text('task_id').references((): AnySQLiteColumn => task.id).notNull(),
	creator_id: text('creator_id').references((): AnySQLiteColumn => user.id).notNull(),
	title: text('title').notNull(),
	description: text('description'),
	status: text('status').notNull().$type<"open" | "closed">(),
	created_at: integer('created_at', { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
	closed_at: integer('closed_at', { mode: "timestamp_ms" }),
});

export const issue_comments = sqliteTable('issue_comments', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	issue_id: text('issue_id').references((): AnySQLiteColumn => issues.id).notNull(),
	user_id: text('user_id').references((): AnySQLiteColumn => user.id).notNull(),
	comment: text('comment').notNull(),
	created_at: integer('created_at', { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const issue_attachments = sqliteTable('issue_attachments', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	issue_id: text('issue_id').references((): AnySQLiteColumn => issues.id).notNull(),
	user_id: text('user_id').references((): AnySQLiteColumn => user.id).notNull(),
	file_name: text('file_name').notNull(),
	file_url: text('file_url').notNull(),
	created_at: integer('created_at', { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});