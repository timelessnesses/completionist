<script lang="ts">
	import SideRail from '$lib/components/SideRail.svelte';
	import MonthView from '$lib/components/MonthView.svelte';
	import PeoplePanel from '$lib/components/PeoplePanel.svelte';
	import MdiIcon from '$lib/components/MdiIcon.svelte';
	import EventDialog from '$lib/components/EventDialog.svelte';
	import {
		mdiPlus,
		mdiClose,
		mdiTagOutline,
		mdiPaperclip,
		mdiMessageTextOutline,
		mdiAccountMultipleOutline,
		mdiLinkVariant,
		mdiContentSave,
		mdiPlusCircleOutline,
		mdiMagnify,
		mdiCircleOutline,
		mdiCheckboxMarkedCircleOutline,
		mdiChevronDown,
		mdiChevronRight
	} from '@mdi/js';
	import type { PageProps } from './$types';
	import type { RichTask, UserSummary } from '$lib/features/tasks/types';
	import { colorToHex, hexToColor } from '$lib/features/tasks/color';
	import { onMount, tick } from 'svelte';
	import { subscribeWS } from '$lib/websocket.svelte';
	import { invalidateAll, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { Capacitor } from '@capacitor/core';
	import { LocalNotifications } from '@capacitor/local-notifications';
	import { PushNotifications } from '@capacitor/push-notifications';
	import { env } from '$env/dynamic/public';
	import { buildTaskReminderNotifications } from '$lib/task-reminders';
	import { registerServiceWorker, requestForNotificationPermission } from '$lib/notificationStuff';
	import { notificationPath } from '$lib/notification-links';

	let railOpen = $state(false);
	let peopleOpen = $state(false);
	let createOpen = $state(false);
	let taskBoardOpen = $state(false);
	let selectedTaskId = $state<string | null>(null);
	let taskSearch = $state('');
	let foldedTaskIds = $state(new Set<string>());
	let taskBusy = $state(false);
	let taskAction = $state<'none' | 'save' | 'toggle' | 'comment' | 'attachment'>('none');
	let taskError = $state('');
	let notificationTaskId = $state<string | null>(null);
	let notificationUserId = $state<string | null>(null);
	let notificationMessageId = $state<string | null>(null);
	let notificationNotice = $state<{ title: string; message: string } | null>(null);
	let handledNotificationLink = '';
	let notificationHighlightTimer: number | null = null;
	let commentDraft = $state('');
	let tagDraft = $state('');
	let dependencyDraft = $state('');
	let assigneeDraft = $state('');
	let taskDraft = $state<{
		id: string | null;
		task_name: string;
		description: string;
		color: string;
		completed: boolean;
		assigneeIds: string[];
		dependencyIds: string[];
		tagDrafts: Array<{ id?: string; tag: string; color?: { r: number; g: number; b: number } }>;
	}>({
		id: null,
		task_name: '',
		description: '',
		color: '#0b57d0',
		completed: false,
		assigneeIds: [],
		dependencyIds: [],
		tagDrafts: []
	});
	let reminderSyncInFlight = false;
	let reminderPermissionReady = false;
	let currentTime = $state(Date.now());

	function closeAll() {
		railOpen = false;
		peopleOpen = false;
		taskBoardOpen = false;
		notificationNotice = null;
	}

	let { data }: PageProps = $props();
	let events = $state<RichTask[]>(dedupeEvents(data.event));
	const upcoming = $derived.by(() =>
		[...events]
			.filter(
				(task) =>
					!task.completed &&
					task.status !== 'cancelled' &&
					+new Date(task.start_at) >= +startOfToday(currentTime) &&
					+new Date(task.end_at) > currentTime
			)
			.sort(
				(a, b) =>
					assignmentRank(a) - assignmentRank(b) || +new Date(a.start_at) - +new Date(b.start_at)
			)
	);
	const lateTasks = $derived.by(() =>
		[...events]
			.filter(
				(task) =>
					!task.completed && task.status !== 'cancelled' && +new Date(task.end_at) <= currentTime
			)
			.sort(
				(a, b) => assignmentRank(a) - assignmentRank(b) || +new Date(a.end_at) - +new Date(b.end_at)
			)
	);
	const { filters } = data;
	const users = (data.users ?? []) as UserSummary[];
	const viewerId = data.viewerId;
	const isAdmin = data.isAdmin;
	const viewer = $derived(users.find((u) => u.id === viewerId) ?? null);
	const taskMap = $derived.by(() => new Map(events.map((task) => [task.id, task])));
	const activeTasks = $derived.by(() =>
		[...events]
			.filter((task) => {
				const q = taskSearch.trim().toLowerCase();
				if (!q) return true;
				return (
					task.task_name.toLowerCase().includes(q) ||
					(task.description ?? '').toLowerCase().includes(q) ||
					(task.tags ?? []).some((tag) => tag.tag?.tag?.toLowerCase().includes(q))
				);
			})
			.sort(compareTasks)
	);
	type TaskRow = { key: string; task: RichTask; depth: number; hasChildren: boolean };
	const taskRows = $derived.by(() => {
		const query = taskSearch.trim().toLowerCase();
		const children = new Map<string, RichTask[]>();
		const dependencyParents = new Map<string, RichTask[]>();
		const dependencyIds = new Set<string>();
		for (const task of events) {
			if (task.parent && taskMap.has(task.parent)) {
				children.set(task.parent, [...(children.get(task.parent) ?? []), task]);
			}
			for (const link of task.dependencies ?? []) {
				const dependency = taskMap.get(link.dependency_id);
				if (!dependency) continue;
				dependencyIds.add(dependency.id);
				dependencyParents.set(dependency.id, [
					...(dependencyParents.get(dependency.id) ?? []),
					task
				]);
			}
		}
		for (const list of children.values()) list.sort(compareTasks);

		const nestedTasks = (current: RichTask): RichTask[] => {
			const combined = [
				...(children.get(current.id) ?? []),
				...(current.dependencies ?? [])
					.map((link) => taskMap.get(link.dependency_id))
					.filter((task): task is RichTask => !!task)
			];
			return [...new Map(combined.map((task) => [task.id, task])).values()].sort(compareTasks);
		};

		const visibleIds = new Set(activeTasks.map((task) => task.id));
		if (query) {
			const queue = [...visibleIds];
			while (queue.length) {
				const id = queue.shift()!;
				const current = taskMap.get(id);
				const ancestors = [
					...(current?.parent ? [taskMap.get(current.parent)] : []),
					...(dependencyParents.get(id) ?? [])
				].filter((task): task is RichTask => !!task);
				for (const ancestor of ancestors) {
					if (visibleIds.has(ancestor.id)) continue;
					visibleIds.add(ancestor.id);
					queue.push(ancestor.id);
				}
			}
		}

		const rows: TaskRow[] = [];
		const covered = new Set<string>();
		const walk = (task: RichTask, depth: number, ancestry: Set<string>, path: string) => {
			if (ancestry.has(task.id)) return;
			covered.add(task.id);
			const nested = nestedTasks(task);
			if (!query || visibleIds.has(task.id))
				rows.push({ key: `${path}/${task.id}`, task, depth, hasChildren: nested.length > 0 });
			if (!query && foldedTaskIds.has(task.id)) return;
			const nextAncestry = new Set(ancestry).add(task.id);
			for (const child of nested) walk(child, depth + 1, nextAncestry, `${path}/${task.id}`);
		};

		for (const root of events
			.filter((task) => (!task.parent || !taskMap.has(task.parent)) && !dependencyIds.has(task.id))
			.sort(compareTasks)) {
			walk(root, 0, new Set(), 'root');
		}
		for (const task of [...events].sort(compareTasks)) {
			if (!covered.has(task.id)) walk(task, 0, new Set(), 'root');
		}
		return rows;
	});
	const taskCount = $derived(events.length);
	const completedCount = $derived(events.filter((task) => !!task.completed).length);
	const projectCount = $derived(
		events.filter(
			(task) => (task.subtasks?.length ?? 0) > 0 || (task.dependencies?.length ?? 0) > 0
		).length
	);
	const selectedTask = $derived(
		(selectedTaskId ? taskMap.get(selectedTaskId) : null) ??
			activeTasks.find((task) => !task.completed) ??
			activeTasks[0] ??
			null
	);

	$effect(() => {
		events = dedupeEvents(data.event);
	});

	function dedupeEvents(items: RichTask[]): RichTask[] {
		return [...new Map(items.map((event) => [event.id, event])).values()];
	}

	function upsertEvent(items: RichTask[], event: RichTask): RichTask[] {
		return items.some((item) => item.id === event.id)
			? items.map((item) => (item.id === event.id ? event : item))
			: [...items, event];
	}

	function onCreated(ev: RichTask) {
		events = upsertEvent(events, ev);
		selectedTaskId = ev.id;
	}

	function onUpdated(ev: RichTask) {
		events = upsertEvent(events, ev);
	}

	function onDeleted(id: string) {
		events = events.filter((x) => x.id !== id);
		if (selectedTaskId === id) selectedTaskId = null;
	}

	async function openNotificationLink(url: URL) {
		const kind = url.searchParams.get('notification');
		const taskId = url.searchParams.get('task_id');
		const userId = url.searchParams.get('user_id');
		const messageId = url.searchParams.get('message_id');

		if (kind === 'dm' || kind === 'direct_message') {
			if (!userId || !users.some((candidate) => candidate.id === userId)) {
				notificationNotice = {
					title: 'Conversation unavailable',
					message: 'This person is no longer available in your workspace.'
				};
			} else {
				closeAll();
				notificationUserId = userId;
				notificationMessageId = messageId;
				peopleOpen = true;
			}
		} else if (kind === 'task' || kind === 'event') {
			const target = taskId ? events.find((event) => event.id === taskId) : null;
			if (!target) {
				notificationNotice = {
					title: 'Event unavailable',
					message: 'This event was deleted or is no longer available to you.'
				};
			} else {
				closeAll();
				taskSearch = '';
				foldedTaskIds = new Set();
				selectedTaskId = target.id;
				notificationTaskId = target.id;
				taskBoardOpen = true;
				await tick();
				window.requestAnimationFrame(() => {
					document
						.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(target.id)}"]`)
						?.scrollIntoView({ behavior: 'smooth', block: 'center' });
				});
				if (notificationHighlightTimer !== null) {
					window.clearTimeout(notificationHighlightTimer);
				}
				notificationHighlightTimer = window.setTimeout(() => {
					notificationTaskId = null;
				}, 4_500);
			}
		}

		const cleanUrl = new URL(url);
		for (const key of ['notification', 'task_id', 'user_id', 'message_id']) {
			cleanUrl.searchParams.delete(key);
		}
		replaceState(cleanUrl, page.state);
	}

	$effect(() => {
		const kind = page.url.searchParams.get('notification');
		if (!kind) return;
		const key = page.url.href;
		if (handledNotificationLink === key) return;
		handledNotificationLink = key;
		void openNotificationLink(new URL(page.url));
	});

	$effect(() => {
		if (!Capacitor.isNativePlatform()) return;
		const reminderTasks = events.map((task) => ({
			id: task.id,
			task_name: task.task_name,
			end_at: task.end_at,
			completed: task.completed
		}));
		void syncLocalReminders(reminderTasks);
	});

	type TaskActivityItem =
		| {
				type: 'comment';
				id: string;
				created_at: Date | string;
				comment: string;
				user_id: string;
				user?: UserSummary;
		  }
		| {
				type: 'attachment';
				id: string;
				created_at: Date | string;
				file_name: string;
				file_url: string;
				user_id: string;
				user?: UserSummary;
		  };

	function openTaskBoard() {
		taskBoardOpen = true;
		if (!selectedTaskId) {
			selectedTaskId =
				activeTasks.find((task) => !task.completed)?.id ?? activeTasks[0]?.id ?? null;
		}
	}

	function startOfToday(timestamp = Date.now()): Date {
		const now = new Date(timestamp);
		return new Date(now.getFullYear(), now.getMonth(), now.getDate());
	}

	function assignmentRank(task: RichTask): number {
		if (viewerId && (task.assignees ?? []).some((assignee) => assignee.user_id === viewerId))
			return 0;
		if (viewerId && task.owner === viewerId) return 1;
		return 2;
	}

	function toggleTaskFold(id: string) {
		const next = new Set(foldedTaskIds);
		next.has(id) ? next.delete(id) : next.add(id);
		foldedTaskIds = next;
	}

	function compareTasks(a: RichTask, b: RichTask): number {
		const aCompleted = a.completed ? 1 : 0;
		const bCompleted = b.completed ? 1 : 0;
		if (aCompleted !== bCompleted) return aCompleted - bCompleted;

		const aScore = taskProjectScore(a);
		const bScore = taskProjectScore(b);
		if (aScore !== bScore) return bScore - aScore;

		if (a.importance_value !== b.importance_value) {
			return b.importance_value - a.importance_value;
		}

		return +new Date(a.start_at) - +new Date(b.start_at);
	}

	function taskProjectScore(task: RichTask): number {
		const descendantScore = (task.subtasks?.length ?? 0) * 10;
		const dependencyScore = (task.dependents?.length ?? 0) * 4;
		const depthPenalty = task.parent ? depthOf(task) * 2 : 0;
		return descendantScore + dependencyScore - depthPenalty;
	}

	function depthOf(task: RichTask): number {
		let depth = 0;
		let current = task.parent;
		const guard = new Set<string>();
		while (current && !guard.has(current)) {
			guard.add(current);
			const parentTask = taskMap.get(current);
			current = parentTask?.parent ?? null;
			depth += 1;
		}
		return depth;
	}

	function canComplete(task: RichTask): boolean {
		if (isAdmin) return true;
		if (!viewerId) return false;
		if (task.owner === viewerId) return true;
		return (task.assignees ?? []).some((assignee) => assignee.user_id === viewerId);
	}

	async function syncLocalReminders(
		reminderTasks: Array<{
			id: string;
			task_name: string;
			end_at: Date | number | string;
			completed?: Date | number | string | null;
		}>
	) {
		if (!Capacitor.isNativePlatform() || reminderSyncInFlight) return;
		reminderSyncInFlight = true;
		try {
			if (!reminderPermissionReady) {
				const permission = await LocalNotifications.checkPermissions();
				if (permission.display !== 'granted') {
					const requested = await LocalNotifications.requestPermissions();
					if (requested.display !== 'granted') return;
				}
				reminderPermissionReady = true;
			}

			const pending = await LocalNotifications.getPending();
			const existing = pending.notifications.filter((notification) => {
				const extra = notification.extra as { scope?: string } | undefined;
				return extra?.scope === 'task-reminder';
			});
			if (existing.length > 0) {
				await LocalNotifications.cancel({
					notifications: existing.map((notification) => ({ id: notification.id }))
				});
			}

			const reminders = buildTaskReminderNotifications(reminderTasks);

			if (reminders.length > 0) {
				await LocalNotifications.schedule({ notifications: reminders });
			}
		} finally {
			reminderSyncInFlight = false;
		}
	}

	function syncTaskDraft(task: RichTask | null) {
		if (!task) {
			taskDraft = {
				id: null,
				task_name: '',
				description: '',
				color: '#0b57d0',
				completed: false,
				assigneeIds: [],
				dependencyIds: [],
				tagDrafts: []
			};
			return;
		}
		taskDraft = {
			id: task.id,
			task_name: task.task_name,
			description: task.description ?? '',
			color: colorToHex(task.color),
			completed: !!task.completed,
			assigneeIds: (task.assignees ?? []).map((assignee) => assignee.user_id),
			dependencyIds: (task.dependencies ?? []).map((dependency) => dependency.dependency_id),
			tagDrafts: (task.tags ?? []).map((tag) => ({
				id: tag.tag_id,
				tag: tag.tag?.tag ?? '',
				color: tag.tag?.color
			}))
		};
	}

	$effect(() => {
		syncTaskDraft(selectedTask);
	});

	async function saveSelectedTask() {
		if (!taskDraft.id) return;
		taskBusy = true;
		taskAction = 'save';
		taskError = '';
		try {
			const res = await fetch(`/api/events?id=${encodeURIComponent(taskDraft.id)}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					task_name: taskDraft.task_name.trim(),
					description: taskDraft.description.trim() || null,
					color: hexToColor(taskDraft.color),
					completed: taskDraft.completed ? Date.now() : null,
					assignee_ids: taskDraft.assigneeIds,
					dependency_ids: taskDraft.dependencyIds,
					tags: taskDraft.tagDrafts.map((tag) => ({
						id: tag.id,
						tag: tag.tag,
						color: tag.color
					}))
				})
			});
			if (!res.ok) {
				const text = await res.text().catch(() => '');
				throw new Error(text || `Request failed (${res.status})`);
			}
			const updated = (await res.json()) as RichTask;
			events = events.map((task) => (task.id === updated.id ? updated : task));
			selectedTaskId = updated.id;
		} catch (error) {
			taskError = error instanceof Error ? error.message : 'Failed to save task.';
		} finally {
			taskBusy = false;
			taskAction = 'none';
		}
	}

	async function toggleTaskComplete(task: RichTask) {
		if (!canComplete(task)) return;
		taskBusy = true;
		taskAction = 'toggle';
		taskError = '';
		try {
			const nextCompleted = task.completed ? null : Date.now();
			const res = await fetch(`/api/events?id=${encodeURIComponent(task.id)}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					completed: nextCompleted,
					status: nextCompleted ? 'completed' : 'todo'
				})
			});
			if (!res.ok) {
				const text = await res.text().catch(() => '');
				throw new Error(text || `Request failed (${res.status})`);
			}
			const updated = (await res.json()) as RichTask;
			events = events.map((item) => (item.id === updated.id ? updated : item));
			if (selectedTaskId === task.id) selectedTaskId = updated.id;
		} catch (error) {
			taskError = error instanceof Error ? error.message : 'Failed to update completion.';
		} finally {
			taskBusy = false;
			taskAction = 'none';
		}
	}

	function mergedActivity(task: RichTask): TaskActivityItem[] {
		return [
			...(task.comments ?? []).map((comment) => ({
				type: 'comment' as const,
				id: comment.id,
				created_at: comment.created_at,
				comment: comment.comment,
				user_id: comment.user_id,
				user: comment.user
			})),
			...(task.attachments ?? []).map((attachment) => ({
				type: 'attachment' as const,
				id: attachment.id,
				created_at: attachment.created_at,
				file_name: attachment.file_name,
				file_url: attachment.file_url,
				user_id: attachment.user_id,
				user: attachment.user
			}))
		].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
	}

	function addDraftTag() {
		const text = tagDraft.trim();
		if (!text || !selectedTask) return;
		if (taskDraft.tagDrafts.some((tag) => tag.tag.toLowerCase() === text.toLowerCase())) {
			tagDraft = '';
			return;
		}
		taskDraft.tagDrafts = [
			...taskDraft.tagDrafts,
			{ tag: text, color: hexToColor(taskDraft.color) }
		];
		tagDraft = '';
	}

	function addDraftDependency(task: RichTask) {
		if (!selectedTask || task.id === selectedTask.id) return;
		if (taskDraft.dependencyIds.includes(task.id)) return;
		taskDraft.dependencyIds = [...taskDraft.dependencyIds, task.id];
		dependencyDraft = '';
	}

	function addDraftAssignee(user: UserSummary) {
		if (!taskDraft.assigneeIds.includes(user.id)) {
			taskDraft.assigneeIds = [...taskDraft.assigneeIds, user.id];
		}
		assigneeDraft = '';
	}

	function removeDraftTag(index: number) {
		taskDraft.tagDrafts = taskDraft.tagDrafts.filter((_, i) => i !== index);
	}

	function removeDraftDependency(id: string) {
		taskDraft.dependencyIds = taskDraft.dependencyIds.filter((depId) => depId !== id);
	}

	function removeDraftAssignee(id: string) {
		taskDraft.assigneeIds = taskDraft.assigneeIds.filter((assigneeId) => assigneeId !== id);
	}

	async function addLocalComment() {
		if (!selectedTask || !commentDraft.trim()) return;
		taskBusy = true;
		taskAction = 'comment';
		try {
			await tick();
			const res = await fetch('/api/events/comments', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					task_id: selectedTask.id,
					comment: commentDraft.trim()
				})
			});
			if (!res.ok) {
				const text = await res.text().catch(() => '');
				throw new Error(text || `Request failed (${res.status})`);
			}
			const updated = (await res.json()) as RichTask;
			events = events.map((task) => (task.id === updated.id ? updated : task));
			selectedTaskId = updated.id;
			commentDraft = '';
		} finally {
			taskBusy = false;
			taskAction = 'none';
		}
	}

	async function addLocalAttachment(file: File) {
		if (!selectedTask) return;
		taskBusy = true;
		taskAction = 'attachment';
		try {
			await tick();
			const attachment = {
				id: crypto.randomUUID(),
				task_id: selectedTask.id,
				user_id: viewerId ?? 'local',
				file_name: file.name,
				file_url: URL.createObjectURL(file),
				created_at: new Date(),
				user: viewer ?? undefined
			};
			events = events.map((task) =>
				task.id === selectedTask.id
					? { ...task, attachments: [...(task.attachments ?? []), attachment] }
					: task
			);
		} finally {
			taskBusy = false;
			taskAction = 'none';
		}
	}

	onMount(() => {
		let disposed = false;
		let pushActionHandle: { remove: () => Promise<void> } | null = null;
		let localActionHandle: { remove: () => Promise<void> } | null = null;
		let pushReceivedHandle: { remove: () => Promise<void> } | null = null;
		const clockTimer = window.setInterval(() => {
			currentTime = Date.now();
		}, 30_000);
		const onMessage = (event: MessageEvent) => {
			let data: any;
			try {
				data = JSON.parse(event.data);
			} catch {
				return;
			}
			if (data.type === 'shouldRefetch') {
				invalidateAll();
			}
		};

		const unsubscribeWS = subscribeWS({ message: onMessage });
		(async () => {
			if (Capacitor.isNativePlatform()) {
				pushActionHandle = await PushNotifications.addListener(
					'pushNotificationActionPerformed',
					(action) => {
						window.location.assign(
							notificationPath(action.notification.data as Record<string, unknown>)
						);
					}
				);
				localActionHandle = await LocalNotifications.addListener(
					'localNotificationActionPerformed',
					(action) => {
						window.location.assign(
							notificationPath(action.notification.extra as Record<string, unknown>)
						);
					}
				);
				pushReceivedHandle = await PushNotifications.addListener(
					'pushNotificationReceived',
					async (notification) => {
						console.log('push notification received:', notification);
						await invalidateAll();
					}
				);
				console.log('requesting notification permission for native platform...');
				await requestForNotificationPermission();
			} else {
				if ((await Notification.requestPermission()) === 'granted') {
					console.log('notification permission granted, registering service worker...');
					await registerServiceWorker(env.PUBLIC_VAPID_PUBLIC);
				}
			}
		})();

		return () => {
			disposed = true;
			window.clearInterval(clockTimer);
			if (notificationHighlightTimer !== null) window.clearTimeout(notificationHighlightTimer);
			void pushActionHandle?.remove();
			void localActionHandle?.remove();
			unsubscribeWS();
		};
	});
</script>

<svelte:head>
	<title>Co-Calendar</title>
</svelte:head>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape') closeAll();
	}}
/>

<div class="page">
	<div class="shell">
		<!-- Off-canvas drawer on mobile, plain flex child on desktop -->
		<div class="dock left" class:open={railOpen}>
			<button class="close" aria-label="Close menu" onclick={closeAll}>
				<MdiIcon path={mdiClose} size={20} />
			</button>
			<SideRail {events} {upcoming} late={lateTasks} onCreate={() => (createOpen = true)} />
		</div>

		<MonthView
			onMenu={() => (railOpen = true)}
			onPeople={() => (peopleOpen = true)}
			{filters}
			{events}
			{users}
			tasks={events}
			{viewerId}
			{isAdmin}
			{onUpdated}
			{onDeleted}
		/>

		<div class="dock right" class:open={peopleOpen}>
			<button class="close" aria-label="Close people panel" onclick={closeAll}>
				<MdiIcon path={mdiClose} size={20} />
			</button>
			<PeoplePanel
				isOwner={data.isOwner}
				{viewerId}
				openUserId={notificationUserId}
				openMessageId={notificationMessageId}
			/>
		</div>

		{#if railOpen || peopleOpen}
			<button class="scrim" aria-label="Close panels" onclick={closeAll}></button>
		{/if}

		<button class="fab" aria-label="Create event" onclick={() => (createOpen = true)}>
			<MdiIcon path={mdiPlus} size={26} />
		</button>

		<button class="task-fab" aria-label="Open task board" onclick={openTaskBoard}>
			<MdiIcon path={mdiMagnify} size={18} />
			<span>Task board</span>
		</button>

		<EventDialog
			bind:open={createOpen}
			oncreated={onCreated}
			tags={filters}
			{users}
			tasks={events}
		/>
	</div>

	{#if notificationNotice}
		<div
			class="notification-notice-scrim"
			role="presentation"
			onclick={() => (notificationNotice = null)}
		></div>
		<div
			class="notification-notice"
			role="alertdialog"
			aria-modal="true"
			aria-labelledby="notification-notice-title"
		>
			<span class="notification-notice-mark" aria-hidden="true">!</span>
			<div>
				<p class="eyebrow">Notification target</p>
				<h2 id="notification-notice-title">{notificationNotice.title}</h2>
				<p>{notificationNotice.message}</p>
			</div>
			<button type="button" onclick={() => (notificationNotice = null)}>Got it</button>
		</div>
	{/if}

	{#if taskBoardOpen}
		<div class="task-overlay" aria-hidden="true" onclick={() => (taskBoardOpen = false)}></div>
		<section class="task-workbench" aria-label="Task workbench">
			<header class="task-top">
				<div class="task-titleblock">
					<p class="eyebrow">Task board</p>
					<h2>Projects, assignments, and notes</h2>
					<p class="sub">
						{taskCount} tasks, {projectCount} project-like items, {completedCount} completed
					</p>
				</div>
				<label class="search">
					<MdiIcon path={mdiMagnify} size={18} />
					<input type="search" placeholder="Search tasks, notes, or tags" bind:value={taskSearch} />
				</label>
			</header>

			<div class="task-grid">
				<aside class="task-list">
					{#each taskRows as row, index (row.key)}
						{@const task = row.task}
						<div
							class="task-row"
							class:root-task={row.depth === 0}
							class:notification-target={notificationTaskId === task.id}
							data-task-id={task.id}
							style:--task-depth={row.depth}
							style:--reveal-index={Math.min(index, 12)}
						>
							{#if row.hasChildren}
								<button
									class="fold-btn"
									type="button"
									aria-label={foldedTaskIds.has(task.id) ? 'Expand task' : 'Collapse task'}
									onclick={() => toggleTaskFold(task.id)}
								>
									<MdiIcon
										path={foldedTaskIds.has(task.id) ? mdiChevronRight : mdiChevronDown}
										size={17}
									/>
								</button>
							{:else}
								<span class="fold-spacer"></span>
							{/if}
							<button
								class="task-pill"
								class:selected={selectedTask?.id === task.id}
								class:completed={!!task.completed}
								onclick={() => (selectedTaskId = task.id)}
							>
								<div class="pill-head">
									<span class="status-dot" style:background={colorToHex(task.color)}></span>
									<strong>{task.task_name}</strong>
									{#if task.completed}
										<MdiIcon path={mdiCheckboxMarkedCircleOutline} size={16} />
									{:else}
										<MdiIcon path={mdiCircleOutline} size={16} />
									{/if}
								</div>
								<div class="pill-meta">
									<span>{taskProjectScore(task)} score</span>
									<span>{task.subtasks?.length ?? 0} children</span>
									{#if (task.dependencies?.length ?? 0) > 0}
										<span>{task.dependencies?.length ?? 0} dependencies</span>
									{/if}
									<span>{task.assignees?.length ?? 0} assignees</span>
								</div>
								{#if (task.tags ?? []).length}
									<div class="pill-tags">
										{#each (task.tags ?? []).slice(0, 4) as tag}
											<span class="mini-tag">
												<span
													class="tag-dot"
													style:background={colorToHex(tag.tag?.color ?? task.color)}
												></span>
												{tag.tag?.tag}
											</span>
										{/each}
									</div>
								{/if}
								{#if task.completed}
									<div class="pill-note">Completed</div>
								{/if}
							</button>
						</div>
					{/each}
				</aside>

				<article class="task-detail">
					{#if selectedTask}
						<div class="detail-head">
							<div>
								<p class="eyebrow">Selected task</p>
								<h3>{selectedTask.task_name}</h3>
							</div>
							<button
								class="ghost-toggle"
								type="button"
								disabled={taskBusy || !canComplete(selectedTask)}
								onclick={() => toggleTaskComplete(selectedTask)}
							>
								<MdiIcon
									path={selectedTask.completed ? mdiCheckboxMarkedCircleOutline : mdiCircleOutline}
									size={18}
								/>
								{taskBusy && taskAction === 'toggle'
									? 'Updating...'
									: selectedTask.completed
										? 'Mark open'
										: 'Mark done'}
							</button>
						</div>

						<form
							class="detail-form"
							onsubmit={(e) => {
								e.preventDefault();
								saveSelectedTask();
							}}
						>
							<div class="grid2">
								<label class="field">
									<span class="lbl">Task name</span>
									<input type="text" bind:value={taskDraft.task_name} disabled={taskBusy} />
								</label>
								<label class="field">
									<span class="lbl">Color</span>
									<input
										type="color"
										class="picker"
										bind:value={taskDraft.color}
										disabled={taskBusy}
									/>
								</label>
							</div>

							<label class="field">
								<span class="lbl">Description</span>
								<textarea rows="4" bind:value={taskDraft.description} disabled={taskBusy}
								></textarea>
							</label>

							<label class="row">
								<input type="checkbox" bind:checked={taskDraft.completed} disabled={taskBusy} />
								<span>Completed</span>
							</label>

							<div class="field">
								<span class="lbl">Tags</span>
								<div class="chip-row">
									{#each taskDraft.tagDrafts as tag, index (tag.id ?? `${tag.tag}-${index}`)}
										<button type="button" class="chip" onclick={() => removeDraftTag(index)}>
											<span
												class="tag-dot"
												style:background={tag.color ? colorToHex(tag.color) : taskDraft.color}
											></span>
											{tag.tag}
										</button>
									{/each}
								</div>
								<div class="inline-add">
									<input
										type="text"
										placeholder="Add or autocomplete a tag"
										bind:value={tagDraft}
										disabled={taskBusy}
										onkeydown={(e) => {
											if (e.key === 'Enter') {
												e.preventDefault();
												addDraftTag();
											}
										}}
									/>
									<button type="button" class="mini-btn" onclick={addDraftTag}>Add</button>
								</div>
								<div class="suggestions">
									{#each filters.filter((tag) => !taskDraft.tagDrafts.some((picked) => picked.id === tag.id)) as tag (tag.id)}
										<button
											type="button"
											class="suggestion"
											disabled={taskBusy}
											onclick={() =>
												(taskDraft.tagDrafts = [
													...taskDraft.tagDrafts,
													{ id: tag.id, tag: tag.tag, color: tag.color }
												])}
										>
											<span class="tag-dot" style:background={colorToHex(tag.color)}></span>
											{tag.tag}
										</button>
									{/each}
								</div>
							</div>

							<div class="field">
								<span class="lbl">Assignees</span>
								<div class="chip-row">
									{#each taskDraft.assigneeIds as id (id)}
										{@const assignee = users.find((user) => user.id === id)}
										<button type="button" class="chip" onclick={() => removeDraftAssignee(id)}>
											<MdiIcon path={mdiAccountMultipleOutline} size={14} />
											{assignee?.name ?? id}
										</button>
									{/each}
								</div>
								<div class="inline-add">
									<input
										type="text"
										placeholder="Add assignee by name"
										bind:value={assigneeDraft}
										disabled={taskBusy}
										oninput={() => (assigneeDraft = assigneeDraft)}
									/>
									<button type="button" class="mini-btn" disabled>Add</button>
								</div>
								<div class="suggestions">
									{#each users.filter((user) => !taskDraft.assigneeIds.includes(user.id)) as user (user.id)}
										<button
											type="button"
											class="suggestion"
											disabled={taskBusy}
											onclick={() => addDraftAssignee(user)}
										>
											<MdiIcon path={mdiAccountMultipleOutline} size={14} />
											{user.name}
										</button>
									{/each}
								</div>
							</div>

							<div class="field">
								<span class="lbl">Dependencies</span>
								<div class="chip-row">
									{#each taskDraft.dependencyIds as id (id)}
										{@const dependency = taskMap.get(id)}
										<button type="button" class="chip" onclick={() => removeDraftDependency(id)}>
											<MdiIcon path={mdiLinkVariant} size={14} />
											{dependency?.task_name ?? id}
										</button>
									{/each}
								</div>
								<div class="inline-add">
									<input
										type="text"
										placeholder="Add dependency by task name"
										bind:value={dependencyDraft}
										disabled={taskBusy}
									/>
									<button type="button" class="mini-btn" disabled>Add</button>
								</div>
								<div class="suggestions">
									{#each activeTasks.filter((task) => task.id !== selectedTask.id && !taskDraft.dependencyIds.includes(task.id)) as task (task.id)}
										<button
											type="button"
											class="suggestion"
											disabled={taskBusy}
											onclick={() => addDraftDependency(task)}
										>
											<MdiIcon path={mdiLinkVariant} size={14} />
											{task.task_name}
										</button>
									{/each}
								</div>
							</div>

							<details class="thread" open>
								<summary>
									<span class="lbl">Activity thread</span>
									<span class="thread-count"
										>{(selectedTask.comments ?? []).length +
											(selectedTask.attachments ?? []).length}</span
									>
								</summary>
								<div class="thread-body">
									{#if mergedActivity(selectedTask).length}
										<div class="comment-list">
											{#each mergedActivity(selectedTask) as item (item.type + item.id)}
												<div class="thread-item" class:attachment={item.type === 'attachment'}>
													<div class="comment-head">
														<strong>{item.user?.name ?? item.user_id}</strong>
														<span>{new Date(item.created_at).toLocaleString()}</span>
													</div>
													{#if item.type === 'comment'}
														<p>{item.comment}</p>
													{:else}
														<p class="attachment-row">
															<MdiIcon path={mdiPaperclip} size={14} />
															<a href={item.file_url} target="_blank" rel="noreferrer"
																>{item.file_name}</a
															>
														</p>
													{/if}
												</div>
											{/each}
										</div>
									{:else}
										<p class="thread-empty">No comments or attachments yet.</p>
									{/if}
									<label class="field">
										<span class="lbl">Write a comment</span>
										<textarea
											rows="3"
											bind:value={commentDraft}
											placeholder="Write a text comment"
											disabled={taskBusy}></textarea>
									</label>
									<div class="inline-actions">
										<button
											type="button"
											class="mini-btn"
											disabled={taskBusy || !commentDraft.trim()}
											onclick={() => void addLocalComment()}
										>
											{taskBusy && taskAction === 'comment' ? 'Adding...' : 'Add comment'}
										</button>
										<label class="mini-btn file-btn" class:busy={taskBusy}>
											{taskBusy && taskAction === 'attachment' ? 'Adding...' : 'Attach file'}
											<input
												type="file"
												disabled={taskBusy}
												onchange={(e) => {
													const file = (e.currentTarget as HTMLInputElement).files?.[0];
													if (file) void addLocalAttachment(file);
												}}
											/>
										</label>
									</div>
								</div>
							</details>

							{#if taskError}
								<p class="error">{taskError}</p>
							{/if}

							<footer class="task-foot">
								<div class="meta">
									<span
										><MdiIcon path={mdiTagOutline} size={14} />
										{(selectedTask.tags ?? []).length} tags</span
									>
									<span
										><MdiIcon path={mdiMessageTextOutline} size={14} />
										{(selectedTask.comments ?? []).length} comments</span
									>
									<span
										><MdiIcon path={mdiPaperclip} size={14} />
										{(selectedTask.attachments ?? []).length} files</span
									>
								</div>
								<button class="save-btn" type="submit" disabled={taskBusy}>
									<MdiIcon path={mdiContentSave} size={16} />
									{taskBusy && taskAction === 'save' ? 'Saving...' : 'Save task'}
								</button>
							</footer>
						</form>
					{:else}
						<div class="empty-task">
							<MdiIcon path={mdiPlusCircleOutline} size={28} />
							<h3>No task selected</h3>
							<p>
								Pick a task pill on the left to inspect assignees, tags, dependencies, and notes.
							</p>
						</div>
					{/if}
				</article>
			</div>
			<button
				class="task-close"
				aria-label="Close task board"
				onclick={() => (taskBoardOpen = false)}
			>
				<MdiIcon path={mdiClose} size={20} />
			</button>
		</section>
	{/if}
</div>

<style>
	.page {
		display: flex;
		flex-direction: column;
		min-height: 100vh;
		background:
			radial-gradient(
				circle at top left,
				color-mix(in oklch, var(--color-primary) 12%, transparent),
				transparent 35%
			),
			linear-gradient(
				180deg,
				var(--color-background) 0%,
				color-mix(in oklch, var(--color-background) 90%, var(--color-card) 10%) 100%
			);
		color: var(--color-foreground);
	}
	.shell {
		display: flex;
		flex: 1;
		min-height: 0;
		overflow: visible;
		background: transparent;
	}
	.task-workbench {
		position: fixed;
		inset: 24px 24px 24px auto;
		width: min(1180px, calc(100vw - 48px));
		max-width: calc(100vw - 48px);
		background: color-mix(in oklch, var(--color-card) 92%, transparent);
		border: 1px solid var(--color-border);
		border-radius: 24px;
		box-shadow: 0 24px 70px rgba(15, 23, 42, 0.22);
		backdrop-filter: blur(16px);
		padding: 18px 18px 24px;
		overflow: auto;
		z-index: 55;
		animation: workbench-pop 280ms cubic-bezier(0.16, 1, 0.3, 1) both;
	}
	.task-overlay {
		position: fixed;
		inset: 0;
		z-index: 50;
		background: rgba(15, 23, 42, 0.42);
		animation: scrim-in 180ms ease-out both;
	}
	.notification-notice-scrim {
		position: fixed;
		inset: 0;
		z-index: 90;
		background: rgb(15 23 42 / 48%);
		backdrop-filter: blur(3px);
		animation: scrim-in 180ms ease-out both;
	}
	.notification-notice {
		position: fixed;
		top: 50%;
		left: 50%;
		z-index: 95;
		display: grid;
		grid-template-columns: 42px minmax(0, 1fr);
		gap: 14px;
		width: min(420px, calc(100vw - 40px));
		box-sizing: border-box;
		padding: 22px;
		border: 1px solid var(--color-border);
		border-radius: 22px;
		background: var(--color-card);
		box-shadow: 0 24px 80px rgb(15 23 42 / 34%);
		color: var(--color-foreground);
		transform: translate(-50%, -50%);
		animation: notification-notice-in 260ms cubic-bezier(0.16, 1, 0.3, 1) both;
	}
	.notification-notice-mark {
		display: grid;
		width: 42px;
		height: 42px;
		place-items: center;
		border-radius: 14px;
		background: color-mix(in oklch, var(--color-primary) 14%, var(--color-card));
		color: var(--color-primary);
		font-size: 22px;
		font-weight: 700;
	}
	.notification-notice .eyebrow {
		margin: 1px 0 4px;
		color: var(--color-primary);
		font-size: 10px;
		letter-spacing: 0.09em;
	}
	.notification-notice h2 {
		margin: 0;
		font-size: 20px;
		font-weight: 600;
	}
	.notification-notice div > p:last-child {
		margin: 7px 0 0;
		color: var(--color-muted-foreground);
		font-size: 13px;
		line-height: 1.45;
	}
	.notification-notice button {
		grid-column: 2;
		justify-self: end;
		min-width: 76px;
		padding: 9px 16px;
		border: 0;
		border-radius: 999px;
		background: var(--color-primary);
		color: var(--color-primary-foreground);
		font: inherit;
		font-size: 12px;
		font-weight: 650;
		cursor: pointer;
	}
	.task-close {
		position: absolute;
		top: 14px;
		right: 14px;
		border: 0;
		border-radius: 999px;
		width: 36px;
		height: 36px;
		display: grid;
		place-items: center;
		background: var(--color-muted);
		color: var(--color-foreground);
		cursor: pointer;
	}
	.task-fab {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		position: fixed;
		left: 16px;
		bottom: 16px;
		z-index: 45;
		border: 0;
		border-radius: 999px;
		padding: 12px 16px;
		background: var(--color-primary);
		color: var(--color-primary-foreground);
		box-shadow: 0 14px 32px rgba(15, 23, 42, 0.18);
		cursor: pointer;
	}
	.task-top {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 16px;
		margin-bottom: 14px;
	}
	.task-titleblock h2 {
		margin: 4px 0 6px;
		font-size: 22px;
		letter-spacing: -0.02em;
	}
	.eyebrow {
		margin: 0;
		text-transform: uppercase;
		letter-spacing: 0.14em;
		font-size: 11px;
		font-weight: 700;
		color: var(--color-muted-foreground);
	}
	.sub {
		margin: 0;
		color: var(--color-muted-foreground);
		font-size: 13px;
	}
	.search {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: min(360px, 100%);
		padding: 0 12px;
		border: 1px solid var(--color-border);
		border-radius: 16px;
		background: var(--color-card);
		box-shadow: 0 8px 26px rgba(15, 23, 42, 0.04);
	}
	.search input {
		flex: 1;
		border: 0;
		background: transparent;
		outline: none;
		font: inherit;
		padding: 14px 0;
		color: var(--color-foreground);
	}
	.task-grid {
		display: grid;
		grid-template-columns: minmax(260px, 1.05fr) minmax(320px, 1fr);
		gap: 14px;
		align-items: start;
	}
	.task-list,
	.task-detail {
		border: 1px solid var(--color-border);
		border-radius: 22px;
		background: var(--color-card);
		box-shadow: 0 12px 30px rgba(15, 23, 42, 0.06);
	}
	.task-list {
		display: grid;
		gap: 10px;
		padding: 12px;
		max-height: calc(100dvh - 220px);
		overflow: auto;
	}
	.task-row {
		display: grid;
		grid-template-columns: 24px minmax(0, 1fr);
		align-items: start;
		gap: 4px;
		margin-left: calc(var(--task-depth) * 15px);
		animation: task-reveal 360ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
		animation-delay: calc(var(--reveal-index) * 28ms);
	}
	.task-row.notification-target .task-pill {
		animation: notification-target-pulse 1.15s ease-in-out 3;
	}
	.task-row.root-task:not(:first-child) {
		margin-top: 8px;
		padding-top: 12px;
		border-top: 1px solid var(--color-border);
	}
	.root-task .task-pill {
		background: color-mix(in oklch, var(--color-primary) 8%, var(--color-card));
		border-radius: 14px;
	}
	.root-task .pill-head strong {
		font-size: 14px;
		letter-spacing: -0.01em;
	}
	.fold-btn,
	.fold-spacer {
		width: 24px;
		height: 34px;
	}
	.fold-btn {
		display: grid;
		place-items: center;
		border: 0;
		border-radius: 8px;
		background: transparent;
		color: var(--color-muted-foreground);
		cursor: pointer;
	}
	.fold-btn:hover {
		background: var(--color-muted);
		color: var(--color-foreground);
	}
	.task-pill {
		display: flex;
		flex-direction: column;
		gap: 8px;
		width: 100%;
		border: 1px solid transparent;
		border-radius: 18px;
		padding: 12px 14px;
		background: color-mix(in oklch, var(--color-card) 96%, var(--color-background));
		text-align: left;
		cursor: pointer;
		transition:
			transform 120ms ease,
			border-color 120ms ease,
			box-shadow 120ms ease,
			opacity 120ms ease;
	}
	.task-pill:hover {
		transform: translateY(-1px);
		box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08);
	}
	.task-pill.selected {
		border-color: color-mix(in oklch, var(--color-primary) 45%, transparent);
		box-shadow: 0 0 0 4px color-mix(in oklch, var(--color-primary) 12%, transparent);
	}
	.task-pill.completed {
		opacity: 0.55;
		transform: translateY(6px);
	}
	@keyframes task-reveal {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
	@keyframes workbench-pop {
		from {
			opacity: 0;
			transform: translateY(18px) scale(0.985);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}
	@keyframes scrim-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	@keyframes notification-target-pulse {
		0%,
		100% {
			box-shadow: 0 0 0 0 color-mix(in oklch, var(--color-primary) 0%, transparent);
		}
		45% {
			border-color: var(--color-primary);
			box-shadow: 0 0 0 7px color-mix(in oklch, var(--color-primary) 18%, transparent);
		}
	}
	@keyframes notification-notice-in {
		from {
			opacity: 0;
			transform: translate(-50%, calc(-50% + 14px)) scale(0.97);
		}
		to {
			opacity: 1;
			transform: translate(-50%, -50%) scale(1);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.task-row {
			animation: none;
		}
		.task-pill {
			transition: none;
		}
		.task-workbench,
		.task-overlay,
		.notification-notice,
		.notification-notice-scrim,
		.task-row.notification-target .task-pill {
			animation: none;
		}
	}
	.pill-head,
	.pill-meta,
	.pill-tags,
	.meta,
	.inline-actions {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}
	.pill-head strong {
		flex: 1;
		font-size: 14px;
	}
	.status-dot {
		width: 10px;
		height: 10px;
		border-radius: 999px;
		flex-shrink: 0;
	}
	.pill-meta {
		font-size: 12px;
		color: var(--color-muted-foreground);
	}
	.pill-tags {
		gap: 6px;
	}
	.mini-tag,
	.chip,
	.suggestion {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		padding: 7px 10px;
		background: var(--color-background);
		color: var(--color-foreground);
		font-size: 12px;
	}
	.pill-note {
		font-size: 12px;
		color: var(--color-muted-foreground);
	}
	.task-detail {
		padding: 16px;
	}
	.detail-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 14px;
	}
	.detail-head h3 {
		margin: 6px 0 0;
		font-size: 20px;
	}
	.ghost-toggle,
	.save-btn,
	.mini-btn {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		border: 0;
		border-radius: 14px;
		padding: 10px 14px;
		font: inherit;
		cursor: pointer;
	}
	.ghost-toggle {
		background: color-mix(in oklch, var(--color-primary) 12%, var(--color-card));
		color: var(--color-primary);
	}
	.save-btn {
		background: var(--color-primary);
		color: var(--color-primary-foreground);
		margin-left: auto;
	}
	.mini-btn {
		background: color-mix(in oklch, var(--color-primary) 10%, var(--color-card));
		color: var(--color-primary);
	}
	.file-btn {
		position: relative;
		overflow: hidden;
	}
	.file-btn input {
		position: absolute;
		inset: 0;
		opacity: 0;
		cursor: pointer;
	}
	.file-btn.busy {
		pointer-events: none;
	}
	.detail-form {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.field input,
	.field textarea,
	.inline-add input {
		font: inherit;
		border: 1px solid var(--color-border);
		border-radius: 14px;
		padding: 10px 12px;
		background: var(--color-background);
		color: var(--color-foreground);
	}
	.field textarea {
		resize: vertical;
	}
	.lbl {
		font-size: 12px;
		font-weight: 600;
		color: var(--color-muted-foreground);
	}
	.grid2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}
	.picker {
		width: 54px;
		height: 40px;
		border: 1px solid var(--color-border);
		border-radius: 12px;
		padding: 3px;
		background: var(--color-background);
	}
	.chip-row,
	.suggestions,
	.comment-list {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.inline-add {
		display: flex;
		gap: 8px;
	}
	.inline-add input {
		flex: 1;
	}
	.comment-list {
		flex-direction: column;
	}
	.thread {
		border: 1px solid var(--color-border);
		border-radius: 16px;
		background: var(--color-muted);
		overflow: hidden;
	}
	.thread summary {
		list-style: none;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 12px 14px;
		cursor: pointer;
	}
	.thread summary::-webkit-details-marker {
		display: none;
	}
	.thread-count {
		min-width: 1.75rem;
		padding: 2px 8px;
		border-radius: 999px;
		background: var(--color-background);
		color: var(--color-foreground);
		font-size: 12px;
		text-align: center;
	}
	.thread-body {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 0 14px 14px;
	}
	.thread-empty {
		margin: 0;
		font-size: 13px;
		color: var(--color-muted-foreground);
	}
	.comment-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 10px;
		font-size: 12px;
		color: var(--color-muted-foreground);
	}
	.thread-item {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 10px 12px;
		border: 1px solid var(--color-border);
		border-radius: 12px;
		background: var(--color-background);
	}
	.thread-item.attachment {
		border-style: dashed;
	}
	.attachment-row {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		margin: 0;
	}
	.error {
		margin: 0;
		color: var(--color-danger);
	}
	.task-foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding-top: 4px;
	}
	.task-foot .meta {
		color: var(--color-muted-foreground);
		font-size: 12px;
	}
	.empty-task {
		min-height: 380px;
		display: grid;
		place-items: center;
		text-align: center;
		color: var(--color-muted-foreground);
		border: 1px dashed var(--color-border);
		border-radius: 18px;
		background: linear-gradient(
			180deg,
			color-mix(in oklch, var(--color-card) 80%, transparent),
			color-mix(in oklch, var(--color-background) 96%, var(--color-card) 4%)
		);
		padding: 24px;
	}
	.empty-task h3 {
		margin: 8px 0 4px;
		color: var(--color-foreground);
	}
	.tag-dot {
		width: 10px;
		height: 10px;
		border-radius: 999px;
		flex-shrink: 0;
	}

	:global(html),
	:global(body) {
		margin: 0;
		height: 100%;
		font-family: var(--font-sans);
		background: var(--color-background);
		color: var(--color-foreground);
	}
	:global(*),
	:global(*::before),
	:global(*::after) {
		box-sizing: border-box;
	}
	:global(button) {
		font-family: inherit;
	}

	.dock {
		display: contents;
	}
	.close,
	.scrim,
	.fab {
		display: none;
	}

	@media (max-width: 1100px) {
		.task-grid {
			grid-template-columns: 1fr;
		}
		.task-list {
			max-height: none;
		}
	}

	@media (max-width: 860px) {
		.dock {
			display: block;
			position: fixed;
			top: 0;
			bottom: 0;
			z-index: 40;
			background: var(--color-background);
			transition: transform 0.24s ease;
		}
		.dock.left {
			left: 0;
			transform: translateX(-105%);
			box-shadow: 2px 0 12px rgba(0, 0, 0, 0.18);
		}
		.dock.right {
			right: 0;
			transform: translateX(105%);
			box-shadow: -2px 0 12px rgba(0, 0, 0, 0.18);
		}
		.dock.open {
			transform: translateX(0);
		}
		.dock :global(.rail),
		.dock :global(.panel) {
			height: 100%;
			border-left: 0;
		}
		.close {
			display: grid;
			place-items: center;
			position: absolute;
			top: 10px;
			right: 10px;
			z-index: 1;
			width: 32px;
			height: 32px;
			border-radius: 50%;
			border: 0;
			background: none;
			color: var(--color-foreground);
			cursor: pointer;
		}
		.close:hover {
			background: var(--color-muted);
		}
		.scrim {
			display: block;
			position: fixed;
			inset: 0;
			z-index: 30;
			border: 0;
			padding: 0;
			cursor: default;
			background: rgba(15, 23, 42, 0.35);
		}
		.fab {
			display: grid;
			place-items: center;
			position: fixed;
			right: 16px;
			bottom: 80px;
			z-index: 20;
			width: 56px;
			height: 56px;
			border-radius: 16px;
			border: 0;
			cursor: pointer;
			background: var(--color-primary);
			color: var(--color-primary-foreground);
			box-shadow: 0 4px 10px rgba(0, 0, 0, 0.22);
		}
		.fab:active {
			filter: brightness(0.95);
		}
		.task-workbench {
			inset: 12px;
			width: auto;
			max-width: none;
			padding: 14px;
		}
		.task-top {
			align-items: flex-start;
			flex-direction: column;
		}
		.search {
			min-width: 0;
			width: 100%;
		}
		.grid2 {
			grid-template-columns: 1fr;
		}
		.task-foot {
			flex-direction: column;
			align-items: stretch;
		}
		.save-btn {
			width: 100%;
			justify-content: center;
			margin-left: 0;
		}
	}
</style>
