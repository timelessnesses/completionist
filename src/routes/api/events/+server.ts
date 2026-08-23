import { getDb } from '$lib/server/db/index.js';
import { task } from '$lib/server/db/schema.js';
import { eq } from 'drizzle-orm';
import { json, error as svelteError } from '@sveltejs/kit';
import type { WebSocketMessage } from '$lib/websocketMessageTypes';

type CreateBody = {
	task_name: string;
	description?: string | null;
	color: { r: number; g: number; b: number };
	start_at: number;
	end_at: number;
	all_day: 0 | 1;
	status?: 'todo' | 'progress' | 'completed' | 'cancelled';
	importance_value?: number;
};

type UpdateBody = Partial<CreateBody>;

export const POST = async ({ request, platform, locals }) => {
	if (!locals.user) {
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

	const inserted = await db
		.insert(task)
		.values({
			task_name: body.task_name.trim(),
			description: body.description ?? null,
			color: body.color,
			owner: locals.user.user_id,
			start_at: new Date(body.start_at),
			end_at: new Date(body.end_at),
			all_day: body.all_day ? 1 : 0,
			status: body.status ?? 'todo',
			importance_value: body.importance_value ?? 0
		})
		.returning();

	const created = inserted[0];

	// Broadcast the new event to all connected clients (including /preview) via the
	// global Durable Object's HTTP broadcast endpoint. Best effort.
	try {
		const stub = (platform?.env as Env).GlobalWS.getByName('global_ws');
		await stub.fetch('https://global-ws.internal/broadcast', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ type: 'new_calendar_event', event: created })
		});
	} catch {
	}

	await (platform?.env as Env).WS_QUEUE.send(JSON.stringify({ type: 'shouldRefetch' } as WebSocketMessage));

	return json(created, { status: 201 });
};

export const PUT = async ({ request, platform, locals, url }) => {
	if (!locals.user) {
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
	const existing = await db.query.task.findFirst({ where: eq(task.id, id) });
	if (!existing) {
		throw svelteError(404, 'Event not found');
	}

	const canEdit = locals.user.admin || existing.owner === locals.user.user_id;
	if (!canEdit) {
		throw svelteError(403, 'Forbidden');
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

	if (Object.keys(updates).length === 0) {
		return json(existing, { status: 200 });
	}

	const updatedRows = await db.update(task).set(updates).where(eq(task.id, id)).returning();
	const updated = updatedRows[0];

	try {
		const stub = (platform?.env as Env).GlobalWS.getByName('global_ws');
		await stub.fetch('https://global-ws.internal/broadcast', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ type: 'calendar_event_updated', event: updated })
		});
	} catch {
		/* best effort */
	}

	return json(updated, { status: 200 });
};

export const DELETE = async ({ platform, locals, url }) => {
	if (!locals.user) {
		throw svelteError(401, 'Unauthorized');
	}

	const id = url.searchParams.get('id');
	if (!id) {
		throw svelteError(400, 'id is required');
	}

	const db = getDb((platform?.env as Env).COMPLETIONIST_DB);
	const existing = await db.query.task.findFirst({ where: eq(task.id, id) });
	if (!existing) {
		throw svelteError(404, 'Event not found');
	}

	const canDelete = locals.user.admin || existing.owner === locals.user.user_id;
	if (!canDelete) {
		throw svelteError(403, 'Forbidden');
	}

	await db.delete(task).where(eq(task.id, id));

	try {
		const stub = (platform?.env as Env).GlobalWS.getByName('global_ws');
		await stub.fetch('https://global-ws.internal/broadcast', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ type: 'calendar_event_deleted', id })
		});
	} catch {
		/* best effort */
	}

	return json({ ok: true, id });
};
