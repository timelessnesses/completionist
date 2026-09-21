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
			clear: () => {
				delete entries[index].marker;
			},
			back: () => {
				backCalls++;
				queueMicrotask(() => travel(-1));
			}
		},
		'views'
	);
	function travel(delta) {
		index += delta;
		assert.ok(index >= 0 && index < entries.length);
		stack.pop();
	}
	return { stack, travel, current: () => entries[index], backCalls: () => backCalls };
}

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

test('closing all views together consumes only the temporary history entry', async () => {
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
	await Promise.resolve(); // history.back requested, popstate not yet delivered
	let dismissed = false;
	stack.register(() => {
		dismissed = true;
	});
	await flush();
	assert.equal(dismissed, false);
	assert.equal(current().marker, 'views');
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
