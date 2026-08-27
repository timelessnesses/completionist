import { writable } from 'svelte/store';

export type ApiToast = {
	id: number;
	tone: 'success' | 'error';
	message: string;
};

export const apiPending = writable(0);
export const apiToasts = writable<ApiToast[]>([]);

let installed = false;
let nextToastId = 1;

export function dismissApiToast(id: number) {
	apiToasts.update((items) => items.filter((item) => item.id !== id));
}

export function pushApiToast(message: string, tone: ApiToast['tone'] = 'success') {
	const id = nextToastId++;
	apiToasts.update((items) => [...items.slice(-3), { id, tone, message }]);
	setTimeout(() => dismissApiToast(id), tone === 'error' ? 5200 : 3400);
}

export function installApiFeedback() {
	if (installed || typeof window === 'undefined') return () => {};
	installed = true;
	const originalFetch = window.fetch.bind(window);

	window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
		const request = input instanceof Request ? input : null;
		const url = request?.url ?? String(input);
		const isApi = new URL(url, window.location.origin).pathname.startsWith('/api/');
		if (!isApi) return originalFetch(input, init);

		const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
		apiPending.update((count) => count + 1);
		try {
			const response = await originalFetch(input, init);
			if (method !== 'GET' && method !== 'HEAD') {
				if (response.ok) pushApiToast(successMessage(method));
				else pushApiToast(`Request failed (${response.status})`, 'error');
			}
			return response;
		} catch (error) {
			pushApiToast(error instanceof Error ? error.message : 'Network request failed', 'error');
			throw error;
		} finally {
			apiPending.update((count) => Math.max(0, count - 1));
		}
	};

	return () => {
		window.fetch = originalFetch;
		installed = false;
	};
}

function successMessage(method: string): string {
	if (method === 'POST') return 'Saved successfully';
	if (method === 'DELETE') return 'Removed successfully';
	return 'Changes saved';
}
