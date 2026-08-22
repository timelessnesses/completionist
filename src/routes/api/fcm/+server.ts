import { getDb } from '$lib/server/db/index.js';
import { fcm_tokens } from '$lib/server/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { json, error as svelteError } from '@sveltejs/kit';

type RegisterBody = {
	token: string;
};

// Register (or refresh) an FCM device token for the signed-in user.
export const POST = async ({ request, platform, locals }) => {
	if (!locals.user) {
		throw svelteError(401, 'Unauthorized');
	}

	let body: RegisterBody;
	try {
		body = await request.json();
	} catch {
		throw svelteError(400, 'Invalid JSON');
	}

	if (!body || typeof body.token !== 'string' || !body.token.trim()) {
		throw svelteError(400, 'token is required');
	}

	const db = getDb((platform?.env as Env).COMPLETIONIST_DB);
	const token = body.token.trim();

	// Avoid duplicate rows for the same user+token.
	const existing = await db
		.select()
		.from(fcm_tokens)
		.where(and(eq(fcm_tokens.user_id, locals.user.user_id), eq(fcm_tokens.token, token)))
		.limit(1);

	if (existing.length === 0) {
		await db.insert(fcm_tokens).values({
			user_id: locals.user.user_id,
			token
		});
	}

	return json({ ok: true }, { status: 201 });
};

// Unregister an FCM device token for the signed-in user.
export const DELETE = async ({ request, platform, locals }) => {
	if (!locals.user) {
		throw svelteError(401, 'Unauthorized');
	}

	let body: RegisterBody;
	try {
		body = await request.json();
	} catch {
		throw svelteError(400, 'Invalid JSON');
	}

	if (!body || typeof body.token !== 'string' || !body.token.trim()) {
		throw svelteError(400, 'token is required');
	}

	const db = getDb((platform?.env as Env).COMPLETIONIST_DB);
	await db
		.delete(fcm_tokens)
		.where(
			and(eq(fcm_tokens.user_id, locals.user.user_id), eq(fcm_tokens.token, body.token.trim()))
		);

	return json({ ok: true });
};
