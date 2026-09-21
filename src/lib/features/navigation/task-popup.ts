export type TaskPopup = {
	key: string;
	kind: 'event' | 'hierarchy';
	taskId: string;
};

export function createTaskPopup(kind: TaskPopup['kind'], taskId = ''): TaskPopup {
	return { key: crypto.randomUUID(), kind, taskId };
}
