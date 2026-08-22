import { user } from '$lib/server/db/schema.js';
import { eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db/index.js';

export async function POST({ cookies, platform, locals }) {
	let db = getDb(platform?.env.COMPLETIONIST_DB as D1Database);
	await db
		.update(user)
		.set({
			refresh_token: null
		})
		.where(eq(user.id, locals.user?.user_id ?? ''))
		.run();

	cookies.set('token', '', {
		path: '/',
		sameSite: 'strict',
		maxAge: 0,
		expires: new Date(0)
	});

	return new Response(JSON.stringify({ success: true }), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});
}
