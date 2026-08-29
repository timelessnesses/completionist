import { getDb } from '$lib/server/db/index.js';
import {
	task,
	task_assignee,
	task_assigned_tags,
	task_dependency,
	task_reminder,
	task_tag,
	user as userTable
} from '$lib/server/db/schema.js';
import { and, eq, inArray, isNull, isNotNull } from 'drizzle-orm';
import { json, error as svelteError } from '@sveltejs/kit';
import type { Color, ReminderUnit } from '$lib/server/db/schema.js';
import { buildTaskNotificationEnvelope } from '$lib/server/task-fanout';
import { recordAdminEventAction } from '$lib/server/admin-audit';

type CreateBody = {
	task_name: string;
	description?: string | null;
	color: Color;
	start_at: number;
	end_at: number;
	all_day: 0 | 1;
	status?: 'todo' | 'progress' | 'completed' | 'cancelled';
	importance_value?: number;
	completed?: number | null;
	owner_id?: string;
	assignee_ids?: string[];
	dependency_ids?: string[];
	reminders?: ReminderBody[];
	tags?: Array<{
		id?: string;
		tag: string;
		color?: Color;
	}>;
};

type ReminderBody = {
	lead_value: number;
	lead_unit: ReminderUnit;
	repeat_value?: number | null;
	repeat_unit?: ReminderUnit | null;
};

type UpdateBody = Partial<CreateBody>;

export const POST = async ({ request, platform, locals }) => {
	const user = locals.user;
	if (!user) {
		throw svelteError(401, 'Unauthorized');
	}

	let body: CreateBody;
	try {
		body = await request.json();
	} catch {
		throw svelteError(400, 'Invalid JSON');
	}

	if (!body || typeof body.task_name !== 'string' || !body.task_name.trim()) {
		throw svelteError(400, 'task_name is required');
	}
	if (!body.color || typeof body.start_at !== 'number' || typeof body.end_at !== 'number') {
		throw svelteError(400, 'color, start_at and end_at are required');
	}

	const db = getDb((platform?.env as Env).COMPLETIONIST_DB);
	const ownerId = body.owner_id?.trim() || user.user_id;
	if (ownerId !== user.user_id && !user.admin) {
		throw svelteError(403, 'Only administrators can create events for another owner');
	}
	await assertUserExists(db, ownerId);
	const dependencyIds = normalizeDependencyIds(body.dependency_ids);
	const reminders = normalizeReminders(body.reminders);
	await assertDependencyTargetsExist(db, dependencyIds);
	const inserted = await db
		.insert(task)
		.values({
			task_name: body.task_name.trim(),
			description: body.description ?? null,
			color: body.color,
			owner: ownerId,
			start_at: new Date(body.start_at),
			end_at: new Date(body.end_at),
			all_day: body.all_day ? 1 : 0,
			status: body.status ?? 'todo',
			importance_value: body.importance_value ?? 0,
			completed: body.completed ? new Date(body.completed) : null
		})
		.returning();

	const created = inserted[0];
	if (!created) {
		throw svelteError(500, 'Failed to create event');
	}

	if (body.assignee_ids?.length) {
		await db.insert(task_assignee).values(
			body.assignee_ids.map((userId) => ({
				task_id: created.id,
				user_id: userId
			}))
		);
	}

	if (dependencyIds.length) {
		await insertDependencyLinks(db, created.id, dependencyIds);
	}
	if (reminders?.length) {
		await db
			.insert(task_reminder)
			.values(reminders.map((reminder) => ({ task_id: created.id, ...reminder })));
	}

	if (body.tags?.length) {
		const tagLinks: Array<{ task_id: string; tag_id: string }> = [];
		for (const tag of body.tags) {
			let tagId = tag.id;
			if (!tagId) {
				const existing = await db.query.task_tag.findFirst({
					where: eq(task_tag.tag, tag.tag.trim())
				});
				if (existing) {
					tagId = existing.id;
				} else {
					const insertedTag = await db
						.insert(task_tag)
						.values({
							tag: tag.tag.trim(),
							color: tag.color ?? body.color
						})
						.returning();
					tagId = insertedTag[0]?.id;
				}
			}
			if (tagId) {
				tagLinks.push({ task_id: created.id, tag_id: tagId });
			}
		}
		if (tagLinks.length) {
			await db.insert(task_assigned_tags).values(tagLinks);
		}
	}

	const createdWithRelations = await fetchTaskWithRelations(db, created.id);
	const createdWithRelationsFirst = createdWithRelations[0] ?? created;
	if (user.admin) {
		await recordAdminEventAction(db, {
			actorId: user.user_id,
			action: 'create',
			entityId: created.id,
			entityName: created.task_name,
			details: { after: auditEventSnapshot(createdWithRelationsFirst) }
		});
	}

	try {
		const stub = (platform?.env as Env).GlobalWS.getByName('global_ws');
		await stub.fetch('https://global-ws.internal/broadcast', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ type: 'shouldRefetch' })
		});
	} catch {}

	await (platform?.env as Env).COMPLETIONIST_QUEUE.send(
		buildTaskNotificationEnvelope(createdWithRelationsFirst, 'created', locals.user?.name)
	);

	return json(createdWithRelationsFirst, { status: 201 });
};

export const PUT = async ({ request, platform, locals, url }) => {
	const user = locals.user;
	if (!user) {
		throw svelteError(401, 'Unauthorized');
	}

	const id = url.searchParams.get('id');
	if (!id) {
		throw svelteError(400, 'id is required');
	}

	let body: UpdateBody;
	try {
		body = await request.json();
	} catch {
		throw svelteError(400, 'Invalid JSON');
	}

	const db = getDb((platform?.env as Env).COMPLETIONIST_DB);
	const existing = await db.query.task.findFirst({
		where: and(eq(task.id, id), isNull(task.deleted_at))
	});
	if (!existing) {
		throw svelteError(404, 'Event not found');
	}

	const canEdit = user.admin || existing.owner === user.user_id;
	if (!canEdit) {
		throw svelteError(403, 'Forbidden');
	}
	const auditBefore = user.admin
		? auditEventSnapshot((await fetchTaskWithRelations(db, id))[0] ?? existing)
		: null;
	const dependencyIds =
		body.dependency_ids === undefined ? undefined : normalizeDependencyIds(body.dependency_ids);
	const reminders = body.reminders === undefined ? undefined : normalizeReminders(body.reminders);
	if (dependencyIds !== undefined) {
		await assertAcyclicDependencyChange(db, id, dependencyIds);
	}

	const nextStart = typeof body.start_at === 'number' ? new Date(body.start_at) : existing.start_at;
	const nextEnd = typeof body.end_at === 'number' ? new Date(body.end_at) : existing.end_at;
	if (nextEnd < nextStart) {
		throw svelteError(400, 'End must be after start');
	}

	const updates: Partial<typeof task.$inferInsert> = {};
	if (typeof body.task_name === 'string') updates.task_name = body.task_name.trim();
	if (body.description !== undefined) updates.description = body.description;
	if (body.color) updates.color = body.color;
	if (typeof body.start_at === 'number') updates.start_at = new Date(body.start_at);
	if (typeof body.end_at === 'number') updates.end_at = new Date(body.end_at);
	if (body.all_day !== undefined) updates.all_day = body.all_day ? 1 : 0;
	if (body.status) updates.status = body.status;
	if (typeof body.importance_value === 'number') updates.importance_value = body.importance_value;
	if (body.completed !== undefined)
		updates.completed = body.completed ? new Date(body.completed) : null;
	if (body.owner_id !== undefined) {
		if (!user.admin) throw svelteError(403, 'Only administrators can change the owner');
		const ownerId = body.owner_id.trim();
		await assertUserExists(db, ownerId);
		updates.owner = ownerId;
	}

	const hasRelationUpdates =
		body.assignee_ids !== undefined ||
		dependencyIds !== undefined ||
		body.tags !== undefined ||
		reminders !== undefined;
	if (Object.keys(updates).length === 0 && !hasRelationUpdates) {
		return json(existing, { status: 200 });
	}

	if (Object.keys(updates).length > 0) {
		await db.update(task).set(updates).where(eq(task.id, id));
	}

	if (body.assignee_ids !== undefined) {
		await db.delete(task_assignee).where(eq(task_assignee.task_id, id));
		if (body.assignee_ids.length) {
			await db.insert(task_assignee).values(
				body.assignee_ids.map((userId) => ({
					task_id: id,
					user_id: userId
				}))
			);
		}
	}

	if (dependencyIds !== undefined) {
		await replaceDependencyLinks(db, id, dependencyIds);
	}

	if (reminders !== undefined) {
		const removeExisting = db.delete(task_reminder).where(eq(task_reminder.task_id, id));
		if (reminders.length) {
			await db.batch([
				removeExisting,
				db.insert(task_reminder).values(reminders.map((reminder) => ({ task_id: id, ...reminder })))
			]);
		} else {
			await removeExisting;
		}
	}

	if (body.tags !== undefined) {
		await db.delete(task_assigned_tags).where(eq(task_assigned_tags.task_id, id));
		if (body.tags.length) {
			const tagLinks: Array<{ task_id: string; tag_id: string }> = [];
			for (const tag of body.tags) {
				let tagId = tag.id;
				if (!tagId) {
					const existingTag = await db.query.task_tag.findFirst({
						where: eq(task_tag.tag, tag.tag.trim())
					});
					if (existingTag) {
						tagId = existingTag.id;
					} else {
						const insertedTag = await db
							.insert(task_tag)
							.values({
								tag: tag.tag.trim(),
								color: tag.color ?? body.color ?? existing.color
							})
							.returning();
						tagId = insertedTag[0]?.id;
					}
				}
				if (tagId) {
					tagLinks.push({ task_id: id, tag_id: tagId });
				}
			}
			if (tagLinks.length) {
				await db.insert(task_assigned_tags).values(tagLinks);
			}
		}
	}

	const updatedRows = await fetchTaskWithRelations(db, id);
	const updated = updatedRows[0] ?? { ...existing, ...updates };
	if (user.admin) {
		await recordAdminEventAction(db, {
			actorId: user.user_id,
			action: 'update',
			entityId: id,
			entityName: updated.task_name,
			details: { before: auditBefore, after: auditEventSnapshot(updated) }
		});
	}

	try {
		const stub = (platform?.env as Env).GlobalWS.getByName('global_ws');
		await stub.fetch('https://global-ws.internal/broadcast', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ type: 'shouldRefetch' })
		});
	} catch {
		/* best effort */
	}

	await (platform?.env as Env).COMPLETIONIST_QUEUE.send(
		buildTaskNotificationEnvelope(updated, 'updated', locals.user?.name)
	);

	return json(updated, { status: 200 });
};

function normalizeDependencyIds(value: unknown): string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.some((id) => typeof id !== 'string')) {
		throw svelteError(400, 'dependency_ids must be an array of task IDs');
	}
	return [...new Set(value.map((id) => id.trim()).filter(Boolean))];
}

const REMINDER_UNITS = new Set<ReminderUnit>(['hour', 'day', 'week', 'month']);

function normalizeReminders(value: ReminderBody[] | undefined) {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) throw svelteError(400, 'reminders must be an array');
	if (value.length > 20) throw svelteError(400, 'An event can have at most 20 reminders');
	const normalized = value.map(normalizeReminder);
	const keys = new Set(
		normalized.map((reminder) =>
			[
				reminder.lead_value,
				reminder.lead_unit,
				reminder.repeat_value ?? '',
				reminder.repeat_unit ?? ''
			].join(':')
		)
	);
	if (keys.size !== normalized.length) {
		throw svelteError(400, 'Duplicate reminder rules are not allowed');
	}
	return normalized;
}

function normalizeReminder(value: ReminderBody) {
	if (!value || typeof value !== 'object') throw svelteError(400, 'Invalid reminder rule');
	if (!Number.isInteger(value.lead_value) || value.lead_value < 1 || value.lead_value > 1000) {
		throw svelteError(400, 'Reminder lead value must be an integer from 1 to 1000');
	}
	if (!REMINDER_UNITS.has(value.lead_unit)) {
		throw svelteError(400, 'Invalid reminder lead unit');
	}
	const hasRepeatValue = value.repeat_value !== null && value.repeat_value !== undefined;
	const hasRepeatUnit = value.repeat_unit !== null && value.repeat_unit !== undefined;
	if (hasRepeatValue !== hasRepeatUnit) {
		throw svelteError(400, 'Reminder repeat value and unit must be provided together');
	}
	if (
		hasRepeatValue &&
		(!Number.isInteger(value.repeat_value) || value.repeat_value! < 1 || value.repeat_value! > 1000)
	) {
		throw svelteError(400, 'Reminder repeat value must be an integer from 1 to 1000');
	}
	if (hasRepeatUnit && !REMINDER_UNITS.has(value.repeat_unit!)) {
		throw svelteError(400, 'Invalid reminder repeat unit');
	}
	return {
		lead_value: value.lead_value,
		lead_unit: value.lead_unit,
		repeat_value: hasRepeatValue ? value.repeat_value! : null,
		repeat_unit: hasRepeatUnit ? value.repeat_unit! : null
	};
}

async function insertDependencyLinks(
	db: ReturnType<typeof getDb>,
	taskId: string,
	dependencyIds: string[]
) {
	try {
		await db
			.insert(task_dependency)
			.values(
				dependencyIds.map((dependencyId) => ({ task_id: taskId, dependency_id: dependencyId }))
			);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message.toLowerCase().includes('circular dependency')) {
			throw svelteError(409, 'Circular dependency rejected');
		}
		throw error;
	}
}

async function replaceDependencyLinks(
	db: ReturnType<typeof getDb>,
	taskId: string,
	dependencyIds: string[]
) {
	const removeExisting = db.delete(task_dependency).where(eq(task_dependency.task_id, taskId));
	try {
		if (dependencyIds.length === 0) {
			await removeExisting;
			return;
		}
		const addProposed = db
			.insert(task_dependency)
			.values(
				dependencyIds.map((dependencyId) => ({ task_id: taskId, dependency_id: dependencyId }))
			);
		// D1 batches are transactional: a trigger rejection also rolls back the delete.
		await db.batch([removeExisting, addProposed]);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message.toLowerCase().includes('circular dependency')) {
			throw svelteError(409, 'Circular dependency rejected');
		}
		throw error;
	}
}

async function assertDependencyTargetsExist(db: ReturnType<typeof getDb>, dependencyIds: string[]) {
	if (dependencyIds.length === 0) return;
	const found = await db
		.select({ id: task.id })
		.from(task)
		.where(and(inArray(task.id, dependencyIds), isNull(task.deleted_at)));
	const foundIds = new Set(found.map((row) => row.id));
	const missing = dependencyIds.filter((id) => !foundIds.has(id));
	if (missing.length) {
		throw svelteError(
			400,
			`Unknown dependency task${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`
		);
	}
}

async function assertUserExists(db: ReturnType<typeof getDb>, userId: string) {
	if (!userId) throw svelteError(400, 'owner_id is required');
	const found = await db.query.user.findFirst({
		where: eq(userTable.id, userId),
		columns: { id: true }
	});
	if (!found) throw svelteError(400, 'Unknown event owner');
}

async function assertAcyclicDependencyChange(
	db: ReturnType<typeof getDb>,
	taskId: string,
	dependencyIds: string[]
) {
	if (dependencyIds.includes(taskId)) {
		throw svelteError(409, 'A task cannot depend on itself');
	}
	await assertDependencyTargetsExist(db, dependencyIds);

	const edges = await db
		.select({ taskId: task_dependency.task_id, dependencyId: task_dependency.dependency_id })
		.from(task_dependency);
	const graph = new Map<string, Set<string>>();
	for (const edge of edges) {
		// The request replaces this task's complete dependency set.
		if (edge.taskId === taskId) continue;
		const outgoing = graph.get(edge.taskId) ?? new Set<string>();
		outgoing.add(edge.dependencyId);
		graph.set(edge.taskId, outgoing);
	}
	graph.set(taskId, new Set(dependencyIds));

	for (const dependencyId of dependencyIds) {
		const pathBack = findDependencyPath(graph, dependencyId, taskId);
		if (pathBack) {
			throw svelteError(409, `Circular dependency rejected: ${[taskId, ...pathBack].join(' -> ')}`);
		}
	}
}

function findDependencyPath(
	graph: Map<string, Set<string>>,
	startId: string,
	targetId: string
): string[] | null {
	const queue: Array<{ id: string; path: string[] }> = [{ id: startId, path: [startId] }];
	const visited = new Set<string>();
	while (queue.length) {
		const current = queue.shift()!;
		if (current.id === targetId) return current.path;
		if (visited.has(current.id)) continue;
		visited.add(current.id);
		for (const nextId of graph.get(current.id) ?? []) {
			if (!visited.has(nextId)) queue.push({ id: nextId, path: [...current.path, nextId] });
		}
	}
	return null;
}

async function fetchTaskWithRelations(db: ReturnType<typeof getDb>, id: string) {
	const rows = await db.query.task.findMany({
		where: and(eq(task.id, id), isNull(task.deleted_at)),
		with: {
			parentTask: true,
			subtasks: true,
			reminders: true,
			assignees: {
				with: {
					user: true
				}
			},
			dependencies: {
				with: {
					dependency: true
				}
			},
			dependents: {
				with: {
					task: true
				}
			},
			comments: {
				with: {
					user: true
				}
			},
			attachments: {
				with: {
					user: true
				}
			},
			tags: {
				with: {
					tag: true
				}
			}
		}
	});
	return rows.map((item) => ({
		...item,
		subtasks: item.subtasks.filter((subtask) => !subtask.deleted_at),
		dependencies: item.dependencies.filter((link) => !link.dependency?.deleted_at),
		dependents: item.dependents.filter((link) => !link.task?.deleted_at)
	}));
}

function auditEventSnapshot(value: {
	task_name: string;
	owner: string;
	start_at: Date | number | string;
	end_at: Date | number | string;
	status: string;
	importance_value: number;
	all_day: number;
	completed: Date | number | string | null;
	deleted_at?: Date | number | string | null;
	assignees?: Array<{ user_id: string }>;
	dependencies?: Array<{ dependency_id: string }>;
	tags?: Array<{ tag_id: string }>;
	reminders?: Array<{
		lead_value: number;
		lead_unit: ReminderUnit;
		repeat_value: number | null;
		repeat_unit: ReminderUnit | null;
	}>;
}) {
	return {
		name: value.task_name,
		ownerId: value.owner,
		startAt: +new Date(value.start_at),
		endAt: +new Date(value.end_at),
		status: value.status,
		importance: value.importance_value,
		allDay: !!value.all_day,
		completedAt: value.completed ? +new Date(value.completed) : null,
		deletedAt: value.deleted_at ? +new Date(value.deleted_at) : null,
		assigneeIds: value.assignees?.map((assignee) => assignee.user_id),
		dependencyIds: value.dependencies?.map((dependency) => dependency.dependency_id),
		tagIds: value.tags?.map((tag) => tag.tag_id),
		reminders: value.reminders?.map((reminder) => ({
			leadValue: reminder.lead_value,
			leadUnit: reminder.lead_unit,
			repeatValue: reminder.repeat_value,
			repeatUnit: reminder.repeat_unit
		}))
	};
}

export const DELETE = async ({ platform, locals, url }) => {
	const user = locals.user;
	if (!user) {
		throw svelteError(401, 'Unauthorized');
	}

	const id = url.searchParams.get('id');
	if (!id) {
		throw svelteError(400, 'id is required');
	}

	const db = getDb((platform?.env as Env).COMPLETIONIST_DB);
	const existing = await db.query.task.findFirst({
		where: and(eq(task.id, id), isNull(task.deleted_at))
	});
	if (!existing) {
		throw svelteError(404, 'Event not found');
	}

	const canDelete = user.admin || existing.owner === user.user_id;
	if (!canDelete) {
		throw svelteError(403, 'Forbidden');
	}
	const auditBefore = user.admin
		? auditEventSnapshot((await fetchTaskWithRelations(db, id))[0] ?? existing)
		: null;

	const deletedAt = new Date();
	await db.update(task).set({ deleted_at: deletedAt }).where(eq(task.id, id));
	if (user.admin) {
		await recordAdminEventAction(db, {
			actorId: user.user_id,
			action: 'delete',
			entityId: id,
			entityName: existing.task_name,
			details: { before: auditBefore, deletedAt: +deletedAt }
		});
	}

	try {
		const stub = (platform?.env as Env).GlobalWS.getByName('global_ws');
		await stub.fetch('https://global-ws.internal/broadcast', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ type: 'shouldRefetch' })
		});
	} catch {
		/* best effort */
	}

	return json({ ok: true, id, deleted_at: +deletedAt });
};

export const PATCH = async ({ platform, locals, url }) => {
	const currentUser = locals.user;
	if (!currentUser) throw svelteError(401, 'Unauthorized');
	if (!currentUser.admin) throw svelteError(403, 'Administrator access required');

	const id = url.searchParams.get('id');
	const action = url.searchParams.get('action');
	if (!id) throw svelteError(400, 'id is required');
	if (action !== 'restore') throw svelteError(400, 'Unsupported action');

	const env = platform?.env as Env;
	const db = getDb(env.COMPLETIONIST_DB);
	const existing = await db.query.task.findFirst({
		where: and(eq(task.id, id), isNotNull(task.deleted_at))
	});
	if (!existing) throw svelteError(404, 'Deleted event not found');

	await db.update(task).set({ deleted_at: null }).where(eq(task.id, id));
	const restored = (await fetchTaskWithRelations(db, id))[0];
	await recordAdminEventAction(db, {
		actorId: currentUser.user_id,
		action: 'restore',
		entityId: id,
		entityName: existing.task_name,
		details: {
			before: auditEventSnapshot(existing),
			after: auditEventSnapshot(restored ?? { ...existing, deleted_at: null })
		}
	});
	try {
		const stub = env.GlobalWS.getByName('global_ws');
		await stub.fetch('https://global-ws.internal/broadcast', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ type: 'shouldRefetch' })
		});
	} catch {
		/* best effort */
	}
	return json(restored ?? { ...existing, deleted_at: null });
};
