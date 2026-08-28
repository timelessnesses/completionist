let socket: WebSocket | undefined;
let socketPromise: Promise<WebSocket> | undefined;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let reconnectAttempt = 0;
let connectionTimeout: ReturnType<typeof setTimeout> | undefined;
let browserListenersInstalled = false;
let shouldReconnect = false;
let state = $state<'idle' | 'connecting' | 'connected' | 'disconnected'>('idle');

type WebSocketSubscriber = {
	open?: (socket: WebSocket) => void;
	message?: (event: MessageEvent) => void;
	close?: (event: CloseEvent) => void;
};

const subscribers = new Set<WebSocketSubscriber>();

export function connectWS(): Promise<WebSocket> {
	shouldReconnect = true;
	installBrowserListeners();

	if (socket?.readyState === WebSocket.OPEN) return Promise.resolve(socket);
	if (socketPromise) return socketPromise;

	clearReconnectTimer();
	state = 'connecting';
	const connectingSocket = new WebSocket(
		`ws${window.location.protocol === 'https:' ? 's' : ''}://${window.location.host}/api/ws`
	);
	socket = connectingSocket;

	socketPromise = new Promise((resolve, reject) => {
		let settled = false;
		connectionTimeout = setTimeout(() => {
			if (connectingSocket.readyState === WebSocket.CONNECTING) {
				connectingSocket.close(4000, 'Connection timeout');
			}
		}, 10_000);

		connectingSocket.addEventListener('open', () => {
			if (socket !== connectingSocket) return;
			settled = true;
			clearConnectionTimeout();
			reconnectAttempt = 0;
			state = 'connected';
			for (const subscriber of subscribers) {
				try {
					subscriber.open?.(connectingSocket);
				} catch {
					/* isolate subscriber failures */
				}
			}
			resolve(connectingSocket);
		});

		connectingSocket.addEventListener('message', (event) => {
			if (socket !== connectingSocket) return;
			for (const subscriber of subscribers) {
				try {
					subscriber.message?.(event);
				} catch {
					/* isolate subscriber failures */
				}
			}
		});

		connectingSocket.addEventListener('close', (event) => {
			if (socket !== connectingSocket) return;
			clearConnectionTimeout();
			state = 'disconnected';
			socket = undefined;
			socketPromise = undefined;
			for (const subscriber of subscribers) {
				try {
					subscriber.close?.(event);
				} catch {
					/* isolate subscriber failures */
				}
			}
			if (!settled) reject(new Error('WebSocket closed before connecting'));
			scheduleReconnect();
		});

		connectingSocket.addEventListener('error', () => {
			state = 'disconnected';
			if (!settled) {
				reject(new Error('WebSocket failed to connect'));
				if (connectingSocket.readyState !== WebSocket.CLOSED) connectingSocket.close();
			}
		});
	});

	return socketPromise;
}

export async function getWS(): Promise<WebSocket> {
	return connectWS();
}

export function subscribeWS(subscriber: WebSocketSubscriber): () => void {
	subscribers.add(subscriber);
	shouldReconnect = true;

	if (socket?.readyState === WebSocket.OPEN) {
		queueMicrotask(() => {
			if (subscribers.has(subscriber) && socket?.readyState === WebSocket.OPEN) {
				subscriber.open?.(socket);
			}
		});
	} else {
		void connectWS().catch(() => {
			/* the reconnect scheduler owns subsequent attempts */
		});
	}

	return () => {
		subscribers.delete(subscriber);
		if (subscribers.size === 0) {
			shouldReconnect = false;
			clearReconnectTimer();
		}
	};
}

export function getState() {
	return state;
}

function scheduleReconnect(delayOverride?: number) {
	if (!shouldReconnect || reconnectTimer || typeof window === 'undefined') return;
	if (typeof navigator !== 'undefined' && !navigator.onLine) return;

	const exponentialDelay = Math.min(500 * 2 ** reconnectAttempt, 15_000);
	const jitter = Math.floor(Math.random() * Math.min(exponentialDelay * 0.3, 1_000));
	const delay = delayOverride ?? exponentialDelay + jitter;
	reconnectAttempt += 1;
	reconnectTimer = setTimeout(() => {
		reconnectTimer = undefined;
		void connectWS().catch(() => {
			/* close/error schedules the next attempt */
		});
	}, delay);
}

function reconnectNow() {
	if (!shouldReconnect || socket?.readyState === WebSocket.OPEN) return;
	if (socket?.readyState === WebSocket.CONNECTING) return;
	clearReconnectTimer();
	socket = undefined;
	socketPromise = undefined;
	reconnectAttempt = 0;
	scheduleReconnect(0);
}

function installBrowserListeners() {
	if (browserListenersInstalled || typeof window === 'undefined') return;
	browserListenersInstalled = true;
	window.addEventListener('online', reconnectNow);
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') reconnectNow();
	});
}

function clearReconnectTimer() {
	if (reconnectTimer) clearTimeout(reconnectTimer);
	reconnectTimer = undefined;
}

function clearConnectionTimeout() {
	if (connectionTimeout) clearTimeout(connectionTimeout);
	connectionTimeout = undefined;
}
