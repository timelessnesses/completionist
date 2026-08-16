export const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;
export const WEEKDAYS_NARROW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;
export const MONTHS = [
	'January', 'February', 'March', 'April', 'May', 'June',
	'July', 'August', 'September', 'October', 'November', 'December'
] as const;

export interface DayCell {
	date: Date;
	inMonth: boolean;
	key: string;
}

export function toKey(d: Date): string {
	const m = `${d.getMonth() + 1}`.padStart(2, '0');
	const day = `${d.getDate()}`.padStart(2, '0');
	return `${d.getFullYear()}-${m}-${day}`;
}

/** Always returns 42 cells (6 weeks) starting on Sunday. */
export function buildMonthGrid(year: number, month: number): DayCell[] {
	const firstDow = new Date(year, month, 1).getDay();
	const start = new Date(year, month, 1 - firstDow);
	return Array.from({ length: 42 }, (_, i) => {
		const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
		return { date, inMonth: date.getMonth() === month, key: toKey(date) };
	});
}

export function isSameDay(a: Date, b: Date): boolean {
	return (
		a.getFullYear() === b.getFullYear() &&
		a.getMonth() === b.getMonth() &&
		a.getDate() === b.getDate()
	);
}

export function addMonths(d: Date, n: number): Date {
	return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

export function prettyDate(iso: string): string {
	const d = new Date(`${iso}T00:00:00`);
	return `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
}