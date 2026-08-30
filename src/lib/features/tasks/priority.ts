type PriorityTask = {
	importance_value: number;
	start_at?: Date | number | string;
	assignees?: Array<{ user_id: string }>;
	dependencies?: Array<unknown>;
};

export type TaskPriority = {
	importance: number;
	assignedToUser: boolean;
	dependencyCount: number;
};

export function taskPriority(task: PriorityTask, userId?: string | null): TaskPriority {
	const assignees = task.assignees ?? [];
	return {
		importance: Number.isFinite(task.importance_value) ? task.importance_value : 0,
		assignedToUser: userId
			? assignees.some((assignee) => assignee.user_id === userId)
			: assignees.length > 0,
		dependencyCount: task.dependencies?.length ?? 0
	};
}

export function compareTaskPriority(
	a: PriorityTask,
	b: PriorityTask,
	userId?: string | null
): number {
	const aPriority = taskPriority(a, userId);
	const bPriority = taskPriority(b, userId);
	return (
		bPriority.importance - aPriority.importance ||
		Number(bPriority.assignedToUser) - Number(aPriority.assignedToUser) ||
		Number(bPriority.dependencyCount > 0) - Number(aPriority.dependencyCount > 0) ||
		bPriority.dependencyCount - aPriority.dependencyCount ||
		dateValue(a.start_at) - dateValue(b.start_at)
	);
}

function dateValue(value: Date | number | string | undefined): number {
	if (value === undefined) return Number.POSITIVE_INFINITY;
	const timestamp = +new Date(value);
	return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY;
}
