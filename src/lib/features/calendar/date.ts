export const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;
export const WEEKDAYS_NARROW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;
export const MONTHS = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
] as const;

export interface DayCell {
	date: Date;
	inMonth: boolean;
	key: string;
}

export function toDateKey(date: Date): string {
	return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;
}

export function buildMonthGrid(year: number, month: number): DayCell[] {
	const firstDay = new Date(year, month, 1);
	const start = new Date(year, month, 1 - firstDay.getDay());
	return Array.from({ length: 42 }, (_, index) => {
		const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
		return { date, inMonth: date.getMonth() === month, key: toDateKey(date) };
	});
}

export function isSameDay(a: Date, b: Date): boolean {
	return (
		a.getFullYear() === b.getFullYear() &&
		a.getMonth() === b.getMonth() &&
		a.getDate() === b.getDate()
	);
}
export function addMonths(date: Date, amount: number): Date {
	return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}
export function addDays(date: Date, amount: number): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
}
export function startOfWeek(date: Date): Date {
	return addDays(date, -date.getDay());
}
export function hourLabel(hour: number): string {
	return `${hour}`.padStart(2, '0') + ':00';
}
export function prettyDate(iso: string): string {
	const date = new Date(`${iso}T00:00:00`);
	return `${MONTHS[date.getMonth()].slice(0, 3)} ${date.getDate()}`;
}
