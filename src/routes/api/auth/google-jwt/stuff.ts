import { user, user_identities } from "$lib/server/db/schema";
import { error } from "console";
import { eq } from "drizzle-orm/sql/expressions/conditions";
import * as jose from "jose";
import { getDb } from "$lib/server/db";
import { JWT_EXPIRATION_IN_SECONDS, REFRESH_TOKEN_EXPIRATION_IN_SECONDS } from "$lib/constants";

export async function issuingNewSessionToken(
	resolvedUser: typeof user.$inferSelect,
	database: ReturnType<typeof getDb>,
	secret: Uint8Array,
) {
	if (!secret) {
		throw error(500, 'Shared secret is not set in environment variables.');
	}

	const sessionToken = await new jose.SignJWT({
		user_id: resolvedUser.id,
	})
		.setIssuedAt()
		.setExpirationTime('10s')
		.setSubject((await database.query.user_identities.findFirst({
			where: eq(user_identities.user_id, resolvedUser.id),
		}))?.email as string)
		.setAudience("completionist")
		.setProtectedHeader({
			alg: 'HS256',
			typ: 'JWT'
		})
		.sign(secret);

	await database
		.update(user)
		.set({
			logged_in_when: new Date(),
			jwt_expires_at: new Date(Date.now() + JWT_EXPIRATION_IN_SECONDS),
			refresh_token_expiration: new Date(Date.now() + REFRESH_TOKEN_EXPIRATION_IN_SECONDS)
		})
		.where(eq(user.id, resolvedUser.id))
		.run();
	return sessionToken;
}

export function turnThisToUint8Array(secret: string): Uint8Array {
	const uint8Array = Uint8Array.from(atob(secret), (c) => c.charCodeAt(0));
	return uint8Array;
}

export function randomBytesToString(length: number): string { 
	const bytes = new Uint8Array(length);
	crypto.getRandomValues(bytes);
	return btoa(String.fromCharCode(...bytes));
}

export async function hashString(str: string): Promise<string> { 
	const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
	return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}