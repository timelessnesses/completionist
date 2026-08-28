import { getDb } from '$lib/server/db';
import { fcm_tokens, push_subscriptions, task, user_identities } from '$lib/server/db/schema';
import { and, eq, gte, inArray, isNotNull, isNull, lt, ne } from 'drizzle-orm';
import * as web_push from 'web-push';
import { Resend } from 'resend';
import type { TaskNotificationEnvelope } from '$lib/server/task-fanout';
export { GlobalWS } from '$lib/durable_objects/GlobalWS';

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

type ServiceAccount = {
	project_id: string;
	client_email: string;
	private_key: string;
	token_uri: string;
};

type TransportBody = {
	subject: string;
	message: string;
	html: string;
	data?: Record<string, string>;
	recipient_user_ids?: string[];
};

export async function queue(batch: MessageBatch, env: Env, ctx: ExecutionContext) {
	console.log('i am being called!!!!', batch.queue, batch.messages.length, batch.metadata);
	if (batch.queue === 'completionist-queue') {
		await Promise.all(
			batch.messages.map(async (message) => {
				const body = message.body;
				if (isTaskNotificationEnvelope(body)) {
					if (body.deliver.webpush) {
						await env.WEBPUSH_QUEUE.send(body);
					}
					if (body.deliver.email) {
						await env.EMAIL_QUEUE.send(body);
					}
					if (body.deliver.fcm) {
						await env.GCM_QUEUE.send(body);
					}
				} else {
					await env.WS_QUEUE.send(body);
					await env.WEBPUSH_QUEUE.send(body);
					await env.EMAIL_QUEUE.send(body);
					await env.GCM_QUEUE.send(body);
				}
				message.ack();
			})
		);
		return;
	}

	if (batch.queue === 'webpush-queue') {
		await handleWebpushMessage(batch, env, ctx);
	} else if (batch.queue === 'email-queue') {
		await handleEmailMessage(batch, env, ctx);
	} else if (batch.queue === 'gcm-queue') {
		await handleGcmMessage(batch, env, ctx);
	} else if (batch.queue === 'websocket-queue') {
		await handleWebsocketMessage(batch, env, ctx);
	}
}

export async function scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
	const run =
		controller.cron === '0 0 * * *'
			? sendFourteenDayEmailReminders(controller.scheduledTime, env)
			: sendEndingSoonReminders(controller.scheduledTime, env);
	ctx.waitUntil(run);
}

async function sendEndingSoonReminders(scheduledTime: number, env: Env) {
	const db = getDb(env.COMPLETIONIST_DB);
	const from = new Date(scheduledTime);
	const until = new Date(scheduledTime + 10 * 60_000);
	const ending = await db.query.task.findMany({
		where: and(
			isNull(task.deleted_at),
			gte(task.end_at, from),
			lt(task.end_at, until),
			isNull(task.completed),
			ne(task.status, 'cancelled')
		),
		with: { assignees: true }
	});

	for (const item of ending) {
		const key = `reminder:ending:${item.id}:${Math.floor(+item.end_at / 600_000)}`;
		if (await env.COMPLETIONIST_KV.get(key)) continue;
		const minutes = Math.max(1, Math.ceil((+item.end_at - scheduledTime) / 60_000));
		const recipients = uniqueIds([item.owner, ...item.assignees.map((a) => a.user_id)]);
		await env.COMPLETIONIST_QUEUE.send({
			subject: `${item.task_name} ends soon`,
			message: `This task ends in about ${minutes} minute${minutes === 1 ? '' : 's'}.`,
			html: reminderHtml(
				item.task_name,
				`This task ends in about ${minutes} minute${minutes === 1 ? '' : 's'}.`
			),
			data: { type: 'task_ending_soon', task_id: item.id, end_at: String(+item.end_at) },
			recipient_user_ids: recipients
		});
		await env.COMPLETIONIST_KV.put(key, 'sent', { expirationTtl: 86_400 });
	}
}

async function sendFourteenDayEmailReminders(scheduledTime: number, env: Env) {
	const db = getDb(env.COMPLETIONIST_DB);
	const bangkokNow = new Date(scheduledTime + 7 * 3_600_000);
	const targetLocalMidnightUtc = Date.UTC(
		bangkokNow.getUTCFullYear(),
		bangkokNow.getUTCMonth(),
		bangkokNow.getUTCDate() + 14,
		-7
	);
	const due = await db.query.task.findMany({
		where: and(
			isNull(task.deleted_at),
			gte(task.end_at, new Date(targetLocalMidnightUtc)),
			lt(task.end_at, new Date(targetLocalMidnightUtc + 86_400_000)),
			isNull(task.completed),
			ne(task.status, 'cancelled')
		),
		with: { assignees: true }
	});

	const dateKey = bangkokNow.toISOString().slice(0, 10);
	for (const item of due) {
		const key = `reminder:fourteen-days:${item.id}:${dateKey}`;
		if (await env.COMPLETIONIST_KV.get(key)) continue;
		const message = `You have 14 days left to complete "${item.task_name}".`;
		await env.EMAIL_QUEUE.send({
			subject: `14 days left: ${item.task_name}`,
			message,
			html: reminderHtml(item.task_name, message),
			data: { type: 'task_fourteen_days', task_id: item.id, end_at: String(+item.end_at) },
			recipient_user_ids: uniqueIds([item.owner, ...item.assignees.map((a) => a.user_id)])
		});
		await env.COMPLETIONIST_KV.put(key, 'sent', { expirationTtl: 30 * 86_400 });
	}
}

function uniqueIds(ids: string[]) {
	return [...new Set(ids.filter(Boolean))];
}

function reminderHtml(taskName: string, message: string) {
	return `<article style="font-family:system-ui,sans-serif;line-height:1.5;color:#0f172a"><p style="font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:#64748b">Completionist</p><h2>${escapeHtml(taskName)}</h2><p>${escapeHtml(message)}</p></article>`;
}

async function handleWebsocketMessage(batch: MessageBatch, env: Env, _ctx: ExecutionContext) {
	const stub = env.GlobalWS.getByName('global_ws');
	for (const message of batch.messages) {
		const payload =
			typeof message.body === 'string' ? message.body : JSON.stringify(message.body ?? null);
		await stub.fetch('https://global-ws.internal/broadcast', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: payload
		});
		message.ack();
	}
}

async function handleWebpushMessage(batch: MessageBatch, env: Env, _ctx: ExecutionContext) {
	const db = getDb(env.COMPLETIONIST_DB);
	web_push.setVapidDetails(
		'mailto:mooping@timelessnesses.me',
		env.PUBLIC_VAPID_PUBLIC,
		env.VAPID_PRIVATE
	);

	for (const message of batch.messages) {
		const body = normalizeTransportBody(message.body);
		const recipientIds = body.recipient_user_ids ?? [];
		if (recipientIds.length === 0) {
			message.ack();
			continue;
		}

		const subscriptions = await db
			.select()
			.from(push_subscriptions)
			.where(inArray(push_subscriptions.user_id, recipientIds));

		for (const subscription of subscriptions) {
			try {
				await web_push.sendNotification(
					{
						endpoint: subscription.endpoint,
						keys: {
							p256dh: subscription.p256dh,
							auth: subscription.auth
						}
					},
					JSON.stringify({
						title: body.subject,
						body: body.message,
						data: body.data
					})
				);
			} catch (err) {
				console.error('web push send failed:', err);
				if (err instanceof web_push.WebPushError && err.statusCode === 410) {
					await db.delete(push_subscriptions).where(eq(push_subscriptions.id, subscription.id));
				}
			}
		}

		message.ack();
	}
}

async function handleEmailMessage(batch: MessageBatch, env: Env, _ctx: ExecutionContext) {
	const db = getDb(env.COMPLETIONIST_DB);
	const resend = new Resend(env.RESEND_API_KEY);
	const emails: Array<{ from: string; to: string; subject: string; html: string }> = [];
	console.log(`processing ${batch.messages.length} email messages...`);
	for (const message of batch.messages) {
		console.log('processing message:', message.body);
		const body = normalizeTransportBody(message.body);
		const recipientIds = body.recipient_user_ids ?? [];
		if (recipientIds.length === 0) {
			console.log('message has no recipients, skipping...');
			message.ack();
			continue;
		}

		const identities = await db
			.select({
				email: user_identities.email
			})
			.from(user_identities)
			.where(and(inArray(user_identities.user_id, recipientIds), isNotNull(user_identities.email)));
		console.log(`found ${identities.length} identities with email addresses for recipients...`);

		for (const identity of identities) {
			if (!identity.email) continue;
			console.log(`queueing email to ${identity.email}...`);
			emails.push({
				from: 'notify@coworking-calendar.timelessnesses.me',
				to: identity.email,
				subject: body.subject,
				html: body.html
			});
		}

		message.ack();
	}

	if (emails.length > 0) {
		console.log(`sending ${emails.length} emails via Resend...`);
		await resend.batch.send(emails);
		console.log('emails sent successfully.');
	}
}

async function handleGcmMessage(batch: MessageBatch, env: Env, ctx: ExecutionContext) {
	const db = getDb(env.COMPLETIONIST_DB);
	if (batch.messages.length === 0) return;

	const accessToken = await getFcmAccessToken(env);
	const url = `https://fcm.googleapis.com/v1/projects/${env.FCM_PROJECT_ID}/messages:send`;

	for (const message of batch.messages) {
		const body = normalizeTransportBody(message.body);
		const recipientIds = body.recipient_user_ids ?? [];
		if (recipientIds.length === 0) {
			message.ack();
			continue;
		}

		const tokens = await db
			.select()
			.from(fcm_tokens)
			.where(inArray(fcm_tokens.user_id, recipientIds));

		for (const { token } of tokens) {
			const res = await fetch(url, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${accessToken}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					message: {
						token,
						notification: { title: body.subject, body: body.message },
						data: body.data,
						android: { priority: 'HIGH' }
					}
				})
			});

			if (res.status === 404 || res.status === 410) {
				ctx.waitUntil(db.delete(fcm_tokens).where(eq(fcm_tokens.token, token)));
			} else if (!res.ok) {
				console.error(`FCM send failed (${res.status}): ${await res.text()}`);
			}
		}

		message.ack();
	}
}

function normalizeTransportBody(body: unknown): TransportBody {
	if (isTaskNotificationEnvelope(body)) {
		return {
			subject: body.subject,
			message: body.message,
			html: body.html,
			data: body.data,
			recipient_user_ids: body.recipient_user_ids
		};
	}

	if (typeof body === 'string') {
		return {
			subject: 'Completionist',
			message: body,
			html: `<p>${escapeHtml(body)}</p>`
		};
	}

	if (body && typeof body === 'object') {
		const record = body as Record<string, unknown>;
		return {
			subject: typeof record.subject === 'string' ? record.subject : 'Completionist',
			message: typeof record.message === 'string' ? record.message : JSON.stringify(body),
			html:
				typeof record.html === 'string'
					? record.html
					: `<pre>${escapeHtml(JSON.stringify(body, null, 2))}</pre>`,
			data: isRecord(record.data) ? (record.data as Record<string, string>) : undefined,
			recipient_user_ids: Array.isArray(record.recipient_user_ids)
				? record.recipient_user_ids.filter((id): id is string => typeof id === 'string')
				: undefined
		};
	}

	return {
		subject: 'Completionist',
		message: '',
		html: '<p></p>'
	};
}

function isTaskNotificationEnvelope(body: unknown): body is TaskNotificationEnvelope {
	return (
		!!body && typeof body === 'object' && (body as { type?: string }).type === 'task_notification'
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (character) => {
		switch (character) {
			case '&':
				return '&amp;';
			case '<':
				return '&lt;';
			case '>':
				return '&gt;';
			case '"':
				return '&quot;';
			case "'":
				return '&#39;';
			default:
				return character;
		}
	});
}

// Firebase service-account auth

async function getFcmAccessToken(env: Env): Promise<string> {
	const serviceAccount: ServiceAccount = JSON.parse(env.FCM_SERVICE_ACCOUNT);
	const now = Math.floor(Date.now() / 1000);

	const jwt = await signJwt(
		{ alg: 'RS256', typ: 'JWT' },
		{
			iss: serviceAccount.client_email,
			scope: FCM_SCOPE,
			aud: serviceAccount.token_uri,
			iat: now,
			exp: now + 3600
		},
		serviceAccount.private_key
	);

	const res = await fetch(serviceAccount.token_uri, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
			assertion: jwt
		})
	});
	if (!res.ok) throw new Error(`OAuth token exchange failed: ${res.status} ${await res.text()}`);
	const { access_token } = (await res.json()) as { access_token: string };
	return access_token;
}

async function signJwt(header: object, payload: object, privateKeyPem: string): Promise<string> {
	const enc = new TextEncoder();
	const unsigned = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;

	const key = await crypto.subtle.importKey(
		'pkcs8',
		pemToArrayBuffer(privateKeyPem),
		{ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
		false,
		['sign']
	);
	const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(unsigned));
	return `${unsigned}.${base64UrlEncode(signature)}`;
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
	const b64 = pem
		.replace(/\\n/g, '\n')
		.replace(/-----BEGIN PRIVATE KEY-----/, '')
		.replace(/-----END PRIVATE KEY-----/, '')
		.replace(/\s+/g, '');
	const binary = atob(b64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes.buffer;
}

function base64UrlEncode(data: string | ArrayBuffer): string {
	const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
	let binary = '';
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
