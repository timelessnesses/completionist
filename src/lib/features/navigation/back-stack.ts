type BackHistory = {
	marker(): string | undefined;
	url(): string;
	push(marker: string): void;
	go(delta: number): void;
};

/** Reversible navigation within a view; clear its steps when that view is closed. */
export function createActionHistory(register: (restore: () => void) => () => void) {
	const pending = new Set<() => void>();
	return {
		remember(restore: () => void) {
			const unregister = register(() => {
				pending.delete(unregister);
				restore();
			});
			pending.add(unregister);
		},
		clear() {
			for (const unregister of pending) unregister();
			pending.clear();
		}
	};
}

/** Give each popup or reversible action a real, distinct shallow-history entry. */
export function createBackStack(history: BackHistory, token: string) {
	type View = { marker: string; close: () => void; pushed: boolean };
	const views = new Map<string, View>();
	let timeline: View[] = [];
	let currentIndex = -1;
	let sequence = 0;
	let returning = false;
	let entryUrl = '';
	let queued = false;

	function reconcile() {
		queued = false;
		if (returning) return;
		if (timeline.length && history.url() !== entryUrl) {
			// A route navigation owns the browser history now.
			timeline = [];
			currentIndex = -1;
			for (const view of views.values()) if (view.pushed) views.delete(view.marker);
			// Keep pending registrations from the destination page.
		}
		// Explicitly closed views may leave entries between still-open views.
		// Skip those entries without replaying their close/restore callbacks.
		let target = currentIndex;
		while (target >= 0 && !views.has(timeline[target].marker)) target--;
		if (target !== currentIndex) {
			returning = true;
			history.go(target - currentIndex);
			return;
		}
		for (const view of views.values()) {
			if (view.pushed) continue;
			entryUrl = history.url();
			// Opening a new view after Back replaces the abandoned forward branch.
			timeline = timeline.slice(0, currentIndex + 1);
			timeline.push(view);
			view.pushed = true;
			currentIndex++;
			history.push(view.marker);
		}
	}

	function schedule() {
		if (queued) return;
		queued = true;
		queueMicrotask(reconcile);
	}

	function dismissTop() {
		const top = [...views.values()].at(-1);
		if (!top) return false;
		views.delete(top.marker);
		top.close();
		schedule();
		return true;
	}

	return {
		register(close: () => void) {
			const marker = `${token}:${++sequence}`;
			views.set(marker, { marker, close, pushed: false });
			schedule();
			return () => {
				views.delete(marker);
				schedule();
			};
		},
		dismissTop,
		pop() {
			returning = false;
			if (!timeline.length) return;
			if (history.url() !== entryUrl) {
				const closing = [...views.values()].filter((view) => view.pushed).reverse();
				timeline = [];
				currentIndex = -1;
				for (const view of closing) {
					views.delete(view.marker);
					view.close();
				}
				schedule();
				return;
			}
			const marker = history.marker();
			currentIndex = timeline.findIndex((view) => view.marker === marker);
			for (const view of timeline.slice(currentIndex + 1).reverse()) {
				if (!views.delete(view.marker)) continue;
				view.close();
			}
			// Newly registered views waiting for an asynchronous history.go are not
			// in the timeline yet and must survive this popstate.
			schedule();
		}
	};
}
