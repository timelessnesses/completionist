import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { DatabaseSync } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import * as orm from 'drizzle-orm';
import * as schema from '../src/lib/server/db/schema.ts';
import * as visibility from '../src/lib/server/db/visibility.ts';

function fixture() {
	const deleted = { id: 'deleted-task', task_name: 'Hidden task name', deleted_at: new Date(0) };
	const author = { id: 'deleted-user', name: 'Hidden author name', deleted_at: new Date(0) };
	const active = { id: 'active-user', name: 'Visible author', deleted_at: null };
	return {
		id: 'visible-task',
		deleted_at: null,
		created_at: new Date(),
		start_at: new Date(Date.now() + 60_000),
		end_at: new Date(Date.now() + 120_000),
		parent: deleted.id,
		parentTask: deleted,
		subtasks: [deleted, { id: 'visible-child', deleted_at: null }],
		assignees: [
			{ user_id: author.id, user: author },
			{ user_id: active.id, user: active }
		],
		dependencies: [{ dependency_id: deleted.id, dependency: deleted }],
		dependents: [{ task_id: deleted.id, task: deleted }],
		comments: [{ id: 'comment', user_id: author.id, user: author, comment: 'Keep this comment' }],
		attachments: [{ id: 'file', user_id: author.id, user: author, file_name: 'Keep this file' }]
	};
}

function assertVisible(row) {
	assert.equal(row.parent, null);
	assert.equal(row.parentTask, null);
	assert.deepEqual(
		row.subtasks.map((task) => task.id),
		['visible-child']
	);
	assert.deepEqual(
		row.assignees.map((link) => link.user_id),
		['active-user']
	);
	assert.deepEqual(row.dependencies, []);
	assert.deepEqual(row.dependents, []);
	assert.equal(row.comments[0].user, null);
	assert.equal(row.comments[0].comment, 'Keep this comment');
	assert.equal(row.attachments[0].user, null);
	assert.equal(row.attachments[0].file_name, 'Keep this file');
	assert.doesNotMatch(JSON.stringify(row), /Hidden task name|Hidden author name/);
}

test('normal reads omit deleted rows and mask related records without mutating stored links', () => {
	const original = fixture();
	const before = structuredClone(original);
	const rows = visibility.visibleRecords([original, original.parentTask]);
	assert.equal(rows.length, 1);
	assertVisible(rows[0]);
	assert.equal(rows[0].created_at, original.created_at);
	assert.deepEqual(original, before);
	assert.equal(visibility.visibleRecord(original.parentTask), null);
});

test('restoring a task or user makes the original relationships visible again', () => {
	const original = fixture();
	visibility.visibleRecord(original);
	original.parentTask.deleted_at = null;
	original.assignees[0].user.deleted_at = null;
	const restored = visibility.visibleRecord(original);
	assert.equal(restored.parent, 'deleted-task');
	assert.equal(restored.parentTask.id, 'deleted-task');
	assert.equal(restored.subtasks.length, 2);
	assert.equal(restored.dependencies.length, 1);
	assert.equal(restored.dependents.length, 1);
	assert.equal(restored.assignees.length, 2);
	assert.equal(restored.comments[0].user.id, 'deleted-user');
});

test('missing linked records are excluded and epoch timestamps count as deleted', () => {
	assert.deepEqual(visibility.visibleRecords([{ deleted_at: 0 }]), []);
	const result = visibility.visibleRecord({
		assignees: [{ user: null }],
		dependencies: [{ dependency: null }],
		dependents: [{ task: null }]
	});
	assert.deepEqual(result, { assignees: [], dependencies: [], dependents: [] });
});

function loadModule(path, imports) {
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

for (const route of ['../src/routes/+page.server.ts', '../src/routes/preview/+page.server.ts']) {
	test(`${route} returns only visible relations in its actual load response`, async () => {
		const original = fixture();
		const columns = new Proxy({}, { get: (_, key) => key });
		const db = {
			query: new Proxy({}, { get: () => ({ findMany: () => ({}) }) }),
			batch: async () => [[original, original.parentTask], [], []]
		};
		const { load } = loadModule(route, {
			'$lib/server/db/index.js': { getDb: () => db, notDeleted: () => ({}) },
			'$lib/server/db/schema.js': { task: columns, user: columns },
			'$lib/server/db/visibility': visibility,
			'drizzle-orm': { isNull: () => ({}) },
			'$app/environment': { dev: false }
		});
		const response = await load({
			platform: { env: {} },
			locals: {},
			url: new URL('https://completionist.example/preview')
		});
		assert.equal(response.event.length, 1);
		assertVisible(response.event[0]);
		assert.equal(original.parent, 'deleted-task');
	});
}

test('editing visible links preserves hidden links in SQLite and restored reads recover them', async (t) => {
	const sqlite = new DatabaseSync(':memory:');
	t.after(() => sqlite.close());
	const journal = JSON.parse(
		readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url))
	);
	for (const entry of journal.entries) {
		sqlite.exec(readFileSync(new URL(`../drizzle/${entry.tag}.sql`, import.meta.url), 'utf8'));
	}
	const execute = async (sql, params, method) => {
		const statement = sqlite.prepare(sql);
		statement.setReturnArrays(true);
		if (method === 'run') {
			statement.run(...params);
			return { rows: [] };
		}
		return { rows: method === 'get' ? statement.get(...params) : statement.all(...params) };
	};
	const db = drizzle(
		execute,
		async (queries) => {
			sqlite.exec('BEGIN');
			try {
				const results = [];
				for (const query of queries)
					results.push(await execute(query.sql, query.params, query.method));
				sqlite.exec('COMMIT');
				return results;
			} catch (error) {
				sqlite.exec('ROLLBACK');
				throw error;
			}
		},
		{ schema }
	);
	await db.insert(schema.user).values([
		{ id: 'owner', name: 'Owner' },
		{ id: 'hidden-user', name: 'Hidden author name', deleted_at: new Date() }
	]);
	const taskValues = {
		owner: 'owner',
		color: { r: 1, g: 2, b: 3 },
		status: 'todo',
		start_at: new Date(),
		end_at: new Date(Date.now() + 60_000),
		all_day: 0,
		importance_value: 1
	};
	await db.insert(schema.task).values([
		{ ...taskValues, id: 'hidden-task', task_name: 'Hidden task name', deleted_at: new Date() },
		{ ...taskValues, id: 'visible-task', task_name: 'Visible task', parent: 'hidden-task' }
	]);
	await db.insert(schema.task_assignee).values({ task_id: 'visible-task', user_id: 'hidden-user' });
	await db
		.insert(schema.task_dependency)
		.values({ task_id: 'visible-task', dependency_id: 'hidden-task' });
	await db
		.insert(schema.task_comment)
		.values({ task_id: 'visible-task', user_id: 'hidden-user', comment: 'Keep this comment' });
	const { PUT } = loadModule('../src/routes/api/events/+server.ts', {
		'$lib/server/db/index.js': {
			getDb: () => db,
			notDeleted: (table) => orm.isNull(table.deleted_at)
		},
		'$lib/server/db/schema.js': schema,
		'$lib/server/db/visibility': visibility,
		'drizzle-orm': orm,
		'@sveltejs/kit': {
			json: (value, options) => Response.json(value, options),
			error: (status, message) => Object.assign(new Error(message), { status })
		},
		'$lib/server/task-fanout': { buildTaskNotificationEnvelope: () => ({}) },
		'$lib/server/admin-audit': { recordAdminEventAction: async () => {} }
	});
	const save = (body) =>
		PUT({
			request: new Request('https://example.test/api/events', {
				method: 'PUT',
				body: JSON.stringify(body)
			}),
			url: new URL('https://example.test/api/events?id=visible-task'),
			locals: { user: { user_id: 'owner', name: 'Owner', admin: false } },
			platform: {
				env: {
					COMPLETIONIST_QUEUE: { send: async () => {} },
					GlobalWS: { getByName: () => ({ fetch: async () => new Response('ok') }) }
				}
			}
		});
	for (const body of [{}, { assignee_ids: [], dependency_ids: [] }]) {
		if (body.assignee_ids) {
			await db
				.insert(schema.task)
				.values({ ...taskValues, id: 'active-dependency', task_name: 'Active dependency' });
			await db.insert(schema.task_assignee).values({ task_id: 'visible-task', user_id: 'owner' });
			await db
				.insert(schema.task_dependency)
				.values({ task_id: 'visible-task', dependency_id: 'active-dependency' });
		}
		const result = await (await save(body)).json();
		assert.equal(result.parentTask, null);
		assert.equal(result.parent, null);
		assert.deepEqual(result.assignees, []);
		assert.deepEqual(result.dependencies, []);
		assert.equal(result.comments[0].user, null);
		assert.doesNotMatch(JSON.stringify(result), /Hidden task name|Hidden author name/);
	}
	assert.equal((await db.select().from(schema.task_assignee)).length, 1);
	assert.equal((await db.select().from(schema.task_dependency)).length, 1);
	await db
		.update(schema.task)
		.set({ deleted_at: null })
		.where(orm.eq(schema.task.id, 'hidden-task'));
	await db
		.update(schema.user)
		.set({ deleted_at: null })
		.where(orm.eq(schema.user.id, 'hidden-user'));
	const restored = await (await save({})).json();
	assert.equal(restored.parentTask.id, 'hidden-task');
	assert.equal(restored.assignees[0].user.id, 'hidden-user');
	assert.equal(restored.dependencies[0].dependency.id, 'hidden-task');
	assert.equal(restored.comments[0].user.id, 'hidden-user');
	await db
		.insert(schema.direct_message)
		.values({ from_user_id: 'owner', to_user_id: 'hidden-user', message: 'Restored conversation' });
	const { GET } = loadModule('../src/routes/api/direct-messages/+server.ts', {
		'$lib/server/db': { getDb: () => db },
		'$lib/server/db/schema': schema,
		'drizzle-orm': orm,
		'@sveltejs/kit': {
			json: (value, options) => Response.json(value, options),
			error: (status, message) => Object.assign(new Error(message), { status })
		}
	});
	const readMessages = () =>
		GET({
			url: new URL('https://example.test/api/direct-messages?user_id=hidden-user'),
			locals: { user: { user_id: 'owner' } },
			platform: { env: {} }
		});
	assert.equal((await (await readMessages()).json()).length, 1);
	await db
		.update(schema.user)
		.set({ deleted_at: new Date() })
		.where(orm.eq(schema.user.id, 'hidden-user'));
	await assert.rejects(readMessages, { status: 404 });
});
