import { and, eq } from 'drizzle-orm';
import { json, error as svelteError } from '@sveltejs/kit';
import { getDb } from '$lib/server/db/index.js';
import { push_subscriptions } from '$lib/server/db/schema.js';

type WebPushBody = {
	endpoint?: string;
	keys?: {
		auth?: string;
		p256dh?: string;
	};
};

export const POST = async ({ request, platform, locals }) => {
	if (!locals.user) {
		throw svelteError(401, 'Unauthorized');
	}

	let body: WebPushBody;
	try {
		body = await request.json();
	} catch {
		throw svelteError(400, 'Invalid JSON');
	}

	const endpoint = body.endpoint?.trim();
	const auth = body.keys?.auth?.trim();
	const p256dh = body.keys?.p256dh?.trim();
	if (!endpoint || !auth || !p256dh) {
		throw svelteError(400, 'endpoint, auth, and p256dh are required');
	}

	const db = getDb((platform?.env as Env).COMPLETIONIST_DB);
	const existing = await db
		.select()
		.from(push_subscriptions)
		.where(
			and(
				eq(push_subscriptions.user_id, locals.user.user_id),
				eq(push_subscriptions.endpoint, endpoint)
			)
		)
		.limit(1);

	if (existing.length === 0) {
		await db.insert(push_subscriptions).values({
			user_id: locals.user.user_id,
			endpoint,
			auth,
			p256dh
		});
	} else {
		await db
			.update(push_subscriptions)
			.set({
				auth,
				p256dh
			})
			.where(
				and(
					eq(push_subscriptions.user_id, locals.user.user_id),
					eq(push_subscriptions.endpoint, endpoint)
				)
			);
	}

	return json({ ok: true }, { status: 201 });
};

export const DELETE = async ({ request, platform, locals }) => {
	if (!locals.user) {
		throw svelteError(401, 'Unauthorized');
	}

	let body: WebPushBody;
	try {
		body = await request.json();
	} catch {
		throw svelteError(400, 'Invalid JSON');
	}

	const endpoint = body.endpoint?.trim();
	if (!endpoint) {
		throw svelteError(400, 'endpoint is required');
	}

	const db = getDb((platform?.env as Env).COMPLETIONIST_DB);
	await db
		.delete(push_subscriptions)
		.where(
			and(
				eq(push_subscriptions.user_id, locals.user.user_id),
				eq(push_subscriptions.endpoint, endpoint)
			)
		);

	return json({ ok: true });
};
