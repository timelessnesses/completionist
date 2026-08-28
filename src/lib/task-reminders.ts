import type { LocalNotificationSchema } from '@capacitor/local-notifications';

type ReminderTask = {
	id: string;
	task_name: string;
	end_at: Date | number | string;
	completed?: Date | number | string | null;
};

const DAILY_REMINDER_HOUR = 9;
const DAILY_REMINDER_MINUTE = 0;

export function buildTaskReminderNotifications(
	tasks: ReminderTask[],
	now = new Date()
): LocalNotificationSchema[] {
	const reminders: LocalNotificationSchema[] = [];

	for (const task of tasks) {
		if (task.completed) continue;

		const due = new Date(task.end_at);
		if (Number.isNaN(due.getTime()) || due.getTime() <= now.getTime()) continue;

		const dueDay = startOfDay(due);
		const today = startOfDay(now);
		const daysLeft = Math.max(0, Math.ceil((dueDay.getTime() - today.getTime()) / DAY_MS));

		for (let dayOffset = 0; dayOffset <= daysLeft; dayOffset++) {
			const reminderDay = addDays(today, dayOffset);
			const isFinalDay = dayOffset === daysLeft;
			const notifyAt = isFinalDay
				? due
				: atLocalTime(reminderDay, DAILY_REMINDER_HOUR, DAILY_REMINDER_MINUTE);
			const scheduledAt =
				notifyAt.getTime() <= now.getTime() ? new Date(now.getTime() + 60_000) : notifyAt;
			const remainingDays = Math.max(daysLeft - dayOffset, 0);
			const body =
				remainingDays === 0
					? `${task.task_name} is due today. Treat this one like an alarm.`
					: `${task.task_name} has ${remainingDays} day${remainingDays === 1 ? '' : 's'} left.`;

			reminders.push({
				id: reminderId(task.id, dayOffset),
				title:
					remainingDays === 0
						? `${task.task_name} is due today`
						: `${task.task_name} due in ${remainingDays} day${remainingDays === 1 ? '' : 's'}`,
				body,
				isExactNotification: isFinalDay,
				isExactMandatory: isFinalDay,
				schedule: {
					at: scheduledAt,
					allowWhileIdle: true
				},
				foreground: true,
				autoCancel: true,
				interruptionLevel: isFinalDay ? 'timeSensitive' : 'active',
				threadIdentifier: task.id,
				group: task.id,
				extra: {
					scope: 'task-reminder',
					type: 'task_notification',
					task_id: task.id,
					taskId: task.id,
					dayOffset,
					remainingDays,
					dueAt: due.toISOString(),
					url: `/?${new URLSearchParams({ notification: 'task', task_id: task.id })}`
				}
			});
		}
	}

	return reminders;
}

function reminderId(taskId: string, dayOffset: number): number {
	let hash = 0;
	for (const character of `${taskId}:${dayOffset}`) {
		hash = (hash * 31 + character.charCodeAt(0)) | 0;
	}
	return Math.abs(hash) % 2_147_483_647;
}

function startOfDay(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, amount: number): Date {
	const next = new Date(date);
	next.setDate(next.getDate() + amount);
	return next;
}

function atLocalTime(date: Date, hour: number, minute: number): Date {
	const next = new Date(date);
	next.setHours(hour, minute, 0, 0);
	return next;
}

const DAY_MS = 24 * 60 * 60 * 1000;
