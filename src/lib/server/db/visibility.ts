type SoftDeleted = { deleted_at: unknown };

type VisibleFields<T> = T extends Date
	? T
	: T extends Array<infer Item>
		? VisibleFields<Item>[]
		: T extends object
			? { [Key in keyof T]: VisibleValue<T[Key]> }
			: T;

type VisibleValue<T> = T extends SoftDeleted ? VisibleFields<T> | null : VisibleFields<T>;

/**
 * Shape normal client reads without changing stored links. Admin/restore reads
 * deliberately bypass this. Load deleted_at on related tasks and users so that
 * visibility can be decided before returning their data to the client.
 */
export function visibleRecords<T extends object>(rows: T[]): VisibleFields<T>[] {
	return clean(rows) as VisibleFields<T>[];
}

export function visibleRecord<T extends object>(row: T): VisibleFields<T> | null {
	return clean(row) as VisibleFields<T> | null;
}

function clean(value: unknown, relation?: string): unknown {
	if (value === null || typeof value !== 'object' || value instanceof Date) return value;
	if (Array.isArray(value)) {
		return value
			.filter((row) => !hiddenLink(row, relation))
			.map((row) => clean(row))
			.filter((row) => row !== null);
	}
	const row = value as Record<string, unknown>;
	if (row.deleted_at != null) return null;
	const result = Object.fromEntries(
		Object.entries(row).map(([key, child]) => [key, clean(child, key)])
	);
	// A surviving child becomes a root in the visible hierarchy until its parent is restored.
	if ('parentTask' in row && result.parentTask === null) result.parent = null;
	return result;
}

function hiddenLink(value: unknown, relation?: string): boolean {
	if (!value || typeof value !== 'object') return false;
	const row = value as Record<string, unknown>;
	const target =
		relation === 'assignees'
			? 'user'
			: relation === 'dependencies'
				? 'dependency'
				: relation === 'dependents'
					? 'task'
					: null;
	if (!target || !(target in row)) return false;
	const linked = row[target] as SoftDeleted | null;
	return linked == null || linked.deleted_at != null;
}
