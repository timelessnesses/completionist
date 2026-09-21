import type { RichTask } from './types';

export const CARD_WIDTH = 280;
export const CARD_HEIGHT = 224;
export type HierarchyEdge = { from: string; to: string; kind: 'child' | 'dependency' };
export type HierarchyNode = { task: RichTask; x: number; y: number; children: number };

export function compareHierarchyTime(a: RichTask, b: RichTask): number {
	return (
		+new Date(a.start_at) - +new Date(b.start_at) ||
		+new Date(a.end_at) - +new Date(b.end_at) ||
		a.id.localeCompare(b.id)
	);
}

export function taskStatus(task: RichTask) {
	if (task.status === 'cancelled') return 'Cancelled';
	if (task.completed || task.status === 'completed') return 'Completed';
	return task.status === 'progress' ? 'In progress' : 'To do';
}

/** Only resolve relations against visible records, never stale embedded relation objects. */
export function buildHierarchy(tasks: RichTask[], rootId = '', collapsed = new Set<string>()) {
	const map = new Map(tasks.filter((task) => !task.deleted_at).map((task) => [task.id, task]));
	const edges: HierarchyEdge[] = [];
	const keys = new Set<string>();
	function link(from: string, to: string, kind: HierarchyEdge['kind']) {
		const key = `${from}:${to}`;
		if (from === to || !map.has(from) || !map.has(to) || keys.has(key)) return;
		keys.add(key);
		edges.push({ from, to, kind });
	}
	for (const task of map.values()) if (task.parent) link(task.parent, task.id, 'child');
	for (const task of map.values()) {
		for (const relation of task.dependencies ?? [])
			link(task.id, relation.dependency_id, 'dependency');
	}
	const children = new Map<string, string[]>();
	for (const edge of edges) children.set(edge.from, [...(children.get(edge.from) ?? []), edge.to]);
	const sort = (a: string, b: string) => compareHierarchyTime(map.get(a)!, map.get(b)!);
	for (const list of children.values()) list.sort(sort);
	function reachable(id: string) {
		const seen = new Set<string>();
		const pending = [id];
		while (pending.length) {
			const next = pending.pop()!;
			if (seen.has(next) || !map.has(next)) continue;
			seen.add(next);
			pending.push(...(children.get(next) ?? []));
		}
		return seen;
	}
	const scope = rootId ? reachable(rootId) : new Set(map.keys());
	const incoming = new Set(edges.filter((edge) => scope.has(edge.from)).map((edge) => edge.to));
	const roots =
		rootId && scope.has(rootId)
			? [rootId]
			: [...scope].filter((id) => !incoming.has(id)).sort(sort);
	// Build a spanning forest first so collapsed descendants cannot reappear as new roots.
	const visited = new Set<string>();
	const tree = new Map<string, string[]>();
	function visit(id: string) {
		visited.add(id);
		const branch: string[] = [];
		tree.set(id, branch);
		for (const child of children.get(id) ?? []) {
			if (visited.has(child)) continue;
			branch.push(child);
			visit(child);
		}
	}
	for (const id of roots) visit(id);
	for (const id of [...scope].sort(sort))
		if (!visited.has(id)) {
			roots.push(id);
			visit(id);
		}
	const nodes: HierarchyNode[] = [];
	let nextY = 32;
	function place(id: string, depth: number): number {
		const branch = collapsed.has(id) ? [] : (tree.get(id) ?? []);
		const positions = branch.map((child) => place(child, depth + 1));
		const y = positions.length ? (positions[0] + positions[positions.length - 1]) / 2 : nextY;
		if (!positions.length) nextY += CARD_HEIGHT + 32;
		nodes.push({
			task: map.get(id)!,
			x: 32 + depth * (CARD_WIDTH + 88),
			y,
			children: tree.get(id)?.length ?? 0
		});
		return y;
	}
	for (const id of roots) place(id, 0);
	nodes.sort((a, b) => a.x - b.x || a.y - b.y);
	const visible = new Set(nodes.map((node) => node.task.id));
	const progress = new Map<string, { completed: number; total: number; percent: number }>();
	for (const id of scope) {
		// Count unique terminal work items; containers do not double-count their children.
		const leaves = [...reachable(id)].filter((key) => !children.get(key)?.length);
		const work = leaves.filter((key) => taskStatus(map.get(key)!) !== 'Cancelled');
		// A closed cycle has no leaf; use its own status rather than divide by zero.
		if (!leaves.length && taskStatus(map.get(id)!) !== 'Cancelled') work.push(id);
		const completed = work.filter((key) => taskStatus(map.get(key)!) === 'Completed').length;
		progress.set(id, {
			completed,
			total: work.length,
			percent: work.length ? Math.round((completed / work.length) * 100) : 0
		});
	}
	return {
		nodes,
		progress,
		total: scope.size,
		edges: edges.filter(
			(edge) => visible.has(edge.from) && visible.has(edge.to) && !collapsed.has(edge.from)
		),
		width: Math.max(360, ...nodes.map((node) => node.x + CARD_WIDTH + 32)),
		height: Math.max(280, ...nodes.map((node) => node.y + CARD_HEIGHT + 32))
	};
}
