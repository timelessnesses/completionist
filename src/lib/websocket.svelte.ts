let socket: WebSocket;
let state = $state();

export function connectWS() {
	socket = new WebSocket(
		`ws${window.location.protocol === 'https:' ? 's' : ''}://${window.location.host}/api/ws`
	);
	state = 'connecting';
	socket.addEventListener('open', () => {
		state = 'connected';
	});
	socket.addEventListener('close', () => {
		state = 'disconnected';
	});
}

export function getWS() {
	return socket;
}

export function getState() {
	return state;
}
