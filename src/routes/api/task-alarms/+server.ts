import { taskAlarmsForUser } from '$lib/server/task-alarms';
import { decodeBase64Secret } from '$lib/server/auth-token';
import { error, json } from '@sveltejs/kit';
import { SignJWT } from 'jose';

export const GET = async ({ locals, platform }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	const env = platform?.env as Env;
	const syncToken = await new SignJWT({ purpose: 'task_alarm_sync', user_id: locals.user.user_id })
		.setProtectedHeader({ alg: 'HS256' })
		.setIssuer('completionist')
		.setAudience('task-alarm-sync')
		.setIssuedAt()
		.setExpirationTime('90d')
		.sign(decodeBase64Secret(env.JWT_SECRET_BASE64));
	return json({
		alarms: await taskAlarmsForUser(env, locals.user.user_id),
		sync_token: syncToken,
		refresh_url: '/api/task-alarms/refresh'
	});
};
