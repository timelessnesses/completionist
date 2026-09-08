type BackHistory = {
	marker(): string | undefined;
	url(): string;
	push(marker: string): void;
	clear(): void;
	back(): void;
};

/** One temporary history entry protects the page while views are open. */
export function createBackStack(history: BackHistory, token: string) {
	const views = new Map<symbol, () => void>();
	let ownsEntry = false;
	let returning = false;
	let entryUrl = '';
	let queued = false;

	function reconcile() {
		queued = false;
		if (returning) return;
		if (ownsEntry && history.url() !== entryUrl) {
			ownsEntry = false;
			return;
		}
		if (views.size && !ownsEntry) {
			entryUrl = history.url();
			history.push(token);
			ownsEntry = true;
		} else if (!views.size && ownsEntry && history.marker() === token) {
			returning = true;
			history.back();
		}
	}

	function schedule() {
		if (queued) return;
		queued = true;
		queueMicrotask(reconcile);
	}

	function dismissTop() {
		const top = [...views.entries()].at(-1);
		if (!top) return false;
		views.delete(top[0]);
		top[1]();
		schedule();
		return true;
	}

	return {
		register(close: () => void) {
			const id = Symbol();
			views.set(id, close);
			schedule();
			return () => {
				views.delete(id);
				schedule();
			};
		},
		dismissTop,
		pop() {
			if (history.marker() === token) {
				// Forward must not resurrect a dismissed view or leave a stale marker.
				if (!views.size) history.clear();
				return;
			}
			const wasReturning = returning;
			returning = false;
			if (!ownsEntry) return;
			ownsEntry = false;
			if (history.url() !== entryUrl) {
				const closing = [...views.values()].reverse();
				views.clear();
				for (const close of closing) close();
				return;
			}
			if (!wasReturning) dismissTop();
			schedule();
		}
	};
}
