import assert from 'node:assert/strict';
import test from 'node:test';
import { createActionHistory, createBackStack } from '../src/lib/features/navigation/back-stack.ts';

const flush = () => new Promise((resolve) => setImmediate(resolve));

function setup() {
	const entries = [{ url: '/previous' }, { url: '/' }];
	let index = 1;
	let backCalls = 0;
	const stack = createBackStack(
		{
			marker: () => entries[index].marker,
			url: () => entries[index].url,
			push: (marker) => {
				entries.splice(index + 1);
				entries.push({ url: entries[index].url, marker });
				index++;
			},
			go: (delta) => {
				backCalls++;
				queueMicrotask(() => travel(delta));
			}
		},
		'views'
	);
	function travel(delta) {
		index += delta;
		assert.ok(index >= 0 && index < entries.length);
		stack.pop();
	}
	return {
		stack,
		travel,
		current: () => entries[index],
		backCalls: () => backCalls,
		depth: () => index - 1,
		navigate: (url) => {
			entries.splice(index + 1);
			entries.push({ url });
			index++;
		}
	};
}

test('hierarchy, event and another hierarchy each get their own browser history entry', async () => {
	const { stack, travel, depth } = setup();
	const closed = [];
	for (const name of ['hierarchy', 'event', 'nested hierarchy']) {
		stack.register(() => closed.push(name));
		await flush();
	}
	assert.equal(depth(), 3);
	travel(-1);
	await flush();
	assert.equal(depth(), 2);
	assert.deepEqual(closed, ['nested hierarchy']);
	travel(-1);
	await flush();
	assert.equal(depth(), 1);
	assert.deepEqual(closed, ['nested hierarchy', 'event']);
	travel(-1);
	await flush();
	assert.equal(depth(), 0);
	assert.deepEqual(closed, ['nested hierarchy', 'event', 'hierarchy']);
});

test('Back closes the topmost view first, then returns to the previous page', async () => {
	const { stack, travel, current } = setup();
	const closed = [];
	stack.register(() => closed.push('drawer'));
	stack.register(() => closed.push('event'));
	await flush();
	travel(-1);
	await flush();
	assert.deepEqual(closed, ['event']);
	assert.equal(current().url, '/');
	travel(-1);
	await flush();
	assert.deepEqual(closed, ['event', 'drawer']);
	assert.equal(current().url, '/');
	travel(-1);
	assert.equal(current().url, '/previous');
});

test('closing all views together skips their history entries in one traversal', async () => {
	const { stack, current, backCalls, travel } = setup();
	const closeA = stack.register(() => assert.fail('Already closed'));
	const closeB = stack.register(() => assert.fail('Already closed'));
	await flush();
	closeA();
	closeB();
	await flush();
	assert.equal(backCalls(), 1);
	assert.deepEqual(current(), { url: '/' });
	travel(-1);
	assert.equal(current().url, '/previous');
});

test('opening a new view during a pending history cleanup does not dismiss it', async () => {
	const { stack, current, travel } = setup();
	const close = stack.register(() => {});
	await flush();
	close();
	await Promise.resolve(); // history.go requested, popstate not yet delivered
	let dismissed = false;
	stack.register(() => {
		dismissed = true;
	});
	await flush();
	assert.equal(dismissed, false);
	assert.match(current().marker, /^views:/);
	travel(-1);
	await flush();
	assert.equal(dismissed, true);
});

test('Escape dismisses only the top view and Forward does not reopen closed views', async () => {
	const { stack, travel, current } = setup();
	const closed = [];
	stack.register(() => closed.push('panel'));
	stack.register(() => closed.push('settings'));
	await flush();
	assert.equal(stack.dismissTop(), true);
	await flush();
	assert.deepEqual(closed, ['settings']);
	travel(-1);
	await flush();
	assert.deepEqual(closed, ['settings', 'panel']);
	travel(1);
	await flush();
	assert.equal(current().marker, undefined);
	assert.equal(stack.dismissTop(), false);
});

test('Back retraces nested popup and selection actions before closing the previous popup', async () => {
	const { stack, travel, current } = setup();
	const visible = ['event'];
	let selection = 'all';
	stack.register(() => visible.pop());
	visible.push('hierarchy');
	stack.register(() => visible.pop());
	const actions = createActionHistory((restore) => stack.register(restore));
	actions.remember(() => {
		selection = 'all';
	});
	selection = 'project';
	visible.push('child event');
	stack.register(() => visible.pop());
	await flush();
	travel(-1);
	await flush();
	assert.deepEqual(visible, ['event', 'hierarchy']);
	assert.equal(selection, 'project');
	travel(-1);
	await flush();
	assert.equal(selection, 'all');
	assert.deepEqual(visible, ['event', 'hierarchy']);
	travel(-1);
	await flush();
	assert.deepEqual(visible, ['event']);
	travel(-1);
	await flush();
	assert.deepEqual(visible, []);
	assert.equal(current().url, '/');
	travel(-1);
	assert.equal(current().url, '/previous');
});

test('explicit popup closure discards its action history without replaying actions', async () => {
	const { stack, travel } = setup();
	let parentClosed = false;
	stack.register(() => {
		parentClosed = true;
	});
	const closePopup = stack.register(() => assert.fail('Popup already closed'));
	const actions = createActionHistory((restore) => stack.register(restore));
	actions.remember(() => assert.fail('Closed popup must not restore its old selection'));
	actions.remember(() => assert.fail('Closed popup must not restore its old selection'));
	await flush();
	closePopup();
	actions.clear();
	await flush();
	travel(-1);
	await flush();
	assert.equal(parentClosed, true);
});

test('restored actions are removed and cannot replay after a view is reopened', async () => {
	const { stack, travel } = setup();
	let restored = 0;
	const actions = createActionHistory((restore) => stack.register(restore));
	actions.remember(() => {
		restored++;
	});
	await flush();
	travel(-1);
	await flush();
	assert.equal(restored, 1);
	actions.clear();
	actions.remember(() => {
		restored += 10;
	});
	await flush();
	travel(-1);
	await flush();
	assert.equal(restored, 11);
});

test('two rapid Back steps unwind two distinct popups without rebuilding history', async () => {
	const { stack, travel, depth } = setup();
	const closed = [];
	for (const name of ['hierarchy', 'event', 'nested hierarchy'])
		stack.register(() => closed.push(name));
	await flush();
	travel(-1);
	travel(-1);
	await flush();
	assert.deepEqual(closed, ['nested hierarchy', 'event']);
	assert.equal(depth(), 1);
});

test('Back skips an already closed middle popup without closing the first popup', async () => {
	const { stack, travel, depth } = setup();
	const closed = [];
	stack.register(() => closed.push('first'));
	const removeMiddle = stack.register(() => assert.fail('Middle popup was already closed'));
	stack.register(() => closed.push('last'));
	await flush();
	removeMiddle();
	await flush();
	travel(-1);
	await flush();
	assert.deepEqual(closed, ['last']);
	assert.equal(depth(), 1);
	travel(-1);
	await flush();
	assert.deepEqual(closed, ['last', 'first']);
});

test('a multi-entry browser history jump closes only the skipped popup layers', async () => {
	const { stack, travel, depth } = setup();
	const closed = [];
	for (const name of ['first', 'second', 'third']) stack.register(() => closed.push(name));
	await flush();
	travel(-2);
	await flush();
	assert.deepEqual(closed, ['third', 'second']);
	assert.equal(depth(), 1);
});

test('the first popup on another route still gets its own history entry', async () => {
	const { stack, travel, current, navigate } = setup();
	const closeFirst = stack.register(() => {});
	await flush();
	closeFirst();
	await flush();
	navigate('/admin');
	let closed = false;
	stack.register(() => {
		closed = true;
	});
	await flush();
	assert.match(current().marker, /^views:/);
	travel(-1);
	await flush();
	assert.equal(closed, true);
	assert.equal(current().url, '/admin');
	travel(-1);
	assert.equal(current().url, '/');
});
