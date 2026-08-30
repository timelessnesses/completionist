import { error } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { task, user } from '$lib/server/db/schema';
import { verifyCalendarFeedToken } from '$lib/server/calendar-feed';

export const GET = async ({ platform, url }) => {
	const token = url.searchParams.get('token');
	if (!token) throw error(401, 'Missing calendar feed token');
	const env = platform?.env as Env;
	let identity: Awaited<ReturnType<typeof verifyCalendarFeedToken>>;
	try {
		identity = await verifyCalendarFeedToken(env, token);
	} catch (e) {
		console.error('Failed to verify calendar feed token', e);
		throw error(401, 'Invalid calendar feed token');
	}
	const db = getDb(env.COMPLETIONIST_DB);
	const account = await db.query.user.findFirst({
		where: and(eq(user.id, identity.userId), isNull(user.deleted_at)),
		columns: { calendar_feed_token_version: true }
	});
	if (!account || account.calendar_feed_token_version !== identity.version) {
		throw error(401, 'Calendar feed URL has been revoked');
	}
	const events = await db.query.task.findMany({
		where: isNull(task.deleted_at),
		with: { tags: { with: { tag: true } } }
	});
	const body = buildCalendar(events, url.origin);
	return new Response(body, {
		headers: {
			'Content-Type': 'text/calendar; charset=utf-8',
			'Content-Disposition': 'inline; filename="completionist.ics"',
			'Cache-Control': 'private, no-store, max-age=0',
			'X-Content-Type-Options': 'nosniff'
		}
	});
};

type CalendarTask = typeof task.$inferSelect & {
	tags: Array<{ tag: { tag: string } }>;
};

function buildCalendar(events: CalendarTask[], origin: string) {
	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Completionist//Calendar Feed//EN',
		'CALSCALE:GREGORIAN',
		'METHOD:PUBLISH',
		'X-WR-CALNAME:Completionist'
	];
	for (const event of events) {
		lines.push('BEGIN:VEVENT');
		lines.push(`UID:${escapeText(event.id)}@completionist`);
		lines.push(`DTSTAMP:${utcDate(event.created_at)}`);
		if (event.all_day) {
			lines.push(`DTSTART;VALUE=DATE:${bangkokDate(event.start_at)}`);
			lines.push(`DTEND;VALUE=DATE:${exclusiveAllDayEnd(event.end_at)}`);
		} else {
			lines.push(`DTSTART:${utcDate(event.start_at)}`);
			lines.push(`DTEND:${utcDate(event.end_at)}`);
		}
		lines.push(`SUMMARY:${escapeText(event.task_name)}`);
		if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
		const categories = event.tags.flatMap((link) => (link.tag.tag ? [link.tag.tag] : []));
		if (categories.length) lines.push(`CATEGORIES:${categories.map(escapeText).join(',')}`);
		lines.push(`STATUS:${event.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`);
		lines.push(`X-COMPLETIONIST-STATUS:${event.status.toUpperCase()}`);
		lines.push(`X-COMPLETIONIST-IMPORTANCE:${event.importance_value}`);
		const eventUrl = new URL('/', origin);
		eventUrl.searchParams.set('notification', 'task');
		eventUrl.searchParams.set('task_id', event.id);
		lines.push(`URL:${eventUrl.toString()}`);
		lines.push('END:VEVENT');
	}
	lines.push('END:VCALENDAR');
	return `${lines.flatMap(foldLine).join('\r\n')}\r\n`;
}

function utcDate(value: Date) {
	return value
		.toISOString()
		.replace(/[-:]/g, '')
		.replace(/\.\d{3}Z$/, 'Z');
}

function bangkokDate(value: Date) {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Asia/Bangkok',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).formatToParts(value);
	const part = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((candidate) => candidate.type === type)?.value ?? '';
	return `${part('year')}${part('month')}${part('day')}`;
}

function exclusiveAllDayEnd(value: Date) {
	const end = new Date(value);
	end.setTime(end.getTime() + 24 * 60 * 60_000);
	return bangkokDate(end);
}

function escapeText(value: string) {
	return value
		.replace(/\\/g, '\\\\')
		.replace(/\r?\n/g, '\\n')
		.replace(/;/g, '\\;')
		.replace(/,/g, '\\,');
}

function foldLine(line: string) {
	const chunks: string[] = [];
	let current = '';
	let bytes = 0;
	for (const character of line) {
		const width = new TextEncoder().encode(character).length;
		const limit = chunks.length ? 74 : 75;
		if (bytes + width > limit && current) {
			chunks.push(current);
			current = character;
			bytes = width;
		} else {
			current += character;
			bytes += width;
		}
	}
	if (current || !chunks.length) chunks.push(current);
	return chunks.map((chunk, index) => (index ? ` ${chunk}` : chunk));
}
