import { dev } from '$app/environment';
import { error, json } from '@sveltejs/kit';

type DebugEventRequest = {
	id?: string;
	taskName?: string;
};

export const POST = async ({ request, platform, url }) => {
	const isLocalHost = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
	const isWranglerDev = !dev && isLocalHost && !!platform?.env;
	if (!dev && !isWranglerDev) throw error(404, 'Not found');

	const body = (await request.json().catch(() => ({}))) as DebugEventRequest;
	const startedAt = Date.now();
	const startsAt = startedAt + 10_000;
	const payload = {
		type: 'preview_debug_event',
		event: {
			id: body.id?.slice(0, 128) || 'preview-debug-event',
			taskName: body.taskName?.trim().slice(0, 160) || 'Preview test event'
		},
		startedAt,
		startsAt,
		introEndsAt: startsAt + 2_400,
		endsAt: startsAt + 92_400
	};

	const response = await (platform?.env as Env).GlobalWS.getByName('global_ws').fetch(
		'https://global-ws.internal/preview-debug',
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		}
	);
	if (!response.ok) throw error(502, 'Could not broadcast preview debug event');
	return json({ ok: true, payload });
};
