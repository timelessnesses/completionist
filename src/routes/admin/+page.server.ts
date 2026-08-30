import { error } from '@sveltejs/kit';
import { desc, eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { access_policy, admin_audit_log, task } from '$lib/server/db/schema';

export const load = async ({ locals, platform }) => {
	if (!locals.user?.admin) throw error(403, 'Administrator access required');
	const db = getDb((platform?.env as Env).COMPLETIONIST_DB);
	const [events, users, auditLogs, accessPolicy] = await Promise.all([
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
		db.query.user.findMany({ with: { identities: true } }),
		db.select().from(admin_audit_log).orderBy(desc(admin_audit_log.created_at)).limit(100),
		db.query.access_policy.findFirst({ where: eq(access_policy.id, 1) })
	]);
	const accounts = users
		.map((candidate) => ({
			id: candidate.id,
			email:
				candidate.identities.find((identity) => identity.provider === 'google')?.email ??
				candidate.identities[0]?.provider_user_id ??
				'',
			display_name: candidate.name,
			whitelisted: candidate.whitelisted === 1,
			owner: candidate.owner === 1,
			deleted_at: candidate.deleted_at,
			logged_in_when: candidate.logged_in_when
		}))
		.filter((candidate) => candidate.email)
		.sort((a, b) => a.email.localeCompare(b.email));
	return {
		events,
		users,
		auditLogs,
		accessPolicy: { allowOrgMembers: accessPolicy?.allow_org_members !== 0 },
		accounts,
		organizationDomain: (platform?.env as Env).PUBLIC_ORGANIZATION_DOMAIN,
		currentAdmin: { id: locals.user.user_id, name: locals.user.name }
	};
};
