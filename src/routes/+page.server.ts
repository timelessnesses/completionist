import { getDb } from '$lib/server/db/index.js';
import { task } from '$lib/server/db/schema.js';
import { lt, gte, and } from 'drizzle-orm';
export const load = async ({ params, request, platform, locals }) => {
	const db = getDb((platform?.env as Env).COMPLETIONIST_DB);

	const tasks = await db.query.task.findMany({
		where: and(
			gte(task.start_at, getMonthFromDate(new Date(), -1)),
			lt(task.start_at, getMonthFromDate(new Date(), 2))
		)
	});

	const filters = await db.query.task_tag.findMany();

	/* // Detect ownership: the user is an owner if they own any task or are an admin.
    let isOwner = locals.user?.admin ?? false;
    if (!isOwner && locals.user) {
        const owned = await db.query.task.findFirst({
            where: eq(task.owner, locals.user.user_id),
            columns: { id: true }
        });
        isOwner = !!owned;
    } */

	const isAdmin = locals.user?.admin ?? false;
	const viewerId = locals.user?.user_id ?? null;

	return {
		event: tasks,
		upcoming: tasks.filter((t) => t.start_at > new Date()),
		filters,
		isOwner: isAdmin,
		isAdmin,
		viewerId
	};
};

function getMonthFromDate(date: Date, forward: number): Date {
	return new Date(date.getFullYear(), date.getMonth() + forward, 1);
}
