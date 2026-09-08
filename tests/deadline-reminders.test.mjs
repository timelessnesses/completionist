import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as schedule from '../src/lib/features/reminders/schedule.ts';
import * as priority from '../src/lib/features/tasks/priority.ts';

// Run the production handlers with in-memory database and delivery boundaries.
function handlers(items) {
	const columns = new Proxy({}, { get: (_, key) => key });
	const orm = {
		and:
			(...conditions) =>
			(row) =>
				conditions.every((condition) => condition(row)),
		eq: (column, value) => (row) => row[column] === value,
		ne: (column, value) => (row) => row[column] !== value,
		gte: (column, value) => (row) => row[column] >= value,
		isNull: (column) => (row) => row[column] == null
	};
	const db = {
		query: {
			task: {
				findMany: async ({ where }) => items.filter(where),
				findFirst: async ({ where }) => items.find(where)
			}
		}
	};
	const imports = {
		'$lib/features/reminders/schedule': schedule,
		'$lib/features/tasks/priority': priority,
		'$lib/server/db': { getDb: () => db },
		'$lib/server/db/schema': { task: columns },
		'drizzle-orm': orm,
		'web-push': {},
		resend: {},
		'$lib/durable_objects/GlobalWS': {}
	};
	function load(path) {
		const source = readFileSync(new URL(path, import.meta.url), 'utf8');
		const { outputText } = ts.transpileModule(source, {
			compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
		});
		const exports = {};
		new Function('require', 'exports', outputText)((name) => {
			assert.ok(name in imports, `Unexpected import: ${name}`);
			return imports[name];
		}, exports);
		return exports;
	}
	return {
		...load('../src/lib/server/task-alarms.ts'),
		...load('../src/platform.cloudflare.ts')
	};
}

function event(overrides = {}) {
	const now = Date.now();
	return {
		id: 'event',
		owner: 'owner',
		task_name: 'Deadline test',
		start_at: new Date(now - 3_600_000),
		end_at: new Date(now + 60_000),
		created_at: new Date(now - 86_400_000),
		completed: null,
		deleted_at: null,
		status: 'pending',
		reminders: [],
		assignees: [{ user_id: 'assignee' }],
		dependencies: [],
		importance_value: 0,
		description: null,
		color: { r: 0, g: 0, b: 0 },
		...overrides
	};
}

test('automatically schedules and validates a deadline without configured reminders', async () => {
	const item = event();
	const api = handlers([item]);
	for (const userId of ['owner', 'assignee']) {
		const alarms = await api.taskAlarmsForUser({}, userId);
		assert.equal(alarms.length, 1);
		assert.equal(alarms[0].rule_key, 'task-deadline');
		assert.equal(alarms[0].occurrence_at, +item.end_at);
		assert.deepEqual(await api.validateTaskAlarm({}, userId, alarms[0]), alarms[0]);
	}
	assert.deepEqual(await api.taskAlarmsForUser({}, 'unrelated'), []);
	assert.deepEqual(await api.taskAlarmsForUser({}, 'owner', +item.end_at), []);
	assert.equal(
		await api.validateTaskAlarm({}, 'owner', {
			task_id: item.id,
			rule_key: 'task-deadline',
			occurrence_at: +item.end_at - 1
		}),
		null
	);
});

test('completed, cancelled, and deleted events have no deadline alarm', async () => {
	for (const overrides of [
		{ completed: new Date() },
		{ status: 'cancelled' },
		{ deleted_at: new Date() }
	]) {
		const item = event(overrides);
		const api = handlers([item]);
		assert.deepEqual(await api.taskAlarmsForUser({}, 'owner'), []);
		assert.equal(
			await api.validateTaskAlarm({}, 'owner', {
				task_id: item.id,
				rule_key: 'task-deadline',
				occurrence_at: +item.end_at
			}),
			null
		);
	}
});

test('a repeating reminder at the deadline produces only one native and queued reminder', async () => {
	const item = event({
		reminders: [
			{
				id: 'repeat',
				lead_value: 1,
				lead_unit: 'hour',
				repeat_value: 1,
				repeat_unit: 'hour',
				created_at: new Date(Date.now() - 86_400_000)
			}
		]
	});
	const api = handlers([item]);
	assert.equal((await api.taskAlarmsForUser({}, 'owner')).length, 1);
	const delivered = [];
	const sent = new Map();
	const env = {
		COMPLETIONIST_KV: {
			get: async (key) => sent.get(key),
			put: async (key, value) => sent.set(key, value)
		},
		COMPLETIONIST_QUEUE: { send: async (message) => delivered.push(message) }
	};
	async function tick(time) {
		let pending;
		await api.scheduled({ scheduledTime: time }, env, {
			waitUntil: (work) => {
				pending = work;
			}
		});
		await pending;
	}
	await tick(+item.end_at - 1);
	assert.equal(delivered.length, 0);
	await tick(+item.end_at);
	await tick(+item.end_at + 60_000);
	assert.equal(delivered.length, 1);
	assert.equal(delivered[0].data.reminder_id, 'task-deadline');
	assert.deepEqual(delivered[0].recipient_user_ids, ['owner', 'assignee']);
	assert.match(delivered[0].message, /is due now/);
});

test('the default one-day event reminder is scheduled before the start', () => {
	const item = event({
		start_at: new Date('2026-09-10T12:30:00+07:00'),
		end_at: new Date('2026-09-11T12:30:00+07:00')
	});
	const rule = {
		anchor: 'start',
		lead_value: 1,
		lead_unit: 'day',
		repeat_value: null,
		repeat_unit: null
	};
	const reference = schedule.reminderReferenceAt(item, rule);
	assert.equal(
		+schedule.nextReminderOccurrence(reference, rule, +item.start_at - 2 * 86_400_000),
		+item.start_at - 86_400_000
	);
});

test('start and deadline rules coexist with separate native times, keys, and queued messages', async () => {
	const now = Date.now();
	const base = {
		lead_value: 1,
		lead_unit: 'day',
		repeat_value: null,
		repeat_unit: null,
		created_at: new Date(now - 86_400_000)
	};
	const item = event({
		start_at: new Date(now + 86_400_000 + 60_000),
		end_at: new Date(now + 2 * 86_400_000 + 60_000),
		reminders: [
			{ ...base, id: 'start', anchor: 'start' },
			{ ...base, id: 'end', anchor: 'end' }
		]
	});
	const api = handlers([item]);
	const alarms = await api.taskAlarmsForUser({}, 'owner', now);
	const start = alarms.find((alarm) => alarm.rule_key === 'start:1:day::');
	const deadline = alarms.find((alarm) => alarm.rule_key === '1:day::');
	assert.equal(start.occurrence_at, +item.start_at - 86_400_000);
	assert.equal(deadline.occurrence_at, +item.end_at - 86_400_000);
	assert.deepEqual(await api.validateTaskAlarm({}, 'owner', start), start);
	const delivered = [];
	const env = {
		COMPLETIONIST_KV: { get: async () => null, put: async () => {} },
		COMPLETIONIST_QUEUE: { send: async (message) => delivered.push(message) }
	};
	for (const time of [start.occurrence_at, deadline.occurrence_at]) {
		let pending;
		await api.scheduled({ scheduledTime: time }, env, {
			waitUntil: (work) => {
				pending = work;
			}
		});
		await pending;
	}
	assert.equal(delivered.length, 2);
	assert.match(delivered[0].message, /starts in about 1 day/);
	assert.match(delivered[1].message, /ends in about 1 day/);
	assert.equal(delivered[0].data.reminder_anchor, 'start');
	assert.equal(delivered[1].data.reminder_anchor, 'end');
});

test('legacy reminders retain end timing and repeat-start reminders stop at the start', async () => {
	const now = Date.now();
	const base = {
		lead_value: 1,
		lead_unit: 'day',
		repeat_value: 1,
		repeat_unit: 'day',
		created_at: new Date(now - 3 * 86_400_000)
	};
	const item = event({
		start_at: new Date(now + 60_000),
		end_at: new Date(now + 86_400_000),
		reminders: [{ ...base, anchor: 'start' }]
	});
	assert.equal(schedule.reminderReferenceAt(item, base), item.end_at);
	assert.equal(
		schedule.reminderRuleKey(base),
		schedule.reminderRuleKey({ ...base, anchor: 'end' })
	);
	const alarms = await handlers([item]).taskAlarmsForUser({}, 'owner', now);
	assert.deepEqual(alarms.map((alarm) => alarm.rule_key).sort(), ['task-deadline', 'task-start']);
});
