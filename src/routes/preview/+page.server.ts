import { getDb } from '$lib/server/db/index.js';
import { task, task_tag } from '$lib/server/db/schema.js';
import { lt, gte, and, isNull } from 'drizzle-orm';
import { dev } from '$app/environment';

export const load = async ({ platform, url, locals }) => {
	const db = getDb((platform?.env as Env).COMPLETIONIST_DB);
	const tasks = await db.query.task.findMany({
		where: and(
			isNull(task.deleted_at),
			gte(task.start_at, getMonthFromDate(new Date(), -1)),
			lt(task.start_at, getMonthFromDate(new Date(), 2))
		),
		with: {
			assignees: { with: { user: true } },
			dependencies: { with: { dependency: true } },
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

function getMonthFromDate(date: Date, forward: number): Date {
	return new Date(date.getFullYear(), date.getMonth() + forward, 1);
}
