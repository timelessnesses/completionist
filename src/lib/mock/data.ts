// ============================================================
// MOCK MODULE — swap these exports for API calls later.
// Everything the UI renders comes from this file.
// ============================================================

import type { Color } from "$lib/server/db/schema";


export interface CalendarEvent {
	id: string;
	title: string;
	/** ISO date: yyyy-mm-dd */
	date: string;
	time?: string;
	color: Color;
}

export interface Person {
	id: string;
	name: string;
	owner?: boolean;
	status?: 'Active' | 'Offline';
}

export interface FilterTag {
	id: string;
	label: string;
	color: string;
}