import type { RichTask } from './types';

export function isProjectLike(task: RichTask): boolean {
	return (task.subtasks?.length ?? 0) > 0 || (task.dependencies?.length ?? 0) > 0;
}
