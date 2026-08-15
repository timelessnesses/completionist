import { env as envPrivate } from '$env/dynamic/private';
import { env as envPublic } from '$env/dynamic/public';
import { error } from '@sveltejs/kit';
import { OAuth2Client } from 'google-auth-library';
import * as jose from 'jose';
import { drizzle, DrizzleD1Database } from 'drizzle-orm/d1';
import { google_calendar_tokens, user, user_identities } from '$lib/server/db/schema.js';
import { and, eq } from 'drizzle-orm';

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
	const db = drizzle(platform?.env.COMPLETIONIST_DB as D1Database);
	const { id_token } = (await request.json()) as GoogleJwtRequest;

	const ticket = await client.verifyIdToken({
		idToken: id_token,
		audience: envPublic.PUBLIC_GOOGLE_OAUTH_CLIENT_ID
	});

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


	// Look up the identity for this Google account. A user may have multiple
	// identities (emails/providers); the email lives on user_identities, not user.
	const identity = await db
		.select()
		.from(user_identities)
		.where(
			and(
				eq(user_identities.provider, 'google'),
				eq(user_identities.email, payload.email)
			)
		)
		.get();

	if (!identity && envPrivate.ADMIN_EMAIL !== payload.email) {
		return new Response(JSON.stringify({ error: 'Student ID not whitelisted' }), { status: 400 });
	}

	let resolvedUser;
	if (identity) {
		resolvedUser = await db.select().from(user).where(eq(user.id, identity.user_id)).get();
	} else {
		if (envPrivate.ADMIN_EMAIL === payload.email) { 
			await db.insert(user).values({ 
				name: payload.name || 'Admin',
				logged_in_when: new Date(),
				jwt_expires_at: new Date(Date.now() + 3600 * 1000),
			}).run();
			const admin_user = await db.select().from(user).where(eq(user.name, payload.name || 'Admin')).get();
			if (!admin_user) {
				throw error(500, 'Admin user not found.');
			}
			await db.insert(user_identities).values({ 
				user_id: admin_user.id,
				provider: 'google',
				provider_user_id: payload.email,
				email: payload.email,
			}).run();
			/* await db.insert(google_calendar_tokens).values({
				user: admin_user.id,
				access_token: ticket.getPayload().,
				refresh_token: '',
				expires_at: new Date()
			}).run(); */
			resolvedUser = admin_user;
		}
	}

	if (!resolvedUser) {
		throw error(400, `No user account linked to ${payload.email}.`);
	}

	const id = await issuingNewSessionToken(
		resolvedUser,
		payload.email,
		db,
		turnThisToUint8Array(platform?.env.JWT_SECRET_BASE64 as string)
	);
	cookies.set('token', id, {
		path: '/',
		// httpOnly: true,
		sameSite: 'strict',
		// secure: true,
		maxAge: 3600
	});
	// TODO: re-add audit logging once a `logs` table exists in the schema.
	return new Response(JSON.stringify({ success: true }), { status: 200 });
}

async function issuingNewSessionToken(
	resolvedUser: typeof user.$inferSelect,
	email: string,
	database: DrizzleD1Database,
	secret: Uint8Array
) {
	if (!secret) {
		throw error(500, 'Shared secret is not set in environment variables.');
	}

	const sessionToken = await new jose.SignJWT({
		name: resolvedUser.name
	})
		.setIssuedAt()
		.setExpirationTime('1h')
		.setSubject(resolvedUser.id)
		.setAudience(email)
		.setProtectedHeader({
			alg: 'HS256',
			typ: 'JWT'
		})
		.sign(secret);

	await database
		.update(user)
		.set({
			logged_in_when: new Date(),
			jwt_expires_at: new Date(Date.now() + 3600 * 1000)
		})
		.where(eq(user.id, resolvedUser.id))
		.run();
	return sessionToken;
}

function turnThisToUint8Array(secret: string): Uint8Array {
	const uint8Array = Uint8Array.from(atob(secret), (c) => c.charCodeAt(0));
	return uint8Array;
}