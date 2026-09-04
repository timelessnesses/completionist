type TimedEvent = {
	start_at: Date | number | string;
};

function timestamp(value: Date | number | string): number {
	return +new Date(value);
}

export function compareEventStarts(a: TimedEvent, b: TimedEvent): number {
	return timestamp(a.start_at) - timestamp(b.start_at);
}

export function compareMostRecentlyStarted(a: TimedEvent, b: TimedEvent): number {
	return timestamp(b.start_at) - timestamp(a.start_at);
}

export function shouldShowPrestartCountdown(
	nextEvent: TimedEvent | null | undefined,
	now: number,
	windowMs = 60_000
): boolean {
	if (!nextEvent) return false;
	const remaining = timestamp(nextEvent.start_at) - now;
	return remaining > 0 && remaining <= windowMs;
}

export function formatTimeUntil(timestampValue: Date | number | string, now: number): string {
	const remaining = Math.max(timestamp(timestampValue) - now, 0);
	const days = Math.floor(remaining / 86_400_000);
	const hours = Math.floor((remaining % 86_400_000) / 3_600_000);
	const minutes = Math.floor((remaining % 3_600_000) / 60_000);
	const seconds = Math.floor((remaining % 60_000) / 1_000);
	const clock = [hours, minutes, seconds].map((part) => `${part}`.padStart(2, '0')).join(':');
	return days > 0 ? `${days}d ${clock}` : clock;
}
