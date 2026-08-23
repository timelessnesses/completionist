import { getDb } from '$lib/server/db';
import { user_identities, fcm_tokens } from '$lib/server/db/schema';
import { isNotNull, eq } from 'drizzle-orm/sqlite-core/expressions';
import * as web_push from 'web-push';
import { Resend } from 'resend';
export { GlobalWS } from '$lib/durable_objects/GlobalWS';

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

type ServiceAccount = {
	project_id: string;
	client_email: string;
	private_key: string;
	token_uri: string;
};

export async function queue(batch: MessageBatch, env: Env, ctx: ExecutionContext) {
	// const db = getDb(env.COMPLETIONIST_DB);
	// const subscriptions = await db.query.push_subscriptions.findMany();
	// web_push.setVapidDetails("mailto:mooping@timelessnesses.me", env.VAPID_PUBLIC, env.VAPID_PRIVATE)
	if (batch.queue === 'completionist-queue') {
		await Promise.all(
			batch.messages.map(async (message) => {
				await env.WS_QUEUE.send(message.body);
				await env.WEBPUSH_QUEUE.send(message.body);
				await env.EMAIL_QUEUE.send(message.body);
				await env.GCM_QUEUE.send(message.body);
				message.ack();
			})
		);
	} else if (batch.queue === 'webpush-queue') {
		await handleWebpushMessage(batch, env, ctx);
	} else if (batch.queue === 'email-queue') {
		await handleEmailMessage(batch, env, ctx);
	} else if (batch.queue === 'gcm-queue') {
		await handleGcmMessage(batch, env, ctx);
	} else if (batch.queue === 'websocket-queue') {
		await handleWebsocketMessage(batch, env, ctx);
	}
}

async function handleWebsocketMessage(batch: MessageBatch, env: Env, ctx: ExecutionContext) {
	const stub = env.GlobalWS.getByName('global_ws');
	for (const message of batch.messages) {
		await stub.fetch('https://global-ws.internal/broadcast', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(message.body)
		});
		message.ack();
	}
}

async function handleWebpushMessage(batch: MessageBatch, env: Env, ctx: ExecutionContext) {
	const db = getDb(env.COMPLETIONIST_DB);
	const allSubscriptions = await db.query.push_subscriptions.findMany();
	web_push.setVapidDetails(
		'mailto:mooping@timelessnesses.me',
		env.PUBLIC_VAPID_PUBLIC,
		env.VAPID_PRIVATE
	);
	for (const message of batch.messages) {
		for (const subscription of allSubscriptions) {
			await web_push.sendNotification(
				{
					endpoint: subscription.endpoint,
					keys: {
						p256dh: subscription.p256dh,
						auth: subscription.auth
					}
				},
				JSON.stringify(message.body)
			);
		}
		message.ack();
	}
}

async function handleEmailMessage(batch: MessageBatch, env: Env, ctx: ExecutionContext) {
	const db = getDb(env.COMPLETIONIST_DB);
	const user_identities_email = await db.query.user_identities.findMany({
		where: {
			email: isNotNull(user_identities.email)
		}
	});
	const resend = new Resend(env.RESEND_API_KEY);
	let emails = [];
	for (const message of batch.messages) {
		emails.push({
			from: 'completionist@timelessnesses.me',
			to: user_identities_email[0].email as string,
			subject: (message.body as { subject: string }).subject,
			html: `<p>${(message.body as { message: string }).message}</p>`
		});
	}
	await resend.batch.send(emails);
}

async function handleGcmMessage(batch: MessageBatch, env: Env, ctx: ExecutionContext) {
	const db = getDb(env.COMPLETIONIST_DB);
	const tokens = await db.select().from(fcm_tokens);
	if (tokens.length === 0 || batch.messages.length === 0) return;

	const accessToken = await getFcmAccessToken(env);
	const url = `https://fcm.googleapis.com/v1/projects/${env.FCM_PROJECT_ID}/messages:send`;

	for (const message of batch.messages) {
		const body = message.body as {
			subject?: string;
			message?: string;
			data?: Record<string, string>;
		};
		const title = body.subject ?? 'Completionist';
		const text = body.message ?? '';

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
						notification: { title, body: text },
						data: body.data,
						android: { priority: 'HIGH' }
					}
				})
			});

			// Clean up tokens that are no longer valid so we stop sending to them.
			if (res.status === 404 || res.status === 410) {
				ctx.waitUntil(db.delete(fcm_tokens).where(eq(fcm_tokens.token, token)));
			} else if (!res.ok) {
				console.error(`FCM send failed (${res.status}): ${await res.text()}`);
			}
		}
		message.ack();
	}
}

// ── Firebase service-account auth ────────────────────────────────────────

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
