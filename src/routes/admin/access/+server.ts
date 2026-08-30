import { error, json } from '@sveltejs/kit';
import { and, eq, inArray } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { getDb } from '$lib/server/db';
import { access_policy, user, user_identities } from '$lib/server/db/schema';
import { emailBelongsToDomain, normalizeEmail } from '$lib/server/access-control';

type Database = ReturnType<typeof getDb>;
type EntryInput = { email: string; display_name: string | null };

function adminDatabase(locals: App.Locals, platform: App.Platform | undefined) {
	if (!locals.user?.admin) throw error(403, 'Administrator access required');
	const env = platform?.env as Env | undefined;
	if (!env?.COMPLETIONIST_DB) throw error(500, 'Database is unavailable');
	return getDb(env.COMPLETIONIST_DB);
}

function organizationDomain(platform: App.Platform | undefined) {
	const domain = (platform?.env as Env | undefined)?.PUBLIC_ORGANIZATION_DOMAIN;
	if (!domain) throw error(500, 'Organization domain is unavailable');
	return domain;
}

function parseEntry(value: unknown, domain: string): EntryInput {
	if (!value || typeof value !== 'object') throw error(400, 'Invalid whitelist entry');
	const body = value as Record<string, unknown>;
	const email = normalizeEmail(typeof body.email === 'string' ? body.email : '');
	const displayName = typeof body.display_name === 'string' ? body.display_name.trim() : '';
	if (!emailBelongsToDomain(email, domain)) throw error(400, `Email must belong to ${domain}`);
	return { email, display_name: displayName || null };
}

function entryView(
	identity: typeof user_identities.$inferSelect & { user: typeof user.$inferSelect }
) {
	return {
		id: identity.user.id,
		email: identity.email ?? identity.provider_user_id,
		display_name: identity.user.name,
		whitelisted: identity.user.whitelisted === 1,
		owner: identity.user.owner === 1,
		deleted_at: identity.user.deleted_at,
		logged_in_when: identity.user.logged_in_when
	};
}

async function importEntries(database: Database, entries: EntryInput[]) {
	const imported = [] as ReturnType<typeof entryView>[];
	for (let offset = 0; offset < entries.length; offset += 200) {
		const chunk = entries.slice(offset, offset + 200);
		const emails = chunk.map((entry) => entry.email);
		const existing = await database.query.user_identities.findMany({
			where: and(eq(user_identities.provider, 'google'), inArray(user_identities.email, emails)),
			with: { user: true }
		});
		const byEmail = new Map(existing.map((identity) => [identity.email, identity]));
		const statements: BatchItem<'sqlite'>[] = [];
		for (const entry of chunk) {
			const identity = byEmail.get(entry.email);
			if (identity) {
				statements.push(
					database
						.update(user)
						.set({
							whitelisted: 1,
							deleted_at: null,
							...(entry.display_name ? { name: entry.display_name } : {})
						})
						.where(eq(user.id, identity.user_id))
				);
				continue;
			}
			const userId = crypto.randomUUID();
			statements.push(
				database.insert(user).values({
					id: userId,
					name: entry.display_name || entry.email.split('@')[0],
					whitelisted: 1,
					owner: 0
				}),
				database.insert(user_identities).values({
					user_id: userId,
					provider: 'google',
					provider_user_id: entry.email,
					email: entry.email
				})
			);
		}
		if (statements.length) {
			await database.batch(statements as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
		}
		const saved = await database.query.user_identities.findMany({
			where: and(eq(user_identities.provider, 'google'), inArray(user_identities.email, emails)),
			with: { user: true }
		});
		imported.push(...saved.filter((identity) => identity.user.whitelisted === 1).map(entryView));
	}
	return imported;
}

export const PATCH = async ({ request, locals, platform }) => {
	const db = adminDatabase(locals, platform);
	const body = (await request.json()) as Record<string, unknown>;
	if (typeof body.allow_org_members === 'boolean') {
		const allowOrgMembers = body.allow_org_members ? 1 : 0;
		await db
			.insert(access_policy)
			.values({ id: 1, allow_org_members: allowOrgMembers, updated_at: new Date() })
			.onConflictDoUpdate({
				target: access_policy.id,
				set: { allow_org_members: allowOrgMembers, updated_at: new Date() }
			});
		return json({ allowOrgMembers: !!allowOrgMembers });
	}
	const id = typeof body.id === 'string' ? body.id : '';
	if (!id) throw error(400, 'User ID is required');
	if (typeof body.whitelisted === 'boolean') {
		const [updated] = await db
			.update(user)
			.set({ whitelisted: body.whitelisted ? 1 : 0 })
			.where(eq(user.id, id))
			.returning();
		if (!updated) throw error(404, 'User not found');
		return json({ id, whitelisted: updated.whitelisted === 1 });
	}
	if (typeof body.owner === 'boolean') {
		const [updated] = await db
			.update(user)
			.set({ owner: body.owner ? 1 : 0 })
			.where(eq(user.id, id))
			.returning();
		if (!updated) throw error(404, 'User not found');
		return json({ id, owner: updated.owner === 1 });
	}
	if (body.restore === true) {
		const [updated] = await db
			.update(user)
			.set({ deleted_at: null })
			.where(eq(user.id, id))
			.returning();
		if (!updated) throw error(404, 'User not found');
		return json({ id, deleted_at: null });
	}
	throw error(400, 'Invalid account update');
};

export const POST = async ({ request, locals, platform }) => {
	const db = adminDatabase(locals, platform);
	const body = await request.json();
	if (body && typeof body === 'object' && Array.isArray((body as { entries?: unknown }).entries)) {
		const rawEntries = (body as { entries: unknown[] }).entries;
		if (rawEntries.length > 5_000) throw error(400, 'Import is limited to 5,000 rows');
		const uniqueEntries = Array.from(
			new Map(
				rawEntries.map((value) => {
					const entry = parseEntry(value, organizationDomain(platform));
					return [entry.email, entry] as const;
				})
			).values()
		);
		const alreadyWhitelisted = new Set<string>();
		for (let offset = 0; offset < uniqueEntries.length; offset += 200) {
			const emails = uniqueEntries.slice(offset, offset + 200).map((entry) => entry.email);
			const existing = await db.query.user_identities.findMany({
				where: inArray(user_identities.email, emails),
				with: { user: true }
			});
			for (const identity of existing) {
				if (identity.user.whitelisted === 1 && identity.email)
					alreadyWhitelisted.add(identity.email);
			}
		}
		const entries = await importEntries(db, uniqueEntries);
		return json(
			{
				entries,
				imported: entries.filter((entry) => !alreadyWhitelisted.has(entry.email)).length,
				skipped: entries.filter((entry) => alreadyWhitelisted.has(entry.email)).length
			},
			{ status: 201 }
		);
	}
	const entry = parseEntry(body, organizationDomain(platform));
	const [saved] = await importEntries(db, [entry]);
	if (!saved) throw error(500, 'Could not save whitelist entry');
	return json(saved, { status: 201 });
};

export const PUT = async ({ request, locals, platform }) => {
	const db = adminDatabase(locals, platform);
	const body = (await request.json()) as Record<string, unknown>;
	const id = typeof body.id === 'string' ? body.id : '';
	if (!id) throw error(400, 'User ID is required');
	const entry = parseEntry(body, organizationDomain(platform));
	const identity = await db.query.user_identities.findFirst({
		where: and(eq(user_identities.user_id, id), eq(user_identities.provider, 'google')),
		with: { user: true }
	});
	if (!identity) throw error(404, 'User not found');
	const whitelisted =
		typeof body.whitelisted === 'boolean' ? body.whitelisted : identity.user.whitelisted === 1;
	const owner = typeof body.owner === 'boolean' ? body.owner : identity.user.owner === 1;
	const duplicate = await db.query.user_identities.findFirst({
		where: and(
			eq(user_identities.provider, 'google'),
			eq(user_identities.provider_user_id, entry.email)
		)
	});
	if (duplicate && duplicate.user_id !== id) throw error(409, 'That email is already in use');
	await db.batch([
		db
			.update(user)
			.set({
				name: entry.display_name || entry.email.split('@')[0],
				whitelisted: whitelisted ? 1 : 0,
				owner: owner ? 1 : 0
			})
			.where(eq(user.id, id)),
		db
			.update(user_identities)
			.set({ email: entry.email, provider_user_id: entry.email })
			.where(eq(user_identities.id, identity.id))
	]);
	return json({
		id,
		email: entry.email,
		display_name: entry.display_name || entry.email.split('@')[0],
		whitelisted,
		owner,
		deleted_at: identity.user.deleted_at,
		logged_in_when: identity.user.logged_in_when
	});
};

export const DELETE = async ({ url, locals, platform }) => {
	const db = adminDatabase(locals, platform);
	const id = url.searchParams.get('id')?.trim();
	if (!id) throw error(400, 'User ID is required');
	if (id === locals.user!.user_id)
		throw error(400, 'You cannot delete your own administrator account');
	const [updated] = await db
		.update(user)
		.set({
			deleted_at: new Date(),
			whitelisted: 0,
			owner: 0,
			refresh_token: null,
			refresh_token_expiration: null
		})
		.where(eq(user.id, id))
		.returning();
	if (!updated) throw error(404, 'User not found');
	return json({ deleted_at: updated.deleted_at, whitelisted: false, owner: false });
};
