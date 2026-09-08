import assert from 'node:assert/strict';
import test from 'node:test';
import { createBackStack } from '../src/lib/features/navigation/back-stack.ts';

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
