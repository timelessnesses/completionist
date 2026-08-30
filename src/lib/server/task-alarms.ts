import {
	nextReminderOccurrence,
	reminderRuleKey,
	reminderStartAt,
	type ReminderRule
} from '$lib/features/reminders/schedule';
import { getDb } from '$lib/server/db';
import { task } from '$lib/server/db/schema';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { compareTaskPriority, taskPriority } from '$lib/features/tasks/priority';

const TASK_START_RULE_KEY = 'task-start';

export type NativeTaskAlarm = {
	id: string;
	task_id: string;
	rule_key: string;
	task_name: string;
	description: string | null;
	occurrence_at: number;
	end_at: number;
	url: string;
	importance_value: number;
	assigned_to_user: boolean;
	dependency_count: number;
};

export async function taskAlarmsForUser(
	env: Env,
	userId: string,
	after = Date.now()
): Promise<NativeTaskAlarm[]> {
	const db = getDb(env.COMPLETIONIST_DB);
	const candidates = await db.query.task.findMany({
		where: and(isNull(task.deleted_at), isNull(task.completed), ne(task.status, 'cancelled')),
		with: { reminders: true, assignees: true, dependencies: true }
	});
	const alarms: NativeTaskAlarm[] = [];
	for (const item of candidates) {
		if (item.owner !== userId && !item.assignees.some((link) => link.user_id === userId)) continue;
		const priority = taskPriority(item, userId);
		const priorityFields = {
			importance_value: priority.importance,
			assigned_to_user: priority.assignedToUser,
			dependency_count: priority.dependencyCount
		};
		const startOccurrence = nextTaskStartOccurrence(item, after);
		if (startOccurrence) {
			alarms.push({
				id: `${item.id}:${TASK_START_RULE_KEY}:${startOccurrence.getTime()}`,
				task_id: item.id,
				rule_key: TASK_START_RULE_KEY,
				task_name: item.task_name,
				description: item.description,
				occurrence_at: startOccurrence.getTime(),
				end_at: item.end_at.getTime(),
				url: `/?${new URLSearchParams({ notification: 'task', task_id: item.id })}`,
				...priorityFields
			});
		}
		for (const reminder of item.reminders) {
			const occurrence = nextNativeAlarmOccurrence(item.end_at, reminder, after);
			if (!occurrence) continue;
			const ruleKey = reminderRuleKey(reminder);
			alarms.push({
				id: `${item.id}:${ruleKey}:${occurrence.getTime()}`,
				task_id: item.id,
				rule_key: ruleKey,
				task_name: item.task_name,
				description: item.description,
				occurrence_at: occurrence.getTime(),
				end_at: item.end_at.getTime(),
				url: `/?${new URLSearchParams({ notification: 'task', task_id: item.id })}`,
				...priorityFields
			});
		}
	}
	const taskById = new Map(candidates.map((item) => [item.id, item]));
	return alarms.sort((a, b) => {
		const aTask = taskById.get(a.task_id);
		const bTask = taskById.get(b.task_id);
		return (
			(aTask && bTask ? compareTaskPriority(aTask, bTask, userId) : 0) ||
			a.occurrence_at - b.occurrence_at
		);
	});
}

export async function validateTaskAlarm(
	env: Env,
	userId: string,
	requested: { task_id: string; rule_key: string; occurrence_at: number }
): Promise<NativeTaskAlarm | null> {
	if (Math.abs(Date.now() - requested.occurrence_at) > 5 * 60_000) return null;
	const db = getDb(env.COMPLETIONIST_DB);
	const item = await db.query.task.findFirst({
		where: and(
			eq(task.id, requested.task_id),
			isNull(task.deleted_at),
			isNull(task.completed),
			ne(task.status, 'cancelled')
		),
		with: { reminders: true, assignees: true, dependencies: true }
	});
	if (!item) return null;
	if (item.owner !== userId && !item.assignees.some((link) => link.user_id === userId)) return null;
	const priority = taskPriority(item, userId);
	const priorityFields = {
		importance_value: priority.importance,
		assigned_to_user: priority.assignedToUser,
		dependency_count: priority.dependencyCount
	};
	if (requested.rule_key === TASK_START_RULE_KEY) {
		const occurrence = nextTaskStartOccurrence(item, requested.occurrence_at - 1);
		if (!occurrence || occurrence.getTime() !== requested.occurrence_at) return null;
		return {
			id: `${item.id}:${TASK_START_RULE_KEY}:${requested.occurrence_at}`,
			task_id: item.id,
			rule_key: TASK_START_RULE_KEY,
			task_name: item.task_name,
			description: item.description,
			occurrence_at: requested.occurrence_at,
			end_at: item.end_at.getTime(),
			url: `/?${new URLSearchParams({ notification: 'task', task_id: item.id })}`,
			...priorityFields
		};
	}
	const reminder = item.reminders.find((rule) => reminderRuleKey(rule) === requested.rule_key);
	if (!reminder) return null;
	const occurrence = nextNativeAlarmOccurrence(item.end_at, reminder, requested.occurrence_at - 1);
	if (!occurrence || occurrence.getTime() !== requested.occurrence_at) return null;
	return {
		id: `${item.id}:${requested.rule_key}:${requested.occurrence_at}`,
		task_id: item.id,
		rule_key: requested.rule_key,
		task_name: item.task_name,
		description: item.description,
		occurrence_at: requested.occurrence_at,
		end_at: item.end_at.getTime(),
		url: `/?${new URLSearchParams({ notification: 'task', task_id: item.id })}`,
		...priorityFields
	};
}

const NEAR_EVENT_FALLBACK_DELAY_MS = 10_000;
const ALARM_END_MARGIN_MS = 1_000;

function nextTaskStartOccurrence(
	item: { start_at: Date; end_at: Date; created_at: Date },
	after: Date | number
): Date | null {
	const cursor = new Date(after);
	if (item.start_at > cursor && item.start_at < item.end_at) return item.start_at;
	if (item.created_at < item.start_at || item.created_at >= item.end_at) return null;
	const fallbackAt = new Date(
		Math.min(
			item.created_at.getTime() + NEAR_EVENT_FALLBACK_DELAY_MS,
			item.end_at.getTime() - ALARM_END_MARGIN_MS
		)
	);
	return fallbackAt > cursor ? fallbackAt : null;
}

/**
 * A reminder can be created after its normal lead time has already passed. In that case, schedule
 * one deterministic near-immediate alarm. Tying it to created_at prevents later syncs from moving
 * the alarm forward and notifying the user repeatedly.
 */
function nextNativeAlarmOccurrence(
	endAt: Date,
	rule: ReminderRule & { created_at: Date },
	after: Date | number
): Date | null {
	const regularOccurrence = nextReminderOccurrence(endAt, rule, after);
	if (regularOccurrence) return regularOccurrence;

	const cursor = new Date(after);
	const reminderCreatedAt = new Date(rule.created_at);
	const reminderWindowStart = reminderStartAt(endAt, rule);
	if (
		![cursor, reminderCreatedAt, reminderWindowStart, endAt].every((value) =>
			Number.isFinite(value.getTime())
		) ||
		reminderCreatedAt < reminderWindowStart ||
		reminderCreatedAt >= endAt
	) {
		return null;
	}

	const fallbackAt = new Date(
		Math.min(
			reminderCreatedAt.getTime() + NEAR_EVENT_FALLBACK_DELAY_MS,
			endAt.getTime() - ALARM_END_MARGIN_MS
		)
	);
	return fallbackAt > cursor ? fallbackAt : null;
}
