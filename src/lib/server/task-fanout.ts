import type { LocalNotificationSchema } from '@capacitor/local-notifications';

type TaskLike = {
	id: string;
	task_name: string;
	description?: string | null;
	start_at: Date | number | string;
	end_at: Date | number | string;
	all_day: 0 | 1;
	color: { r: number; g: number; b: number };
	owner: string;
	completed?: Date | number | string | null;
	assignees?: Array<{ user_id: string }>;
};

export type SerializedTaskNotification = {
	id: string;
	task_name: string;
	description: string | null;
	start_at: number;
	end_at: number;
	all_day: 0 | 1;
	color: { r: number; g: number; b: number };
	owner: string;
	completed: number | null;
	recipient_user_ids: string[];
};

export type TaskNotificationAction = 'created' | 'updated' | 'commented';

export type TaskNotificationEnvelope = {
	type: 'task_notification';
	action: TaskNotificationAction;
	task: SerializedTaskNotification;
	subject: string;
	message: string;
	html: string;
	data: Record<string, string>;
	recipient_user_ids: string[];
	deliver: {
		webpush: boolean;
		email: boolean;
		fcm: boolean;
	};
};

const HTML_ESCAPE = /[&<>"']/g;

export function serializeTaskNotification(task: TaskLike): SerializedTaskNotification {
	const recipient_user_ids = uniqueUserIds([
		task.owner,
		...(task.assignees ?? []).map((assignee) => assignee.user_id)
	]);

	return {
		id: task.id,
		task_name: task.task_name,
		description: task.description ?? null,
		start_at: +new Date(task.start_at),
		end_at: +new Date(task.end_at),
		all_day: task.all_day,
		color: task.color,
		owner: task.owner,
		completed: task.completed ? +new Date(task.completed) : null,
		recipient_user_ids
	};
}

export function buildTaskNotificationEnvelope(
	task: TaskLike,
	action: TaskNotificationAction,
	actorName?: string
): TaskNotificationEnvelope {
	const serialized = serializeTaskNotification(task);
	const dueDate = new Date(task.end_at);
	const dueLabel = dueDate.toLocaleString('en-US', {
		dateStyle: 'medium',
		timeStyle: task.all_day ? undefined : 'short'
	});
	const actionLabel = action === 'created' ? 'created' : action === 'updated' ? 'updated' : 'commented on';
	const subject =
		action === 'commented'
			? `New comment on ${task.task_name}`
			: `${task.task_name} was ${actionLabel}`;
	const message = actorName
		? `${actorName} ${action === 'commented' ? 'commented on' : actionLabel} "${task.task_name}".`
		: `"${task.task_name}" was ${actionLabel}.`;
	const html = `
		<article style="font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.5;color:#0f172a">
			<p style="margin:0 0 10px;font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:#64748b">Completionist</p>
			<h2 style="margin:0 0 8px;font-size:20px">${escapeHtml(subject)}</h2>
			<p style="margin:0 0 12px">${escapeHtml(message)}</p>
			<div style="padding:12px 14px;border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc">
				<p style="margin:0 0 4px;font-weight:600">${escapeHtml(task.task_name)}</p>
				<p style="margin:0;color:#475569">${escapeHtml(dueLabel)}</p>
				${task.description ? `<p style="margin:8px 0 0;color:#334155">${escapeHtml(task.description)}</p>` : ''}
			</div>
		</article>
	`.trim();

	return {
		type: 'task_notification',
		action,
		task: serialized,
		subject,
		message,
		html,
		data: {
			task_id: serialized.id,
			action,
			task_name: serialized.task_name,
			completed: String(serialized.completed ?? ''),
			end_at: String(serialized.end_at)
		},
		recipient_user_ids: serialized.recipient_user_ids,
		deliver: {
			webpush: true,
			email: true,
			fcm: true
		}
	};
}

function uniqueUserIds(ids: Array<string | null | undefined>): string[] {
	return [...new Set(ids.filter((id): id is string => typeof id === 'string' && !!id.trim()).map((id) => id.trim()))];
}

function escapeHtml(value: string): string {
	return value.replace(HTML_ESCAPE, (character) => {
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

