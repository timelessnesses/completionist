import { verifyJWT } from '$lib/auth';
import { redirect, type Handle } from '@sveltejs/kit';
import { JWTExpired } from 'jose/errors';
import {
	hashString,
	issuingNewSessionToken,
	turnThisToUint8Array
} from './routes/api/auth/google-jwt/stuff';
import { and, eq, gt, isNotNull, lt } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { user, user_identities } from '$lib/server/db/schema';

const publicRoutes = [
	'/login',
	'/api/auth/google-jwt',
	'/api/auth/logout',
	'/api/ws',
	'/api/task-alarms/refresh',
	'/calendar.ics',
	'/preview'
];

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.request_start_time = Date.now();
	const env = event.platform?.env as Env;
	const token = event.cookies.get('token');
	let refresh_token = event.cookies.get('refresh_token') || '';
	const db = getDb(env.COMPLETIONIST_DB as D1Database);
	if (token) {
		try {
			const user = await verifyJWT(token, env);
			if (user) {
				console.log('Session token verified.');
				event.locals.user = user;
			}
		} catch (error) {
			console.error('Error verifying session token:', error);
			let user_data:
				| (typeof user.$inferSelect & { identities: (typeof user_identities.$inferSelect)[] })
				| undefined;
			let db: ReturnType<typeof getDb> | undefined;
			if (error instanceof JWTExpired && refresh_token) {
				try {
					db = getDb(env.COMPLETIONIST_DB as D1Database);
					user_data = await db.query.user.findFirst({
						where: and(
							eq(user.refresh_token, await hashString(refresh_token)),
							gt(user.refresh_token_expiration, new Date())
						),
						with: {
							identities: {
								where: isNotNull(user_identities.email)
							}
						}
					});
				} catch (dbError) {
					console.error('Error looking up user by refresh token:', dbError);
					refresh_token = '';
				}
			}

			if (error instanceof JWTExpired && refresh_token && user_data && db) {
				console.log('JWT expired, but refresh token is valid. Issuing new session token...');
				// literally guranteed to exist though...
				const newJWT = await issuingNewSessionToken(
					user_data,
					db,
					turnThisToUint8Array(env.JWT_SECRET_BASE64 as string)
				);
				event.cookies.set('token', newJWT, { path: '/', sameSite: 'strict', maxAge: 3600 });
				event.locals.user = await verifyJWT(newJWT, env);
				console.log('New session token issued.');
			} else {
				console.error('Error verifying session token:', error);
				removeAuthInfo(event);
				/* return redirect(302, "/login"); */
			}
		}
	} else if (refresh_token) {
		await reissueViaRefreshToken(event, refresh_token, getDb(env.COMPLETIONIST_DB as D1Database), env);
	}
	const path = event.url.pathname;
	const isPublic = publicRoutes.some((r) => path.startsWith(r));
	if (!isPublic && !event.locals.user) {
		return redirect(302, '/login');
	}
	return await resolve(event, {
		transformPageChunk: ({ html }) =>
			html.replace('%server-timing%', `${Date.now() - event.locals.request_start_time}`)
	});
};

async function reissueViaRefreshToken(event: Parameters<Handle>["0"]["event"], refresh_token: string, db: ReturnType<typeof getDb>, env: Env) { 
	const user_data = await db.query.user.findFirst({
		where: and(
			eq(user.refresh_token, await hashString(refresh_token)),
			gt(user.refresh_token_expiration, new Date())
		),
		with: {
			identities: {
				where: isNotNull(user_identities.email)
			}
		}
	});
	if (user_data) {
		console.log('Refresh token verified.');
		const newJWT = await issuingNewSessionToken(
			user_data,
			db,
			turnThisToUint8Array(env.JWT_SECRET_BASE64 as string)
		);
		event.cookies.set('token', newJWT, { path: '/', sameSite: 'strict', maxAge: 3600 });
		event.locals.user = await verifyJWT(newJWT, env);
		console.log('New session token issued.');
	} else {
		console.error('Error issuing new session token.');
		removeAuthInfo(event);
	}
}

function removeAuthInfo(event: Parameters<Handle>["0"]["event"]) {
	event.locals.user = undefined;
	event.cookies.set('token', '', { path: '/', expires: new Date(0) });
	event.cookies.set('refresh_token', '', { path: '/', expires: new Date(0) });
}