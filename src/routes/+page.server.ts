import { getDb } from '$lib/server/db/index.js';
import { task } from '$lib/server/db/schema.js';
import { isNull } from 'drizzle-orm';
export const load = async ({ params, request, platform, locals }) => {
	const db = getDb((platform?.env as Env).COMPLETIONIST_DB);

	const tasks = await db.query.task.findMany({
		where: isNull(task.deleted_at),
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
	const visibleTasks = tasks.map((item) => ({
		...item,
		subtasks: item.subtasks.filter((subtask) => !subtask.deleted_at),
		dependencies: item.dependencies.filter((link) => !link.dependency?.deleted_at),
		dependents: item.dependents.filter((link) => !link.task?.deleted_at)
	}));

	const filters = await db.query.task_tag.findMany();
	const users = await db.query.user.findMany();

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
	const now = new Date();

	return {
		event: visibleTasks,
		upcoming: visibleTasks
			.filter(
				(t) =>
					!t.completed &&
					t.status !== 'cancelled' &&
					t.start_at >= startOfToday(now) &&
					t.end_at > now
			)
			.sort((a, b) => +new Date(a.start_at) - +new Date(b.start_at)),
		filters,
		users,
		isOwner: isAdmin,
		isAdmin,
		viewerId
	};
};

function startOfToday(now = new Date()): Date {
	return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
