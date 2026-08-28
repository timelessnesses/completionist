import { getDb } from '$lib/server/db';
import { admin_audit_log } from '$lib/server/db/schema';

export type AdminAuditAction = 'create' | 'update' | 'delete' | 'restore';

export async function recordAdminEventAction(
	db: ReturnType<typeof getDb>,
	entry: {
		actorId: string;
		action: AdminAuditAction;
		entityId: string;
		entityName: string;
		details?: unknown;
	}
) {
	const rows = await db
		.insert(admin_audit_log)
		.values({
			actor_id: entry.actorId,
			action: entry.action,
			entity_type: 'event',
			entity_id: entry.entityId,
			entity_name: entry.entityName,
			details: entry.details === undefined ? null : JSON.stringify(entry.details)
		})
		.returning();

	return rows[0];
}
