import { DurableObject } from 'cloudflare:workers';
import { getDb } from '../server/db/index';
import { verifyJWT } from '$lib/auth';
import type { CalendarEvent } from '$lib/mock/data';

type LoginRequest = {
    type: 'login';
    jwt: string;
}

type OnlineUsersRequest = {
    type: 'online_users';
}

type UserSendsMessageRequest = {
    type: 'user_sends_message';
    user_id: string;
    message: string;
}

type NewCalendarEventRequest = {
    type: 'new_calendar_event';
    calendar_id: string;
    event: CalendarEvent;
}

type EchoRequest = {
    type: 'echo';
    content: string;
}

type Heartbeat = {
    type: 'ping';
    calledWhen: number;
}

type PreviewSubscribeRequest = {
    type: 'preview_subscribe';
}

type PossibleRequest = LoginRequest | OnlineUsersRequest | UserSendsMessageRequest | NewCalendarEventRequest | EchoRequest | Heartbeat | PreviewSubscribeRequest;


export class GlobalWS extends DurableObject {

    state: DurableObjectState;
    env: Env;
    db: ReturnType<typeof getDb>;

    constructor(state: DurableObjectState, env: Env) {
        console.log("GlobalWS constructor called");
        super(state, env);
        console.log("GlobalWS constructor finished");
        this.state = state;
        this.env = env;
        console.log("GlobalWS constructor finished, initializing db");
        this.db = getDb(env.COMPLETIONIST_DB);
        console.log("GlobalWS constructor finished, db initialized");
    }

    async fetch(request: Request): Promise<Response> {
        // HTTP broadcast endpoint used by server routes (e.g. event creation).
        const url = new URL(request.url);
        if (url.pathname.endsWith('/broadcast') && request.method === 'POST') {
            const payload = (await request.json()) as { type?: string };
            if (!payload || !payload.type) {
                return new Response('missing type', { status: 400 });
            }
            this.broadcast(JSON.stringify(payload));
            return new Response('ok', { status: 200 });
        }
        if (request.headers.get("Upgrade") !== "websocket") {
            return new Response("websocket only!!!!", { status: 426 });
        }
        console.log("hiii")
        const ws = new WebSocketPair();
        const [client, server] = Object.values(ws);
        this.ctx.acceptWebSocket(server);
        return new Response(null, { status: 101, webSocket: client });
    }

    broadcast(message: string, exclude?: WebSocket) {
        this.ctx.getWebSockets().forEach((socket) => {
            if (socket === exclude) return;
            try {
                socket.send(message);
            } catch {
                /* ignore */
            }
        });
    }

    sendCurrentPeople(ws: WebSocket) {
        this.buildPeople().then((people) => {
            try {
                ws.send(JSON.stringify({ type: 'people', people }));
            } catch {
                /* ignore */
            }
        });
    }

    broadcastPeople() {
        this.buildPeople().then((people) => {
            this.broadcast(JSON.stringify({ type: 'people', people }));
        });
    }


    async buildPeople() {
        try {
            const users = await this.db.query.user.findMany();
            const onlineIds = new Set(
                this.ctx
                    .getWebSockets()
                    .map((s) => (s.deserializeAttachment() as { user_id?: string } | null)?.user_id)
                    .filter((x): x is string => typeof x === 'string')
            );
            return users.map((u) => ({
                id: u.id,
                name: u.name,
                owner: false,
                status: onlineIds.has(u.id) ? 'Active' : 'Offline',
                avatar: u.profile_picture_url
            }));
        } catch {
            return [] as unknown[];
        }
    }


    async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
        const data = JSON.parse(message.toString()) as PossibleRequest;
        if (data.type === 'login') {
            const { user_id } = await verifyJWT(data.jwt, this.env);
            ws.send(JSON.stringify({ type: 'user_connected', user_id }));
            ws.serializeAttachment({ user_id });
            this.sendCurrentPeople(ws);
            this.broadcastPeople();
        } else if (data.type === 'preview_subscribe') {
            ws.serializeAttachment({ preview: true });
            ws.send(JSON.stringify({ type: 'preview_subscribed' }));
        } else if (data.type === 'new_calendar_event') {
            this.broadcast(JSON.stringify({ type: 'new_calendar_event', event: data.event }), ws);
        } else if (ws.deserializeAttachment()?.user_id) { 

            if (data.type === 'online_users') {
                ws.send(JSON.stringify({
                    type: 'online_users', users: Array.from(this.ctx.getWebSockets().map((a) => {
                    return a.deserializeAttachment() as { user_id: string };
                })).map(session => session.user_id) }));
            } else if (data.type === 'user_sends_message') {
                this.ctx.getWebSockets().find((socket) => {
                    const session = socket.deserializeAttachment() as { user_id: string };
                    return session.user_id === data.user_id && socket !== ws;
                })?.send(JSON.stringify({ type: 'user_message', user_id: data.user_id, message: data.message }));
            } else if (data.type === 'echo') {
                ws.send(JSON.stringify({ type: 'echoResponse', content: data.content }));
                console.log('Echo request received.');
            }
        }  else if (data.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', calledArrived: Date.now(), calledWhen: data.calledWhen }));
        }
    }

    async webSocketClose(ws: WebSocket, code: number, reason: string, _: boolean): Promise<void> {
        const user_id = ws.deserializeAttachment()?.user_id;
        if (user_id) {
            ws.serializeAttachment(null);
            this.ctx.getWebSockets().forEach((socket) => {
                if (socket.deserializeAttachment()?.user_id === user_id) return;
                socket.send(JSON.stringify({ type: 'user_disconnected', user_id }));
            });
            this.broadcastPeople();
        }
    }


}