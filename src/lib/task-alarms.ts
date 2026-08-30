import { Capacitor, registerPlugin } from '@capacitor/core';

type NativeAlarm = {
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

const TaskAlarm = registerPlugin<{
	sync(options: { alarms: NativeAlarm[]; syncToken: string; refreshUrl: string }): Promise<{
		scheduled: number;
		notificationsAllowed: boolean;
		exactAlarmAllowed: boolean;
		fullScreenAllowed: boolean;
	}>;
	openSettings(): Promise<void>;
	openUnusedAppSettings(): Promise<{ alreadyDisabled: boolean }>;
}>('TaskAlarm');

let syncInFlight: Promise<void> | null = null;
let requestedSyncVersion = 0;

export function syncNativeTaskAlarms(): Promise<void> {
	if (!Capacitor.isNativePlatform()) return Promise.resolve();
	requestedSyncVersion += 1;
	if (syncInFlight) return syncInFlight;
	syncInFlight = syncUntilCurrent().finally(() => {
		syncInFlight = null;
	});
	return syncInFlight;
}

async function syncUntilCurrent() {
	let completedVersion: number;
	do {
		completedVersion = requestedSyncVersion;
		await sync();
	} while (completedVersion !== requestedSyncVersion);
}

export async function openNativeAlarmSettings(): Promise<void> {
	if (!Capacitor.isNativePlatform()) return;
	await TaskAlarm.openSettings();
}

export async function openNativeUnusedAppSettings(): Promise<void> {
	if (!Capacitor.isNativePlatform()) return;
	await TaskAlarm.openUnusedAppSettings();
}

async function sync() {
	const response = await fetch('/api/task-alarms', { headers: { accept: 'application/json' } });
	if (!response.ok) throw new Error((await response.text()) || 'Unable to load task alarms');
	const payload = (await response.json()) as {
		alarms: NativeAlarm[];
		sync_token: string;
		refresh_url: string;
	};
	const result = await TaskAlarm.sync({
		alarms: payload.alarms,
		syncToken: payload.sync_token,
		refreshUrl: new URL(payload.refresh_url, window.location.origin).href
	});
	console.info('Native task alarms synchronized:', {
		available: payload.alarms.length,
		scheduled: result.scheduled,
		notificationsAllowed: result.notificationsAllowed,
		exactAlarmAllowed: result.exactAlarmAllowed,
		fullScreenAllowed: result.fullScreenAllowed
	});
	if (!result.notificationsAllowed) {
		console.warn('Task alarm notifications are disabled; Android cannot display the alarm.');
	}
	if (!result.exactAlarmAllowed) {
		console.warn('Exact alarm access is disabled; Android may deliver task alarms late.');
	}
	if (!result.fullScreenAllowed) {
		console.warn(
			'Full-screen alarm access is disabled; Android will show a heads-up alarm instead.'
		);
	}
}
