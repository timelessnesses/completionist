import { getDb } from '$lib/server/db';
import { direct_message, direct_message_attachment, user } from '$lib/server/db/schema';
import { and, asc, eq, or } from 'drizzle-orm';
import { json, error as svelteError } from '@sveltejs/kit';

type AttachmentInput = {
	file_name: string;
	file_key: string;
	file_url?: string;
	content_type?: string | null;
	size?: number | null;
};

type CreateMessageBody = {
	to_user_id: string;
	message?: string | null;
	attachments?: AttachmentInput[];
};

type DirectMessageRow = typeof direct_message.$inferSelect & {
	from_user?: Pick<typeof user.$inferSelect, 'id' | 'name' | 'profile_picture_url'>;
	to_user?: Pick<typeof user.$inferSelect, 'id' | 'name' | 'profile_picture_url'>;
	attachments?: Array<typeof direct_message_attachment.$inferSelect>;
};

export const GET = async ({ url, platform, locals }) => {
	if (!locals.user) {
		throw svelteError(401, 'Unauthorized');
	}

	const peerId = url.searchParams.get('user_id')?.trim();
	if (!peerId) {
		throw svelteError(400, 'user_id is required');
	}

	const db = getDb((platform?.env as Env).COMPLETIONIST_DB);
	await assertUserExists(db, peerId);

	const rows = await db.query.direct_message.findMany({
		where: or(
			and(
				eq(direct_message.from_user_id, locals.user.user_id),
				eq(direct_message.to_user_id, peerId)
			),
			and(
				eq(direct_message.from_user_id, peerId),
				eq(direct_message.to_user_id, locals.user.user_id)
			)
		),
		orderBy: asc(direct_message.created_at),
		with: {
			from_user: {
				columns: {
					id: true,
					name: true,
					profile_picture_url: true
				}
			},
			to_user: {
				columns: {
					id: true,
					name: true,
					profile_picture_url: true
				}
			},
			attachments: true
		}
	});

	return json(rows.map(serializeDirectMessage), { status: 200 });
};

export const POST = async ({ request, platform, locals }) => {
	if (!locals.user) {
		throw svelteError(401, 'Unauthorized');
	}

	let body: CreateMessageBody;
	try {
		body = await request.json();
	} catch {
		throw svelteError(400, 'Invalid JSON');
	}

	const toUserId = body.to_user_id?.trim();
	const text = body.message?.trim() ?? '';
	const attachments = normalizeAttachments(body.attachments ?? []);
	if (!toUserId) {
		throw svelteError(400, 'to_user_id is required');
	}
	if (toUserId === locals.user.user_id) {
		throw svelteError(400, 'Cannot send a message to yourself');
	}
	if (!text && attachments.length === 0) {
		throw svelteError(400, 'Message text or at least one attachment is required');
	}

	const env = platform?.env as Env;
	const db = getDb(env.COMPLETIONIST_DB);
	const recipient = await assertUserExists(db, toUserId);

	const inserted = await db
		.insert(direct_message)
		.values({
			from_user_id: locals.user.user_id,
			to_user_id: toUserId,
			message: text || null
		})
		.returning();
	const saved = inserted[0];
	if (!saved) {
		throw svelteError(500, 'Failed to create message');
	}

	if (attachments.length > 0) {
		await db.insert(direct_message_attachment).values(
			attachments.map((attachment) => ({
				message_id: saved.id,
				file_name: attachment.file_name,
				file_key: attachment.file_key,
				file_url:
					attachment.file_url ?? `/api/files?key=${encodeURIComponent(attachment.file_key)}`,
				content_type: attachment.content_type ?? null,
				size: attachment.size ?? null
			}))
		);
	}

	const row = await fetchDirectMessage(db, saved.id);
	const serialized = serializeDirectMessage(row ?? saved);

	await Promise.allSettled([
		broadcastDirectMessage(env, serialized),
		queueDirectMessageNotifications(env, serialized, locals.user.name, recipient.name)
	]);

	return json(serialized, { status: 201 });
};

async function assertUserExists(db: ReturnType<typeof getDb>, id: string) {
	const found = await db.query.user.findFirst({
		where: eq(user.id, id),
		columns: {
			id: true,
			name: true,
			profile_picture_url: true
		}
	});
	if (!found) {
		throw svelteError(404, 'User not found');
	}
	return found;
}

async function fetchDirectMessage(db: ReturnType<typeof getDb>, id: string) {
	return db.query.direct_message.findFirst({
		where: eq(direct_message.id, id),
		with: {
			from_user: {
				columns: {
					id: true,
					name: true,
					profile_picture_url: true
				}
			},
			to_user: {
				columns: {
					id: true,
					name: true,
					profile_picture_url: true
				}
			},
			attachments: true
		}
	});
}

function normalizeAttachments(attachments: AttachmentInput[]): AttachmentInput[] {
	return attachments
		.filter((attachment) => attachment.file_name?.trim() && attachment.file_key?.trim())
		.slice(0, 6)
		.map((attachment) => ({
			file_name: attachment.file_name.trim(),
			file_key: attachment.file_key.trim(),
			file_url: attachment.file_url?.trim(),
			content_type: attachment.content_type?.trim() || null,
			size:
				typeof attachment.size === 'number' && Number.isFinite(attachment.size)
					? attachment.size
					: null
		}));
}

function serializeDirectMessage(row: DirectMessageRow) {
	return {
		id: row.id,
		from_user_id: row.from_user_id,
		to_user_id: row.to_user_id,
		message: row.message,
		created_at: +new Date(row.created_at),
		from_user: row.from_user,
		to_user: row.to_user,
		attachments: (row.attachments ?? []).map((attachment) => ({
			id: attachment.id,
			file_name: attachment.file_name,
			file_url: attachment.file_url,
			file_key: attachment.file_key,
			content_type: attachment.content_type,
			size: attachment.size,
			created_at: +new Date(attachment.created_at)
		}))
	};
}

async function broadcastDirectMessage(
	env: Env,
	message: ReturnType<typeof serializeDirectMessage>
) {
	const stub = env.GlobalWS.getByName('global_ws');
	await stub.fetch('https://global-ws.internal/direct-message', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ type: 'direct_message', message })
	});
}

async function queueDirectMessageNotifications(
	env: Env,
	message: ReturnType<typeof serializeDirectMessage>,
	senderName: string,
	recipientName: string
) {
	const attachmentCount = message.attachments.length;
	const bodyText =
		message.message ||
		(attachmentCount === 1
			? 'Sent you an attachment.'
			: `Sent you ${attachmentCount} attachments.`);
	const subject = `New message from ${senderName}`;
	const envelope = {
		subject,
		message: bodyText,
		html: `
			<article style="font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.5;color:#0f172a">
				<p style="margin:0 0 10px;font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:#64748b">Completionist</p>
				<h2 style="margin:0 0 8px;font-size:20px">${escapeHtml(subject)}</h2>
				<p style="margin:0 0 12px">Hi ${escapeHtml(recipientName)}, ${escapeHtml(senderName)} sent you a message.</p>
				<div style="padding:12px 14px;border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc">
					<p style="margin:0;color:#334155">${escapeHtml(bodyText)}</p>
					${attachmentCount ? `<p style="margin:8px 0 0;color:#64748b">${attachmentCount} attachment${attachmentCount === 1 ? '' : 's'}</p>` : ''}
				</div>
			</article>
		`.trim(),
		data: {
			type: 'direct_message',
			message_id: message.id,
			from_user_id: message.from_user_id,
			to_user_id: message.to_user_id
		},
		recipient_user_ids: [message.to_user_id]
	};

	await Promise.all([
		env.WEBPUSH_QUEUE.send(envelope),
		env.EMAIL_QUEUE.send(envelope),
		env.GCM_QUEUE.send(envelope)
	]);
}

function escapeHtml(value: string) {
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
