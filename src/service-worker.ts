/// <reference lib="webworker" />
/// <reference lib="webworker.iterable" />

const sw = globalThis as unknown as ServiceWorkerGlobalScope;

sw.addEventListener('install', (event: ExtendableEvent) => {
	event.waitUntil(sw.skipWaiting());
});

sw.addEventListener('activate', (event: ExtendableEvent) => {
	event.waitUntil(
		Promise.all([
			caches
				.keys()
				.then((keys) =>
					Promise.all(
						keys
							.filter((key) => key.startsWith('completionist-precache-'))
							.map((key) => caches.delete(key))
					)
				),
			sw.clients.claim()
		])
	);
});

function notificationPath(data: Record<string, unknown>, fallbackUrl: unknown) {
	if (
		typeof fallbackUrl === 'string' &&
		fallbackUrl.startsWith('/') &&
		!fallbackUrl.startsWith('//')
	) {
		return fallbackUrl;
	}
	if (typeof data.url === 'string' && data.url.startsWith('/') && !data.url.startsWith('//')) {
		return data.url;
	}
	if (data.type === 'direct_message' || (data.message_id && data.from_user_id)) {
		const query = new URLSearchParams({ notification: 'dm' });
		if (data.from_user_id) query.set('user_id', String(data.from_user_id));
		if (data.message_id) query.set('message_id', String(data.message_id));
		return `/?${query}`;
	}
	const taskId = data.task_id || data.taskId;
	return taskId
		? `/?${new URLSearchParams({ notification: 'task', task_id: String(taskId) })}`
		: '/';
}

sw.addEventListener('push', (event: PushEvent) => {
	const payload = event.data?.json() ?? {};
	const metadata =
		payload.data && typeof payload.data === 'object'
			? (payload.data as Record<string, unknown>)
			: {};
	const url = notificationPath(metadata, payload.url);
	const tag = metadata.message_id
		? `direct-message-${metadata.message_id}`
		: metadata.task_id
			? `task-${metadata.task_id}-${metadata.action || metadata.type || 'notification'}`
			: undefined;

	event.waitUntil(
		sw.registration.showNotification(payload.title || 'Completionist', {
			body: payload.body || '',
			tag,
			renotify: false,
			data: { ...metadata, url }
		})
	);
});

sw.addEventListener('notificationclick', (event: NotificationEvent) => {
	event.notification.close();
	const target = new URL(event.notification.data?.url || '/', sw.location.origin).href;
	event.waitUntil(
		(async () => {
			const windows = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
			for (const client of windows) {
				if (new URL(client.url).origin !== sw.location.origin) continue;
				await client.navigate(target);
				return client.focus();
			}
			return sw.clients.openWindow(target);
		})()
	);
});
