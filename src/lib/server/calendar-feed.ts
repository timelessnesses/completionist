import { decodeBase64Secret } from '$lib/server/auth-token';
import { jwtVerify, SignJWT } from 'jose';

const ISSUER = 'completionist';
const AUDIENCE = 'calendar-feed';

export async function createCalendarFeedToken(env: Env, userId: string, version: number) {
	console.log('Creating calendar feed token for user', userId, 'version', version);
	if (!Number.isSafeInteger(version) || version < 0) {
		throw new TypeError('Calendar feed token version must be a non-negative integer');
	}
	return new SignJWT({ purpose: 'calendar_feed', user_id: userId, version })
		.setProtectedHeader({ alg: 'HS256' })
		.setIssuer(ISSUER)
		.setAudience(AUDIENCE)
		.setIssuedAt()
		.sign(decodeBase64Secret(env.JWT_SECRET_BASE64));
}

export async function verifyCalendarFeedToken(env: Env, token: string) {
	const verified = await jwtVerify(token, decodeBase64Secret(env.JWT_SECRET_BASE64), {
		issuer: ISSUER,
		audience: AUDIENCE
	});
	if (
		verified.payload.purpose !== 'calendar_feed' ||
		typeof verified.payload.user_id !== 'string' ||
		typeof verified.payload.version !== 'number'
	) {
		throw new Error('Invalid calendar feed token');
	}
	return {
		userId: verified.payload.user_id,
		version: verified.payload.version
	};
}
