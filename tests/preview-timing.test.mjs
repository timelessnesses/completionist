import assert from 'node:assert/strict';
import test from 'node:test';
import {
	compareEventStarts,
	compareMostRecentlyStarted,
	formatTimeUntil,
	shouldShowPrestartCountdown
} from '../src/lib/features/calendar/preview-timing.ts';

test('shows the pre-start countdown throughout the final minute', () => {
	const now = Date.UTC(2026, 8, 4, 16, 0, 0);
	assert.equal(shouldShowPrestartCountdown({ start_at: now + 60_000 }, now), true);
	assert.equal(shouldShowPrestartCountdown({ start_at: now + 30_000 }, now), true);
	assert.equal(shouldShowPrestartCountdown({ start_at: now + 60_001 }, now), false);
	assert.equal(shouldShowPrestartCountdown({ start_at: now }, now), false);
});

test('countdown eligibility does not depend on another active event', () => {
	const now = Date.UTC(2026, 8, 4, 16, 0, 0);
	const activeParent = { start_at: now - 3_600_000, end_at: now + 3_600_000 };
	assert.ok(activeParent.start_at <= now && now < activeParent.end_at);
	assert.equal(shouldShowPrestartCountdown({ start_at: now + 15_000 }, now), true);
});

test('formats the real upcoming task countdown with seconds at every distance', () => {
	const now = Date.UTC(2026, 8, 4, 12, 0, 0);
	assert.equal(formatTimeUntil(now + 2 * 86_400_000 + 3_661_000, now), '2d 01:01:01');
	assert.equal(formatTimeUntil(now + 61_000, now), '00:01:01');
	assert.equal(formatTimeUntil(now - 1, now), '00:00:00');
});

test('orders upcoming events chronologically and active events by latest start', () => {
	const early = { start_at: 100 };
	const late = { start_at: 200 };
	assert.deepEqual([late, early].sort(compareEventStarts), [early, late]);
	assert.deepEqual([early, late].sort(compareMostRecentlyStarted), [late, early]);
});
