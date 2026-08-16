import { verifyJWT } from '$lib/auth';
import { redirect, type Handle } from '@sveltejs/kit';
import { JWTExpired } from 'jose/errors';
import { hashString, issuingNewSessionToken, turnThisToUint8Array } from './api/auth/google-jwt/stuff';
import { and, eq, isNotNull } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { user, user_identities } from '$lib/server/db/schema';

const publicRoutes = ['/login', '/api/auth/google-jwt', '/api/auth/logout'];

export const handle: Handle = async ({ event, resolve }) => {
	const env = event.platform?.env as Env;
	const token = event.cookies.get('token');
	const refresh_token = event.cookies.get('refresh_token') || "";
	if (token) {
		try {
			const user = await verifyJWT(token, env);
			if (user) {
				event.locals.user = user;
			}
		} catch (error) {
			const db = getDb(event.platform?.env.COMPLETIONIST_DB as D1Database);
			const user_data = await db.query.user.findFirst(
				{
					where: and(
						eq(user.refresh_token, await hashString(refresh_token)),
						isNotNull(user_identities.email)
					),
					with: {
						identities: true
					}
				}
			)
			
			if (error instanceof JWTExpired && refresh_token && user_data) {
				// literally guranteed to exist though...
				const newJWT = await issuingNewSessionToken(user_data, db, turnThisToUint8Array(env.JWT_SECRET_BASE64 as string));
				event.cookies.set('token', newJWT, { path: '/', sameSite: 'strict', maxAge: 3600 });
				event.locals.user = await verifyJWT(newJWT, env);
			} else {
				console.error('Error verifying session token:', error);
				event.locals.user = undefined;
				event.cookies.set('token', '', { path: '/', expires: new Date(0) });
				/* return redirect(302, "/login"); */
			}
		}
	}
	const path = event.url.pathname;
	const isPublic = publicRoutes.some((r) => path.startsWith(r));
	if (!isPublic && !event.locals.user) {
		return redirect(302, '/login');
	}
	return resolve(event);
};
