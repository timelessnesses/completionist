import { getDb } from '$lib/server/db/index.js';
import { task, task_tag } from '$lib/server/db/schema.js';
import { isNull } from 'drizzle-orm';
import { dev } from '$app/environment';

export const load = async ({ platform, url, locals }) => {
	const db = getDb((platform?.env as Env).COMPLETIONIST_DB);
	const tasks = await db.query.task.findMany({
		where: isNull(task.deleted_at),
		with: {
			parentTask: true,
			subtasks: true,
			assignees: { with: { user: true } },
			dependencies: { with: { dependency: true } },
			dependents: { with: { task: true } },
			tags: { with: { tag: true } }
		}
	});
	const filters = await db.query.task_tag.findMany();
	const isLocalHost = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
	const debugEnvironment = dev ? 'vite' : isLocalHost && platform?.env ? 'wrangler' : null;
	return {
		event: tasks,
		filters,
		workerTime: Date.now(),
		workerEdge: platform?.cf?.colo ?? 'local',
		viewerId: locals.user?.user_id ?? null,
		debugEnvironment
	};
};
