import type { ReminderUnit } from '$lib/server/db/schema';

export type ReminderRule = {
	lead_value: number;
	lead_unit: ReminderUnit;
	repeat_value: number | null;
	repeat_unit: ReminderUnit | null;
};

const FIXED_UNIT_MS: Record<Exclude<ReminderUnit, 'month'>, number> = {
	hour: 60 * 60_000,
	day: 24 * 60 * 60_000,
	week: 7 * 24 * 60 * 60_000
};

export function reminderStartAt(endAt: Date | number | string, rule: ReminderRule): Date {
	return shiftDate(new Date(endAt), -rule.lead_value, rule.lead_unit);
}

export function reminderOccurrenceInWindow(
	endAt: Date | number | string,
	rule: ReminderRule,
	windowStart: Date | number,
	windowEnd: Date | number
): Date | null {
	const end = new Date(endAt);
	const from = new Date(windowStart);
	const until = new Date(windowEnd);
	const first = reminderStartAt(end, rule);
	if (![end, from, until, first].every((value) => Number.isFinite(value.getTime()))) return null;
	if (first >= from && first < until && first <= end) return first;
	if (!rule.repeat_value || !rule.repeat_unit || first >= end) return null;

	if (rule.repeat_unit !== 'month') {
		const interval = FIXED_UNIT_MS[rule.repeat_unit] * rule.repeat_value;
		const elapsed = from.getTime() - first.getTime();
		const step = Math.max(0, Math.ceil(elapsed / interval));
		const candidate = new Date(first.getTime() + step * interval);
		return candidate >= from && candidate < until && candidate <= end ? candidate : null;
	}

	let candidate = first;
	for (let step = 1; step <= 1200 && candidate < until && candidate <= end; step += 1) {
		candidate = shiftDate(first, step * rule.repeat_value, 'month');
		if (candidate >= from && candidate < until && candidate <= end) return candidate;
	}
	return null;
}

export function nextReminderOccurrence(
	endAt: Date | number | string,
	rule: ReminderRule,
	after: Date | number = Date.now()
): Date | null {
	const end = new Date(endAt);
	const cursor = new Date(after);
	const first = reminderStartAt(end, rule);
	if (![end, cursor, first].every((value) => Number.isFinite(value.getTime()))) return null;
	if (first > cursor && first <= end) return first;
	if (!rule.repeat_value || !rule.repeat_unit || first >= end) return null;

	if (rule.repeat_unit !== 'month') {
		const interval = FIXED_UNIT_MS[rule.repeat_unit] * rule.repeat_value;
		const step = Math.max(1, Math.floor((cursor.getTime() - first.getTime()) / interval) + 1);
		const candidate = new Date(first.getTime() + step * interval);
		return candidate <= end ? candidate : null;
	}

	for (let step = 1; step <= 1200; step += 1) {
		const candidate = shiftDate(first, step * rule.repeat_value, 'month');
		if (candidate > end) return null;
		if (candidate > cursor) return candidate;
	}
	return null;
}

export function reminderRuleKey(rule: ReminderRule): string {
	return [rule.lead_value, rule.lead_unit, rule.repeat_value ?? '', rule.repeat_unit ?? ''].join(
		':'
	);
}

export function reminderRuleSummary(rule: ReminderRule): string {
	const lead = `${rule.lead_value} ${pluralUnit(rule.lead_unit, rule.lead_value)} before the end`;
	if (!rule.repeat_value || !rule.repeat_unit) return `Once, ${lead}`;
	return `${lead}, then every ${rule.repeat_value} ${pluralUnit(rule.repeat_unit, rule.repeat_value)}`;
}

export function pluralUnit(unit: ReminderUnit, value: number): string {
	return value === 1 ? unit : `${unit}s`;
}

function shiftDate(source: Date, amount: number, unit: ReminderUnit): Date {
	if (unit !== 'month') {
		return new Date(source.getTime() + amount * FIXED_UNIT_MS[unit]);
	}
	const next = new Date(source);
	const originalDay = next.getUTCDate();
	next.setUTCDate(1);
	next.setUTCMonth(next.getUTCMonth() + amount);
	const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
	next.setUTCDate(Math.min(originalDay, lastDay));
	return next;
}
