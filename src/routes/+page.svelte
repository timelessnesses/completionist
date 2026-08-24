<script lang="ts">
	import SideRail from '$lib/components/SideRail.svelte';
	import MonthView from '$lib/components/MonthView.svelte';
	import PeoplePanel from '$lib/components/PeoplePanel.svelte';
	import MdiIcon from '$lib/components/MdiIcon.svelte';
	import CreateEventDialog from '$lib/components/CreateEventDialog.svelte';
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
		mdiCheckboxMarkedCircleOutline
	} from '@mdi/js';
	import type { PageProps } from './$types';
	import type { RichTask, UserSummary } from '$lib/mock/data';
	import { onMount, tick } from 'svelte';
	import { getWS } from '$lib/websocket.svelte';
	import { invalidateAll } from '$app/navigation';
	import { Capacitor } from '@capacitor/core';
	import { LocalNotifications } from '@capacitor/local-notifications';
	import { PushNotifications } from '@capacitor/push-notifications';
	import { env } from '$env/dynamic/public';
	import { buildTaskReminderNotifications } from '$lib/task-reminders';

	let railOpen = $state(false);
	let peopleOpen = $state(false);
	let createOpen = $state(false);
	let taskBoardOpen = $state(false);
	let selectedTaskId = $state<string | null>(null);
	let taskSearch = $state('');
	let taskBusy = $state(false);
	let taskAction = $state<'none' | 'save' | 'toggle' | 'comment' | 'attachment'>('none');
	let taskError = $state('');
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

	function closeAll() {
		railOpen = false;
		peopleOpen = false;
		taskBoardOpen = false;
	}

	let { data }: PageProps = $props();
	let events = $state<RichTask[]>(data.event);
	const upcoming = $derived.by(() =>
		[...(data.upcoming ?? events)]
			.filter((task) => new Date(task.start_at) >= startOfToday())
			.sort((a, b) => +new Date(a.start_at) - +new Date(b.start_at))
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
	const taskCount = $derived(events.length);
	const completedCount = $derived(events.filter((task) => !!task.completed).length);
	const projectCount = $derived(events.filter((task) => (task.subtasks?.length ?? 0) > 0).length);
	const selectedTask = $derived(
		(selectedTaskId ? taskMap.get(selectedTaskId) : null) ??
			activeTasks.find((task) => !task.completed) ??
			activeTasks[0] ??
			null
	);

	function onCreated(ev: RichTask) {
		events = [...events, ev];
		selectedTaskId = ev.id;
	}

	function onUpdated(ev: RichTask) {
		events = events.map((x) => (x.id === ev.id ? ev : x));
	}

	function onDeleted(id: string) {
		events = events.filter((x) => x.id !== id);
		if (selectedTaskId === id) selectedTaskId = null;
	}

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

	function rgbToHex(color: { r: number; g: number; b: number }): string {
		return `#${[color.r, color.g, color.b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
	}

	function hexToRgb(hex: string): { r: number; g: number; b: number } {
		const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
		if (!match) return { r: 11, g: 87, b: 208 };
		return {
			r: parseInt(match[1], 16),
			g: parseInt(match[2], 16),
			b: parseInt(match[3], 16)
		};
	}

	function startOfToday(): Date {
		const now = new Date();
		return new Date(now.getFullYear(), now.getMonth(), now.getDate());
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
			color: rgbToHex(task.color),
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
					color: hexToRgb(taskDraft.color),
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
		taskDraft.tagDrafts = [...taskDraft.tagDrafts, { tag: text, color: hexToRgb(taskDraft.color) }];
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

	async function requestForNotificationPermission() {
		console.log("push notifications permission request...");
		if ((await PushNotifications.checkPermissions()).receive === 'granted') return;
		console.log("requesting push notifications permission...");
		await PushNotifications.addListener('registration', (token) => {
			console.log("received FCM registration token:", token.value);
			fetch('/api/fcm', {
				method: 'POST',
				body: JSON.stringify({ token: token.value })
			});
		});

		await PushNotifications.requestPermissions();
		console.log("registering for push notifications...");
		await PushNotifications.register();
	}

	async function registerServiceWorker() {
		console.log('registering service worker...');
		if ('serviceWorker' in navigator) {
			const permission = await Notification.requestPermission();
			console.log('notification permission:', permission);
			console.log('service worker supported, registering...');
			const vapidPublic = env.PUBLIC_VAPID_PUBLIC;
			console.log('VAPID public key:', vapidPublic);
			if (!vapidPublic) return;
			const sw = await navigator.serviceWorker.register('/sw.js');
			const _ = await navigator.serviceWorker.ready;
			console.log('service worker registered:', sw);
			if (permission === 'granted') {
				const subscription = await sw.pushManager.subscribe({
					userVisibleOnly: true,
					applicationServerKey: urlBase64ToUint8Array(vapidPublic)
				});
				console.log('webpush subscription:', subscription);
				await fetch('/api/webpush', {
					method: 'POST',
					body: JSON.stringify(subscription.toJSON())
				});
			}
		}
	}

	function urlBase64ToUint8Array(base64String: string) {
		const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
		const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
		const rawData = window.atob(base64);
		const outputArray = new Uint8Array(rawData.length);
		for (let i = 0; i < rawData.length; ++i) {
			outputArray[i] = rawData.charCodeAt(i);
		}
		return outputArray;
	}

	onMount(() => {
		let ws: WebSocket | undefined;
		let disposed = false;
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

		void getWS()
			.then((connectedWS) => {
				if (disposed) return;
				ws = connectedWS;
				ws.addEventListener('message', onMessage);
			})
			.catch(() => {
				/* best effort */
			});
		void (async () => {
			if (Capacitor.isNativePlatform()) {
				console.log("requesting notification permission for native platform...");
				await requestForNotificationPermission();
			} else {
				console.log("registering service worker for web platform...");
				await registerServiceWorker();
			}
		})();

		return () => {
			disposed = true;
			ws?.removeEventListener('message', onMessage);
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
			<SideRail {events} {upcoming} onCreate={() => (createOpen = true)} />
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
			<PeoplePanel isOwner={data.isOwner} {viewerId} />
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

		<CreateEventDialog
			bind:open={createOpen}
			onevent={onCreated}
			tags={filters}
			{users}
			tasks={events}
		/>
	</div>

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
					{#each activeTasks as task (task.id)}
						<button
							class="task-pill"
							class:selected={selectedTask?.id === task.id}
							class:completed={!!task.completed}
							onclick={() => (selectedTaskId = task.id)}
						>
							<div class="pill-head">
								<span class="status-dot" style:background={rgbToHex(task.color)}></span>
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
								<span>{task.assignees?.length ?? 0} assignees</span>
							</div>
							{#if (task.tags ?? []).length}
								<div class="pill-tags">
									{#each (task.tags ?? []).slice(0, 4) as tag}
										<span class="mini-tag">
											<span
												class="tag-dot"
												style:background={rgbToHex(tag.tag?.color ?? task.color)}
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
												style:background={tag.color ? rgbToHex(tag.color) : taskDraft.color}
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
											<span class="tag-dot" style:background={rgbToHex(tag.color)}></span>
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
	}
	.task-overlay {
		position: fixed;
		inset: 0;
		z-index: 50;
		background: rgba(15, 23, 42, 0.42);
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
