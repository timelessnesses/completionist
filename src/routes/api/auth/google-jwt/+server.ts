import { env as envPrivate } from '$env/dynamic/private';
import { env as envPublic } from '$env/dynamic/public';
import { error } from '@sveltejs/kit';
import { OAuth2Client } from 'google-auth-library';
import { user, user_identities } from '$lib/server/db/schema.js';
import { and, eq } from 'drizzle-orm';
import {
	randomBytesToString,
	hashString,
	issuingNewSessionToken,
	turnThisToUint8Array
} from './stuff';
import { getDb } from '$lib/server/db/index.js';
import { JWT_EXPIRATION_IN_SECONDS, REFRESH_TOKEN_EXPIRATION_IN_SECONDS } from '$lib/constants';

export type GoogleJwtRequest = {
	id_token: string;
};

const client = new OAuth2Client({
	client_id: envPublic.PUBLIC_GOOGLE_OAUTH_CLIENT_ID,
	client_secret: envPrivate.GOOGLE_OAUTH_CLIENT_SECRET
});

export async function POST({ request, cookies, platform }) {
	if (!envPublic.PUBLIC_GOOGLE_OAUTH_CLIENT_ID || !envPrivate.GOOGLE_OAUTH_CLIENT_SECRET) {
		throw error(400, 'Google OAuth client ID or secret is not set in environment variables.');
	}
	const db = getDb((platform?.env as Env).COMPLETIONIST_DB as D1Database);
	const { id_token } = (await request.json()) as GoogleJwtRequest;

	const ticket = await client.verifyIdToken({
		idToken: id_token,
		audience: envPublic.PUBLIC_GOOGLE_OAUTH_CLIENT_ID
	});

	console.log('Google ID token verified. Payload:', ticket.getPayload());

	const payload = ticket.getPayload();
	if (!payload) {
		return new Response(JSON.stringify({ error: 'Invalid ID token' }), { status: 400 });
	}
	if (!payload.email?.endsWith('@tsu.ac.th')) {
		return new Response(JSON.stringify({ error: 'Invalid email' }), { status: 400 });
	}
	if (!payload.email_verified) {
		return new Response(JSON.stringify({ error: 'Email not verified' }), { status: 400 });
	}
	let resolvedUser = await db.query.user.findFirst({
		where: and(
			eq(user_identities.provider, 'google'),
			eq(user_identities.provider_user_id, payload.email)
		),
	});
	if (!resolvedUser) {
		await db
			.insert(user)
			.values({
				name: payload.name as string,
				logged_in_when: new Date(),
				jwt_expires_at: new Date(Date.now() + JWT_EXPIRATION_IN_SECONDS),
				refresh_token_expiration: new Date(Date.now() + REFRESH_TOKEN_EXPIRATION_IN_SECONDS),
				owner: 1
			})
			.run();
		const user_t = await db.query.user.findFirst({
			where: eq(user.name, payload.name as string)
		});
		if (!user_t) { 
			throw error(400, `Failed to create user account for ${payload.email}.`);
		}
		await db
			.insert(user_identities)
			.values({
				user_id: user_t.id,
				provider: 'google',
				provider_user_id: payload.email,
				email: payload.email
			})
			.run();
		resolvedUser = user_t;
	}

	if (!resolvedUser) {
		throw error(400, `No user account linked to ${payload.email}.`);
	}

	const refresh_token = randomBytesToString(64);
	const hashed_refresh_token = await hashString(refresh_token);
	await db
		.update(user)
		.set({
			refresh_token: hashed_refresh_token
		})
		.where(eq(user.id, resolvedUser.id))
		.run();

	const id = await issuingNewSessionToken(
		resolvedUser,
		db,
		turnThisToUint8Array((platform?.env as Env).JWT_SECRET_BASE64 as string)
	);
	cookies.set('token', id, {
		path: '/',
		// httpOnly: true,
		sameSite: 'strict',
		secure: request.url.startsWith('https://'),
		maxAge: 3600
	});
	cookies.set('refresh_token', refresh_token, {
		path: '/',
		// httpOnly: true,
		sameSite: 'strict',
		secure: request.url.startsWith('https://'),
		maxAge: 3600
	});
	// TODO: re-add audit logging once a `logs` table exists in the schema.
	return new Response(JSON.stringify({ success: true }), { status: 200 });
}
