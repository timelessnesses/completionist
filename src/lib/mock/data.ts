// ============================================================
// MOCK MODULE — swap these exports for API calls later.
// Everything the UI renders comes from this file.
// ============================================================

export type EventColor = 'blue' | 'purple' | 'green' | 'orange';

export interface CalendarEvent {
	id: string;
	title: string;
	/** ISO date: yyyy-mm-dd */
	date: string;
	time?: string;
	color: EventColor;
}

export type Role = 'Head' | 'Sec-Head' | 'Student';

export interface Person {
	id: string;
	name: string;
	role: Role;
	owner?: boolean;
	status: 'Active' | 'Invited';
}

export interface FilterTag {
	id: string;
	label: string;
	color: string;
}

/** Fixed "today" so the mock matches the design. Use `new Date()` in prod. */
export const MOCK_TODAY = new Date(2026, 7, 14); // Aug 14, 2026

export const workspace = {
	appName: 'Co-Calendar',
	calendarName: 'English major',
	sharedWith: 5,
	permission: 'Can view and edit',
	session: 'Active session'
};

export const events: CalendarEvent[] = [
	{ id: 'e1', title: 'Meet', date: '2026-08-01', time: '9:30 AM', color: 'blue' },
	{ id: 'e2', title: 'Sports Day', date: '2026-08-05', time: '11:00 AM', color: 'purple' },
	{ id: 'e3', title: 'Feedback', date: '2026-08-08', color: 'orange' },
	{ id: 'e4', title: 'Team Alignment', date: '2026-08-12', time: '2:00 PM', color: 'green' },
	{ id: 'e5', title: 'Review', date: '2026-08-13', color: 'blue' },
	{ id: 'e6', title: 'Board Presentation', date: '2026-08-21', color: 'orange' }
];

export const upcoming: CalendarEvent[] = [
	{ id: 'u1', title: 'Meet', date: '2026-10-01', time: '9:30 AM', color: 'blue' },
	{ id: 'u2', title: 'Sports Day', date: '2026-10-05', time: '11:00 AM', color: 'purple' },
	{ id: 'u3', title: 'Team Alignment', date: '2026-10-12', time: '2:00 PM', color: 'green' }
];

export const people: Person[] = [
	{ id: 'p1', name: 'Person 1', role: 'Head', owner: true, status: 'Active' },
	{ id: 'p2', name: 'Person 2', role: 'Sec-Head', status: 'Active' },
	{ id: 'p3', name: 'Person 3', role: 'Student', status: 'Active' },
	{ id: 'p4', name: 'Person 4', role: 'Student', status: 'Active' }
];

export const capacity = 30;

export const waiting: Person[] = [
	{ id: 'w1', name: 'Person 1', role: 'Student', status: 'Invited' },
	{ id: 'w2', name: 'Person 2', role: 'Student', status: 'Invited' },
	{ id: 'w3', name: 'Person 3', role: 'Student', status: 'Invited' },
	{ id: 'w4', name: 'Person 4', role: 'Student', status: 'Invited' }
];

export const filters: FilterTag[] = [
	{ id: 'f1', label: 'Work', color: '#1a73e8' },
	{ id: 'f2', label: 'Meetings', color: '#188038' },
	{ id: 'f3', label: 'Only English major', color: '#9334e6' },
	{ id: 'f4', label: 'Deadlines', color: '#d93025' }
];

/** Event pill palette (Google Calendar-ish). */
export const eventPalette: Record<EventColor, { bg: string; fg: string }> = {
	blue: { bg: '#d3e3fd', fg: '#041e49' },
	purple: { bg: '#e9d2fd', fg: '#40226b' },
	green: { bg: '#ceead6', fg: '#0d5226' },
	orange: { bg: '#feefc3', fg: '#6d4c00' }
};