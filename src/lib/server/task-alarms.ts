import { nextReminderOccurrence, reminderRuleKey } from '$lib/features/reminders/schedule';
import { getDb } from '$lib/server/db';
import { task } from '$lib/server/db/schema';
import { and, eq, isNull, ne } from 'drizzle-orm';

export type NativeTaskAlarm = {
	id: string;
	task_id: string;
	rule_key: string;
	task_name: string;
	description: string | null;
	occurrence_at: number;
	end_at: number;
	url: string;
};

export async function taskAlarmsForUser(
	env: Env,
	userId: string,
	after = Date.now()
): Promise<NativeTaskAlarm[]> {
	const db = getDb(env.COMPLETIONIST_DB);
	const candidates = await db.query.task.findMany({
		where: and(isNull(task.deleted_at), isNull(task.completed), ne(task.status, 'cancelled')),
		with: { reminders: true, assignees: true }
	});
	const alarms: NativeTaskAlarm[] = [];
	for (const item of candidates) {
		if (item.owner !== userId && !item.assignees.some((link) => link.user_id === userId)) continue;
		for (const reminder of item.reminders) {
			const occurrence = nextReminderOccurrence(item.end_at, reminder, after);
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
				url: `/?${new URLSearchParams({ notification: 'task', task_id: item.id })}`
			});
		}
	}
	return alarms.sort((a, b) => a.occurrence_at - b.occurrence_at);
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
		with: { reminders: true, assignees: true }
	});
	if (!item) return null;
	if (item.owner !== userId && !item.assignees.some((link) => link.user_id === userId)) return null;
	const reminder = item.reminders.find((rule) => reminderRuleKey(rule) === requested.rule_key);
	if (!reminder) return null;
	const occurrence = nextReminderOccurrence(item.end_at, reminder, requested.occurrence_at - 1);
	if (!occurrence || occurrence.getTime() !== requested.occurrence_at) return null;
	return {
		id: `${item.id}:${requested.rule_key}:${requested.occurrence_at}`,
		task_id: item.id,
		rule_key: requested.rule_key,
		task_name: item.task_name,
		description: item.description,
		occurrence_at: requested.occurrence_at,
		end_at: item.end_at.getTime(),
		url: `/?${new URLSearchParams({ notification: 'task', task_id: item.id })}`
	};
}
