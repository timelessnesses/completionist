import { decodeBase64Secret } from '$lib/server/auth-token';
import { taskAlarmsForUser, validateTaskAlarm } from '$lib/server/task-alarms';
import { error, json } from '@sveltejs/kit';
import { jwtVerify, SignJWT } from 'jose';

type RefreshBody = {
	task_id?: string;
	rule_key?: string;
	occurrence_at?: number;
};

export const POST = async ({ request, platform }) => {
	const authorization = request.headers.get('authorization');
	if (!authorization?.startsWith('Bearer ')) throw error(401, 'Missing alarm sync token');
	const env = platform?.env as Env;
	const secret = decodeBase64Secret(env.JWT_SECRET_BASE64);
	let userId: string;
	try {
		const verified = await jwtVerify(authorization.slice(7), secret, {
			issuer: 'completionist',
			audience: 'task-alarm-sync'
		});
		if (
			verified.payload.purpose !== 'task_alarm_sync' ||
			typeof verified.payload.user_id !== 'string'
		) {
			throw new Error('Wrong token purpose');
		}
		userId = verified.payload.user_id;
	} catch {
		throw error(401, 'Invalid or expired alarm sync token');
	}

	let body: RefreshBody = {};
	try {
		body = await request.json();
	} catch {
		// Boot and package-replaced refreshes intentionally have no current occurrence.
	}
	const hasCurrent =
		typeof body.task_id === 'string' &&
		typeof body.rule_key === 'string' &&
		typeof body.occurrence_at === 'number';
	const currentAlarm = hasCurrent
		? await validateTaskAlarm(env, userId, {
				task_id: body.task_id!,
				rule_key: body.rule_key!,
				occurrence_at: body.occurrence_at!
			})
		: null;
	const nextToken = await new SignJWT({ purpose: 'task_alarm_sync', user_id: userId })
		.setProtectedHeader({ alg: 'HS256' })
		.setIssuer('completionist')
		.setAudience('task-alarm-sync')
		.setIssuedAt()
		.setExpirationTime('90d')
		.sign(secret);

	return json({
		current_valid: hasCurrent ? !!currentAlarm : null,
		current_alarm: currentAlarm,
		alarms: await taskAlarmsForUser(env, userId, Date.now() + 1_000),
		sync_token: nextToken
	});
};
