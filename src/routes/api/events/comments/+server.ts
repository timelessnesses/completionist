import { getDb } from '$lib/server/db/index.js';
import { task, task_comment } from '$lib/server/db/schema.js';
import { and, eq, isNull } from 'drizzle-orm';
import { json, error as svelteError } from '@sveltejs/kit';
import { buildTaskNotificationEnvelope } from '$lib/server/task-fanout';

type CreateCommentBody = {
	task_id: string;
	comment: string;
};

async function fetchTaskWithRelations(db: ReturnType<typeof getDb>, id: string) {
	const rows = await db.query.task.findMany({
		where: and(eq(task.id, id), isNull(task.deleted_at)),
		with: {
			parentTask: true,
			subtasks: true,
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

export const POST = async ({ request, platform, locals }) => {
	const user = locals.user;
	if (!user) {
		throw svelteError(401, 'Unauthorized');
	}

	let body: CreateCommentBody;
	try {
		body = await request.json();
	} catch {
		throw svelteError(400, 'Invalid JSON');
	}

	if (!body?.task_id || typeof body.task_id !== 'string') {
		throw svelteError(400, 'task_id is required');
	}

	const text = body.comment?.trim();
	if (!text) {
		throw svelteError(400, 'comment is required');
	}

	const db = getDb((platform?.env as Env).COMPLETIONIST_DB);
	const existing = await db.query.task.findFirst({
		where: and(eq(task.id, body.task_id), isNull(task.deleted_at))
	});
	if (!existing) {
		throw svelteError(404, 'Task not found');
	}

	await db.insert(task_comment).values({
		task_id: body.task_id,
		user_id: user.user_id,
		comment: text
	});

	const rows = await fetchTaskWithRelations(db, body.task_id);
	const updated = rows[0] ?? existing;

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
		buildTaskNotificationEnvelope(updated, 'commented', user.name)
	);

	return json(updated, { status: 201 });
};
