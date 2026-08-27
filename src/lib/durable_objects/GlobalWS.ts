import { DurableObject } from 'cloudflare:workers';
import { getDb } from '../server/db/index';
type OnlineUsersRequest = {
	type: 'online_users';
};

type Heartbeat = {
	type: 'ping';
	calledWhen: number;
};

type PreviewSubscribeRequest = {
	type: 'preview_subscribe';
};

type PossibleRequest = OnlineUsersRequest | Heartbeat | PreviewSubscribeRequest;

type ClientSession = {
	user_id?: string;
	preview?: boolean;
};

type DirectMessageEvent = {
	type: 'direct_message';
	message: {
		id: string;
		from_user_id: string;
		to_user_id: string;
		message: string | null;
		created_at: string | number | Date;
		from_user?: { id: string; name: string; profile_picture_url?: string | null };
		to_user?: { id: string; name: string; profile_picture_url?: string | null };
		attachments?: Array<{
			id: string;
			file_name: string;
			file_url: string;
			file_key: string;
			content_type?: string | null;
			size?: number | null;
		}>;
	};
};

export class GlobalWS extends DurableObject {
	state: DurableObjectState;
	env: Env;
	db: ReturnType<typeof getDb>;

	constructor(state: DurableObjectState, env: Env) {
		console.log('GlobalWS constructor called');
		super(state, env);
		console.log('GlobalWS constructor finished');
		this.state = state;
		this.env = env;
		console.log('GlobalWS constructor finished, initializing db');
		this.db = getDb(env.COMPLETIONIST_DB);
		console.log('GlobalWS constructor finished, db initialized');
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname.endsWith('/broadcast') && request.method === 'POST') {
			const text = await request.text().catch(() => '');
			try {
				this.broadcastJSON(JSON.parse(text));
			} catch {
				this.broadcastShouldRefetch();
			}
			return new Response('ok', { status: 200 });
		}
		if (url.pathname.endsWith('/direct-message') && request.method === 'POST') {
			const payload = (await request.json()) as DirectMessageEvent;
			if (payload?.type !== 'direct_message' || !payload.message) {
				return new Response('missing direct message', { status: 400 });
			}
			this.broadcastDirectMessage(payload);
			return new Response('ok', { status: 200 });
		}
		if (request.headers.get('Upgrade') !== 'websocket') {
			return new Response('websocket only!!!!', { status: 426 });
		}
		const ws = new WebSocketPair();
		const [client, server] = Object.values(ws);
		this.ctx.acceptWebSocket(server);
		const userId = request.headers.get('x-completionist-user-id');
		if (userId) {
			server.serializeAttachment({ user_id: userId });
			this.ctx.waitUntil(this.sendCurrentPeople(server));
			this.ctx.waitUntil(this.broadcastPeople());
		}
		return new Response(null, { status: 101, webSocket: client });
	}

	broadcastJSON(payload: unknown, exclude?: WebSocket) {
		const message = JSON.stringify(payload);
		this.ctx.getWebSockets().forEach((socket) => {
			if (socket === exclude) return;
			try {
				socket.send(message);
			} catch {
				/* ignore */
			}
		});
	}

	broadcastShouldRefetch(exclude?: WebSocket) {
		this.broadcastJSON({ type: 'shouldRefetch' }, exclude);
	}

	broadcastDirectMessage(payload: DirectMessageEvent) {
		const participantIds = new Set([payload.message.from_user_id, payload.message.to_user_id]);
		this.ctx.getWebSockets().forEach((socket) => {
			const session = socket.deserializeAttachment() as ClientSession | null;
			if (!session?.user_id || !participantIds.has(session.user_id)) return;
			try {
				socket.send(JSON.stringify(payload));
			} catch {
				/* ignore */
			}
		});
	}

	async sendCurrentPeople(ws: WebSocket) {
		const people = await this.buildPeople();
		try {
			ws.send(JSON.stringify({ type: 'people', people }));
		} catch {
			/* ignore */
		}
	}

	async broadcastPeople() {
		const people = await this.buildPeople();
		this.broadcastJSON({ type: 'people', people });
	}

	async buildPeople() {
		try {
			const users = await this.db.query.user.findMany();
			const onlineIds = new Set(
				this.ctx
					.getWebSockets()
					.map((s) => (s.deserializeAttachment() as ClientSession | null)?.user_id)
					.filter((x): x is string => typeof x === 'string')
			);
			return users.map((u) => ({
				id: u.id,
				name: u.name,
				owner: !!u.owner,
				status: onlineIds.has(u.id) ? 'Active' : 'Offline',
				avatar: u.profile_picture_url
			}));
		} catch {
			return [] as unknown[];
		}
	}

	async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
		const text = typeof message === 'string' ? message : new TextDecoder().decode(message);
		let data: PossibleRequest;
		try {
			data = JSON.parse(text) as PossibleRequest;
		} catch {
			return;
		}

		if (data.type === 'ping') {
			ws.send(
				JSON.stringify({ type: 'pong', calledArrived: Date.now(), calledWhen: data.calledWhen })
			);
			return;
		}

		if (data.type === 'preview_subscribe') {
			const session = (ws.deserializeAttachment() as ClientSession | null) ?? {};
			ws.serializeAttachment({ ...session, preview: true });
			ws.send(JSON.stringify({ type: 'preview_subscribed' }));
		} else if (data.type === 'online_users') {
			await this.sendCurrentPeople(ws);
		}
	}

	async webSocketClose(ws: WebSocket, code: number, reason: string, _: boolean): Promise<void> {
		const user_id = (ws.deserializeAttachment() as ClientSession | null)?.user_id;
		if (user_id) {
			ws.serializeAttachment(null);
			this.ctx.getWebSockets().forEach((socket) => {
				if ((socket.deserializeAttachment() as ClientSession | null)?.user_id === user_id) return;
				socket.send(JSON.stringify({ type: 'user_disconnected', user_id }));
			});
			await this.broadcastPeople();
		}
	}
}
