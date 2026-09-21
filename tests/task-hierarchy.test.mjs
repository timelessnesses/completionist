import assert from 'node:assert/strict';
import test from 'node:test';
import { buildHierarchy, taskStatus, CARD_HEIGHT } from '../src/lib/features/tasks/hierarchy.ts';

const task = (id, extra = {}) => ({
	id,
	task_name: id,
	parent: null,
	status: 'todo',
	completed: null,
	deleted_at: null,
	...extra
});
const depends = (...ids) => ids.map((dependency_id) => ({ dependency_id }));

test('nested progress counts unique leaf work and excludes cancelled tasks', () => {
	const graph = buildHierarchy(
		[
			task('project'),
			task('group', { parent: 'project' }),
			task('done', { parent: 'group', completed: new Date() }),
			task('pending', { parent: 'project' }),
			task('cancelled', { parent: 'group', status: 'cancelled' })
		],
		'project'
	);
	assert.equal(graph.nodes.length, 5);
	assert.deepEqual(graph.progress.get('project'), { completed: 1, total: 2, percent: 50 });
});

test('shared dependencies render once and do not double count completion', () => {
	const graph = buildHierarchy(
		[
			task('root', { dependencies: depends('a', 'b') }),
			task('a', { dependencies: depends('shared') }),
			task('b', { dependencies: depends('shared') }),
			task('shared', { status: 'completed' })
		],
		'root'
	);
	assert.equal(graph.nodes.length, 4);
	assert.equal(graph.edges.length, 4);
	assert.deepEqual(graph.progress.get('root'), { completed: 1, total: 1, percent: 100 });
});

test('collapsed descendants stay hidden without changing progress', () => {
	const tasks = [
		task('root'),
		task('child', { parent: 'root' }),
		task('leaf', { parent: 'child', status: 'completed' }),
		task('other')
	];
	const graph = buildHierarchy(tasks, '', new Set(['root']));
	assert.deepEqual(new Set(graph.nodes.map((node) => node.task.id)), new Set(['root', 'other']));
	assert.equal(graph.progress.get('root').percent, 100);
	assert.equal(graph.total, 4);
});

test('cycles, self-links and orphan parents preserve every visible task', () => {
	const graph = buildHierarchy([
		task('a', { parent: 'b', dependencies: depends('a') }),
		task('b', { parent: 'a' }),
		task('orphan', { parent: 'missing' })
	]);
	assert.equal(graph.nodes.length, 3);
	assert.equal(new Set(graph.nodes.map((node) => node.task.id)).size, 3);
	assert.ok([...graph.progress.values()].every((value) => Number.isFinite(value.percent)));
});

test('deleted and missing relations never resurrect embedded task records', () => {
	const graph = buildHierarchy([
		task('root', { dependencies: depends('deleted', 'missing') }),
		task('deleted', { deleted_at: new Date(), parent: 'root' })
	]);
	assert.equal(graph.nodes.length, 1);
	assert.equal(graph.edges.length, 0);
	assert.equal(buildHierarchy([], 'missing').nodes.length, 0);
});

test('cards at the same depth do not overlap', () => {
	const graph = buildHierarchy([
		task('root'),
		...Array.from({ length: 15 }, (_, i) => task(`child${i}`, { parent: 'root' }))
	]);
	const children = graph.nodes.filter((node) => node.task.parent).sort((a, b) => a.y - b.y);
	for (let i = 1; i < children.length; i++)
		assert.ok(children[i].y - children[i - 1].y >= CARD_HEIGHT);
});

test('status handles completion timestamps and explicit status consistently', () => {
	assert.equal(taskStatus(task('a', { completed: new Date() })), 'Completed');
	assert.equal(taskStatus(task('a', { status: 'progress' })), 'In progress');
	assert.equal(taskStatus(task('a', { status: 'cancelled', completed: new Date() })), 'Cancelled');
});

test('a project containing only cancelled leaves has no counted work', () => {
	const graph = buildHierarchy([
		task('root'),
		task('cancelled', { parent: 'root', status: 'cancelled' })
	]);
	assert.deepEqual(graph.progress.get('root'), { completed: 0, total: 0, percent: 0 });
});
