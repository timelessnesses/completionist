type NotificationData = Record<string, unknown> | null | undefined;

function stringValue(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function notificationPath(data: NotificationData): string {
	if (!data) return '/';
	const explicitUrl = stringValue(data.url);
	if (explicitUrl?.startsWith('/') && !explicitUrl.startsWith('//')) return explicitUrl;

	const type = stringValue(data.type);
	const messageId = stringValue(data.message_id);
	const fromUserId = stringValue(data.from_user_id) ?? stringValue(data.user_id);
	if (type === 'direct_message' || (messageId && fromUserId)) {
		const query = new URLSearchParams({ notification: 'dm' });
		if (fromUserId) query.set('user_id', fromUserId);
		if (messageId) query.set('message_id', messageId);
		return `/?${query}`;
	}

	const taskId = stringValue(data.task_id) ?? stringValue(data.taskId);
	if (taskId) {
		return `/?${new URLSearchParams({ notification: 'task', task_id: taskId })}`;
	}

	return '/';
}
