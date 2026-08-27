<script lang="ts">
	import {
		mdiClose,
		mdiDeleteOutline,
		mdiAccountMultipleOutline,
		mdiLinkVariant,
		mdiPaperclip
	} from '@mdi/js';
	import MdiIcon from './MdiIcon.svelte';
	import type { RichTask, UserSummary } from '$lib/features/tasks/types';
	import { colorToHex, hexToColor } from '$lib/features/tasks/color';

	let {
		open = $bindable(false),
		event = null,
		canEdit = false,
		users = [],
		tasks = [],
		onupdated,
		ondeleted
	}: {
		open?: boolean;
		event?: RichTask | null;
		canEdit?: boolean;
		users?: UserSummary[];
		tasks?: RichTask[];
		onupdated?: (ev: RichTask) => void;
		ondeleted?: (id: string) => void;
	} = $props();

	let title = $state('');
	let description = $state('');
	let date = $state('');
	let endDate = $state('');
	let startTime = $state('09:00');
	let endTime = $state('10:00');
	let allDay = $state(false);
	let color = $state('#0b57d0');
	let completed = $state(false);
	let assigneeQuery = $state('');
	let dependencyQuery = $state('');
	let selectedAssigneeIds = $state<string[]>([]);
	let selectedDependencyIds = $state<string[]>([]);
	let busy = $state(false);
	let errorMsg = $state('');

	const presetColors = ['#0b57d0', '#188038', '#b0600a', '#a50e0e', '#7c3aed', '#0b8043'];
	const assigneeSuggestions = $derived.by(() => {
		const q = assigneeQuery.trim().toLowerCase();
		return users
			.filter((user) => !selectedAssigneeIds.includes(user.id))
			.filter((user) => !q || user.name.toLowerCase().includes(q))
			.slice(0, 8);
	});
	const dependencySuggestions = $derived.by(() => {
		const q = dependencyQuery.trim().toLowerCase();
		return tasks
			.filter((task) => task.id !== event?.id)
			.filter((task) => !selectedDependencyIds.includes(task.id))
			.filter((task) => !q || task.task_name.toLowerCase().includes(q))
			.slice(0, 8);
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

	$effect(() => {
		if (!event) return;
		title = event.task_name;
		description = event.description ?? '';
		const start = new Date(event.start_at);
		const end = new Date(event.end_at);
		date = toDateInput(start);
		endDate = toDateInput(end);
		startTime = toTimeInput(start);
		endTime = toTimeInput(end);
		allDay = !!event.all_day;
		color = colorToHex(event.color);
		completed = !!event.completed;
		selectedAssigneeIds = (event.assignees ?? []).map((a) => a.user_id);
		selectedDependencyIds = (event.dependencies ?? []).map((d) => d.dependency_id);
		errorMsg = '';
	});

	function close() {
		open = false;
		errorMsg = '';
		assigneeQuery = '';
		dependencyQuery = '';
		selectedAssigneeIds = [];
		selectedDependencyIds = [];
	}

	function toDateInput(d: Date): string {
		return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
	}

	function toTimeInput(d: Date): string {
		return `${`${d.getHours()}`.padStart(2, '0')}:${`${d.getMinutes()}`.padStart(2, '0')}`;
	}

	function addAssignee(user: UserSummary) {
		if (!selectedAssigneeIds.includes(user.id)) {
			selectedAssigneeIds = [...selectedAssigneeIds, user.id];
		}
		assigneeQuery = '';
	}

	function removeAssignee(id: string) {
		selectedAssigneeIds = selectedAssigneeIds.filter((x) => x !== id);
	}

	function addDependency(task: RichTask) {
		if (!selectedDependencyIds.includes(task.id)) {
			selectedDependencyIds = [...selectedDependencyIds, task.id];
		}
		dependencyQuery = '';
	}

	function removeDependency(id: string) {
		selectedDependencyIds = selectedDependencyIds.filter((x) => x !== id);
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

	async function save() {
		if (!event || !canEdit) return;
		errorMsg = '';
		if (!title.trim()) {
			errorMsg = 'Please add a title.';
			return;
		}
		const start = allDay ? new Date(`${date}T00:00:00`) : new Date(`${date}T${startTime}:00`);
		const end = allDay ? new Date(`${endDate}T23:59:59`) : new Date(`${endDate}T${endTime}:00`);
		if (isNaN(start.getTime()) || isNaN(end.getTime())) {
			errorMsg = 'Invalid date or time.';
			return;
		}
		if (end < start) {
			errorMsg = 'End must be after start.';
			return;
		}

		busy = true;
		try {
			const res = await fetch(`/api/events?id=${encodeURIComponent(event.id)}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					task_name: title.trim(),
					description: description.trim() || null,
					color: hexToColor(color),
					start_at: start.getTime(),
					end_at: end.getTime(),
					all_day: allDay ? 1 : 0,
					completed: completed ? Date.now() : null,
					assignee_ids: selectedAssigneeIds,
					dependency_ids: selectedDependencyIds
				})
			});
			if (!res.ok) {
				const t = await res.text().catch(() => '');
				throw new Error(t || `Request failed (${res.status})`);
			}
			const updated: RichTask = await res.json();
			onupdated?.(updated);
			close();
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'Failed to update event.';
		} finally {
			busy = false;
		}
	}

	async function removeEvent() {
		if (!event || !canEdit) return;
		if (!confirm('Delete this event?')) return;

		busy = true;
		errorMsg = '';
		try {
			const res = await fetch(`/api/events?id=${encodeURIComponent(event.id)}`, {
				method: 'DELETE'
			});
			if (!res.ok) {
				const t = await res.text().catch(() => '');
				throw new Error(t || `Request failed (${res.status})`);
			}
			ondeleted?.(event.id);
			close();
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'Failed to delete event.';
		} finally {
			busy = false;
		}
	}

	function timeLabel(ms: Date): string {
		return `${`${ms.getHours()}`.padStart(2, '0')}:${`${ms.getMinutes()}`.padStart(2, '0')}`;
	}
</script>

{#if open && event}
	<button class="task-dialog-scrim" aria-label="Close event details" onclick={close}></button>

	<div
		class="task-dialog task-dialog--details"
		role="dialog"
		aria-modal="true"
		aria-label="Event details"
	>
		<header class="head">
			<h2>{canEdit ? 'Edit event' : 'Event details'}</h2>
			<button class="icon" aria-label="Close" onclick={close}>
				<MdiIcon path={mdiClose} size={20} />
			</button>
		</header>

		{#if canEdit}
			<form
				class="body"
				onsubmit={(e) => {
					e.preventDefault();
					save();
				}}
			>
				<label class="field">
					<span class="lbl">Title</span>
					<input type="text" bind:value={title} required />
				</label>

				<label class="row">
					<input type="checkbox" bind:checked={allDay} />
					<span>All day</span>
				</label>

				<label class="row">
					<input type="checkbox" bind:checked={completed} />
					<span>Completed</span>
				</label>

				<div class="grid2">
					<label class="field">
						<span class="lbl">Start date</span>
						<input type="date" bind:value={date} required />
					</label>
					{#if !allDay}
						<label class="field">
							<span class="lbl">Start time</span>
							<input type="time" bind:value={startTime} />
						</label>
					{/if}
				</div>

				<div class="grid2">
					<label class="field">
						<span class="lbl">End date</span>
						<input type="date" bind:value={endDate} required />
					</label>
					{#if !allDay}
						<label class="field">
							<span class="lbl">End time</span>
							<input type="time" bind:value={endTime} />
						</label>
					{/if}
				</div>

				<label class="field">
					<span class="lbl">Description</span>
					<textarea rows="3" bind:value={description}></textarea>
				</label>

				<div class="field">
					<span class="lbl">Color</span>
					<div class="color-row">
						<input class="picker" type="color" bind:value={color} aria-label="Custom color" />
						<div class="swatches">
							{#each presetColors as c}
								<button
									type="button"
									class="swatch"
									class:selected={color === c}
									style:background={c}
									aria-label={`color ${c}`}
									onclick={() => (color = c)}
								></button>
							{/each}
						</div>
					</div>
				</div>

				<div class="field">
					<span class="lbl">Assignees</span>
					<div class="selected-tags">
						{#each selectedAssigneeIds as id (id)}
							{@const user = users.find((item) => item.id === id)}
							<button type="button" class="tag-chip" onclick={() => removeAssignee(id)}>
								<MdiIcon path={mdiAccountMultipleOutline} size={14} />
								{user?.name ?? id}
							</button>
						{/each}
					</div>
					<div class="tag-input-wrap">
						<input
							class="tag-input"
							type="text"
							bind:value={assigneeQuery}
							placeholder="Add assignee"
							onkeydown={(e) => {
								if (e.key === 'Enter') {
									e.preventDefault();
									const exact = users.find(
										(user) => user.name.toLowerCase() === assigneeQuery.trim().toLowerCase()
									);
									if (exact) addAssignee(exact);
								}
							}}
						/>
					</div>
					<div class="suggestions">
						{#each assigneeSuggestions as user (user.id)}
							<button type="button" class="suggestion" onclick={() => addAssignee(user)}>
								<MdiIcon path={mdiAccountMultipleOutline} size={14} />
								{user.name}
							</button>
						{/each}
					</div>
				</div>

				<div class="field">
					<span class="lbl">Dependencies</span>
					<div class="selected-tags">
						{#each selectedDependencyIds as id (id)}
							{@const dep = tasks.find((item) => item.id === id)}
							<button type="button" class="tag-chip" onclick={() => removeDependency(id)}>
								<MdiIcon path={mdiLinkVariant} size={14} />
								{dep?.task_name ?? id}
							</button>
						{/each}
					</div>
					<div class="tag-input-wrap">
						<input
							class="tag-input"
							type="text"
							bind:value={dependencyQuery}
							placeholder="Add dependency"
							onkeydown={(e) => {
								if (e.key === 'Enter') {
									e.preventDefault();
									const exact = tasks.find(
										(task) => task.task_name.toLowerCase() === dependencyQuery.trim().toLowerCase()
									);
									if (exact) addDependency(exact);
								}
							}}
						/>
					</div>
					<div class="suggestions">
						{#each dependencySuggestions as task (task.id)}
							<button type="button" class="suggestion" onclick={() => addDependency(task)}>
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
							>{(event.comments ?? []).length + (event.attachments ?? []).length}</span
						>
					</summary>
					<div class="thread-body">
						{#if mergedActivity(event).length}
							<div class="comment-list">
								{#each mergedActivity(event) as item (item.type + item.id)}
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
												<a href={item.file_url} target="_blank" rel="noreferrer">{item.file_name}</a
												>
											</p>
										{/if}
									</div>
								{/each}
							</div>
						{:else}
							<p class="thread-empty">No comments or attachments yet.</p>
						{/if}
					</div>
				</details>

				{#if errorMsg}
					<p class="err">{errorMsg}</p>
				{/if}

				<footer class="foot">
					<button type="button" class="btn danger" onclick={removeEvent} disabled={busy}>
						<MdiIcon path={mdiDeleteOutline} size={16} />
						{busy ? 'Deleting...' : 'Delete'}
					</button>
					<div class="spacer"></div>
					<button type="button" class="btn ghost" onclick={close}>Cancel</button>
					<button class="btn primary" type="submit" disabled={busy}
						>{busy ? 'Saving...' : 'Save'}</button
					>
				</footer>
			</form>
		{:else}
			<div class="body read">
				<div class="title">{event.task_name}</div>
				<p class="meta">
					{new Date(event.start_at).toLocaleDateString()}
					{event.all_day ? '(All day)' : timeLabel(new Date(event.start_at))}
					-
					{new Date(event.end_at).toLocaleDateString()}
					{event.all_day ? '' : timeLabel(new Date(event.end_at))}
				</p>
				{#if event.description}
					<p class="desc">{event.description}</p>
				{:else}
					<p class="desc mute">No description</p>
				{/if}
				<details class="thread" open>
					<summary>
						<span class="lbl">Activity thread</span>
						<span class="thread-count"
							>{(event.comments ?? []).length + (event.attachments ?? []).length}</span
						>
					</summary>
					<div class="thread-body">
						{#if mergedActivity(event).length}
							<div class="comment-list">
								{#each mergedActivity(event) as item (item.type + item.id)}
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
												<a href={item.file_url} target="_blank" rel="noreferrer">{item.file_name}</a
												>
											</p>
										{/if}
									</div>
								{/each}
							</div>
						{:else}
							<p class="thread-empty">No comments or attachments yet.</p>
						{/if}
					</div>
				</details>
				<p class="owner-note">You can view this event, but only the owner can edit it.</p>
			</div>
		{/if}
	</div>
{/if}

<style>
	.task-dialog--details {
		width: min(520px, calc(100vw - 24px));
		max-height: calc(100dvh - 48px);
		padding: 10px 18px 18px;
	}
	.spacer {
		flex: 1;
	}

	.title {
		font-size: 20px;
		font-weight: 600;
		/* color: #1f1f1f; */
	}
	.meta {
		margin: 0;
		font-size: 13px;
		/* color: #5f6368; */
	}
	.desc {
		margin: 0;
		font-size: 14px;
		/* color: #1f1f1f; */
		white-space: pre-wrap;
	}
	.owner-note {
		margin: 8px 0 0;
		font-size: 12px;
		/* color: #5f6368; */
	}
</style>
