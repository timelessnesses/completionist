import { eq } from 'drizzle-orm';
import type { getDb } from '$lib/server/db';
import { access_policy } from '$lib/server/db/schema';

type Database = ReturnType<typeof getDb>;

export function normalizeEmail(email: string) {
	return email.trim().toLowerCase();
}

export function emailBelongsToDomain(email: string, domain: string) {
	const normalizedDomain = domain.trim().toLowerCase().replace(/^@/, '');
	return !!normalizedDomain && normalizeEmail(email).endsWith(`@${normalizedDomain}`);
}

export async function organizationMembersAreAllowed(database: Database) {
	const policy = await database.query.access_policy.findFirst({
		where: eq(access_policy.id, 1)
	});
	// Preserve the pre-whitelist behavior if the singleton row has not been created yet.
	return policy?.allow_org_members !== 0;
}
