import { getDb } from '$lib/server/db/index.js';
import { task } from '$lib/server/db/schema.js';
import { json, error as svelteError } from '@sveltejs/kit';

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
		/* best effort */
	}

	return json(created, { status: 201 });

};
