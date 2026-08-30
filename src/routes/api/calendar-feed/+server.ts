import { error, json } from '@sveltejs/kit';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { createCalendarFeedToken } from '$lib/server/calendar-feed';

async function feedUrl(env: Env, origin: string, userId: string) {
	const db = getDb(env.COMPLETIONIST_DB);
	const account = await db.query.user.findFirst({
		where: eq(user.id, userId),
		columns: { id: true, deleted_at: true, calendar_feed_token_version: true }
	});
	if (!account || account.deleted_at) throw error(403, 'Account is not active');
	const token = await createCalendarFeedToken(env, account.id, account.calendar_feed_token_version);
	const result = new URL('/calendar.ics', origin);
	result.searchParams.set('token', token);
	return result.toString();
}

export const GET = async ({ locals, platform, url }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	const env = platform?.env as Env;
	return json({ url: await feedUrl(env, url.origin, locals.user.user_id) });
};

export const POST = async ({ locals, platform, url }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	const env = platform?.env as Env;
	const db = getDb(env.COMPLETIONIST_DB);
	const result = await db
		.update(user)
		.set({ calendar_feed_token_version: sql`${user.calendar_feed_token_version} + 1` })
		.where(and(eq(user.id, locals.user.user_id), isNull(user.deleted_at)));
	if (!result.meta.changes) throw error(403, 'Account is not active');
	return json({ url: await feedUrl(env, url.origin, locals.user.user_id) });
};
