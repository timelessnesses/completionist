import { pushState, replaceState } from '$app/navigation';
import { page } from '$app/state';
import { createBackStack } from '$lib/features/navigation/back-stack';

type Options = { enabled: boolean; close: () => void };
let stack: ReturnType<typeof createBackStack> | undefined;

function backStack() {
	if (stack) return stack;
	stack = createBackStack(
		{
			marker: () => page.state.backView,
			url: () => window.location.origin + window.location.pathname,
			push: (backView) => pushState('', { ...page.state, backView }),
			clear: () => {
				const { backView: _, ...state } = page.state;
				replaceState('', state);
			},
			back: () => window.history.back()
		},
		crypto.randomUUID()
	);
	window.addEventListener('popstate', () => queueMicrotask(() => stack?.pop()));
	window.addEventListener(
		'keydown',
		(event) => {
			if (event.key === 'Escape' && stack?.dismissTop()) {
				event.preventDefault();
				event.stopImmediatePropagation();
			}
		},
		{ capture: true }
	);
	return stack;
}

/** Attach to a dialog, or pass enabled for a permanently mounted drawer. */
export function backDismiss(_node: HTMLElement, initial: Options | (() => void)) {
	let options: Options;
	let unregister: (() => void) | undefined;
	function update(value: Options | (() => void)) {
		options = typeof value === 'function' ? { enabled: true, close: value } : value;
		if (options.enabled && !unregister) unregister = backStack().register(() => options.close());
		else if (!options.enabled && unregister) {
			unregister();
			unregister = undefined;
		}
	}
	update(initial);
	return { update, destroy: () => unregister?.() };
}
