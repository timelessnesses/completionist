// ============================================================
// MOCK MODULE — swap these exports for API calls later.
// Everything the UI renders comes from this file.
// ============================================================

import type { Color, task_tag } from '$lib/server/db/schema';
import { task } from '$lib/server/db/schema';
import type { InferSelectModel } from 'drizzle-orm';

export type CalendarEvent = InferSelectModel<typeof task>;

export interface Person {
	id: string;
	name: string;
	owner?: boolean;
	status?: 'Active' | 'Offline';
}

export type FilterTag = InferSelectModel<typeof task_tag>;
