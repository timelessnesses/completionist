import * as jose from 'jose';
import { env as envPrivate } from '$env/dynamic/private';

export type UserJWT = {
    name: string;
    nickname: string;
    role: 'user' | 'admin';
    refresh_token: string;
}

export async function verifyJWT(
	token: string,
	env: Env
): Promise<{ email: string; name: string; nickname: string; admin: boolean }> {
    const secret = env.JWT_SECRET_BASE64
	if (!secret) {
		throw new Error('Shared secret is not set in environment variables.');
	}

	const { payload } = await jose.jwtVerify<UserJWT>(token, turnThisToUint8Array(secret), {
		algorithms: ['HS256']
	});

	if (envPrivate.ADMIN_EMAIL && envPrivate.ADMIN_EMAIL === payload.sub) {
		payload.role = 'admin';
	}

	if (!payload) {
		throw new Error('Invalid JWT token.');
	}

	return {
		email: payload.sub as string,
		name: payload.name,
		nickname: payload.nickname,
		admin: payload.role === 'admin'
	};
}
function turnThisToUint8Array(secret: string): Uint8Array {
	const uint8Array = Uint8Array.from(atob(secret), (c) => c.charCodeAt(0));
	return uint8Array;
}