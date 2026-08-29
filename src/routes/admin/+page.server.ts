import { error } from '@sveltejs/kit';
import { desc } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { admin_audit_log, task } from '$lib/server/db/schema';

export const load = async ({ locals, platform }) => {
	if (!locals.user?.admin) throw error(403, 'Administrator access required');
	const db = getDb((platform?.env as Env).COMPLETIONIST_DB);
	const [events, users, auditLogs] = await Promise.all([
		db.query.task.findMany({
			orderBy: desc(task.created_at),
			with: {
				owner_user: true,
				reminders: true,
				assignees: { with: { user: true } },
				dependencies: { with: { dependency: true } },
				tags: { with: { tag: true } }
			}
		}),
		db.query.user.findMany(),
		db.select().from(admin_audit_log).orderBy(desc(admin_audit_log.created_at)).limit(100)
	]);
	return {
		events,
		users,
		auditLogs,
		currentAdmin: { id: locals.user.user_id, name: locals.user.name }
	};
};
