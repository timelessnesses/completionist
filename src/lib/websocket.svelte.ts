let socket: WebSocket | undefined;
let socketPromise: Promise<WebSocket> | undefined;
let state = $state<'idle' | 'connecting' | 'connected' | 'disconnected'>('idle');

export function connectWS(): Promise<WebSocket> {
	if (socket?.readyState === WebSocket.OPEN) {
		return Promise.resolve(socket);
	}
	if (socketPromise) {
		return socketPromise;
	}

	socket = new WebSocket(
		`ws${window.location.protocol === 'https:' ? 's' : ''}://${window.location.host}/api/ws`
	);
	state = 'connecting';
	socketPromise = new Promise((resolve, reject) => {
		let settled = false;

		socket?.addEventListener('open', () => {
			settled = true;
			state = 'connected';
			resolve(socket!);
		});
		socket?.addEventListener('close', () => {
			state = 'disconnected';
			socket = undefined;
			socketPromise = undefined;
			if (!settled) reject(new Error('WebSocket closed before connecting'));
		});
		socket?.addEventListener('error', () => {
			state = 'disconnected';
			if (!settled) {
				socketPromise = undefined;
				reject(new Error('WebSocket failed to connect'));
			}
		});
	});

	return socketPromise;
}

export async function getWS(): Promise<WebSocket> {
	return connectWS();
}

export function getState() {
	return state;
}
