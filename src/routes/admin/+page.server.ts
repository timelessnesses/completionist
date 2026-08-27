import { error } from '@sveltejs/kit';
import { desc } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { task } from '$lib/server/db/schema';

export const load = async ({ locals, platform }) => {
	if (!locals.user?.admin) throw error(403, 'Administrator access required');
	const db = getDb((platform?.env as Env).COMPLETIONIST_DB);
	const [events, users] = await Promise.all([
		db.query.task.findMany({
			orderBy: desc(task.created_at),
			with: {
				owner_user: true,
				assignees: { with: { user: true } },
				dependencies: { with: { dependency: true } },
				tags: { with: { tag: true } }
			}
		}),
		db.query.user.findMany()
	]);
	return { events, users };
};
