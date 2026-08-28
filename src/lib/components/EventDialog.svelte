<script lang="ts">
	import {
		mdiAccountMultipleOutline,
		mdiClose,
		mdiDeleteOutline,
		mdiLinkVariant,
		mdiMagnify,
		mdiPaperclip
	} from '@mdi/js';
	import MdiIcon from './MdiIcon.svelte';
	import type { FilterTag, RichTask, UserSummary } from '$lib/features/tasks/types';
	import { colorToHex, hexToColor } from '$lib/features/tasks/color';

	type SelectedTag = {
		id?: string;
		tag: string;
		color?: { r: number; g: number; b: number };
	};

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

	let {
		open = $bindable(false),
		event = null,
		canEdit = true,
		tags = [],
		users = [],
		tasks = [],
		oncreated,
		onupdated,
		ondeleted
	}: {
		open?: boolean;
		event?: RichTask | null;
		canEdit?: boolean;
		tags?: FilterTag[];
		users?: UserSummary[];
		tasks?: RichTask[];
		oncreated?: (event: RichTask) => void;
		onupdated?: (event: RichTask) => void;
		ondeleted?: (id: string) => void;
	} = $props();

	let title = $state('');
	let description = $state('');
	let date = $state(todayStr());
	let endDate = $state(todayStr());
	let startTime = $state('09:00');
	let endTime = $state('10:00');
	let allDay = $state(false);
	let color = $state('#0b57d0');
	let completed = $state(false);
	let tagQuery = $state('');
	let assigneeQuery = $state('');
	let dependencyQuery = $state('');
	let selectedTags = $state<SelectedTag[]>([]);
	let selectedAssigneeIds = $state<string[]>([]);
	let selectedDependencyIds = $state<string[]>([]);
	let busyAction = $state<'save' | 'delete' | null>(null);
	let errorMsg = $state('');
	let initializedKey = '';

	const presetColors = ['#0b57d0', '#188038', '#b0600a', '#a50e0e', '#7c3aed', '#0b8043'];
	const isCreate = $derived(!event);
	const isEditable = $derived(isCreate || canEdit);
	const dialogTitle = $derived(
		isCreate ? 'Create event' : canEdit ? 'Edit event' : 'Event details'
	);
	const assigneeSuggestions = $derived.by(() => {
		const query = assigneeQuery.trim().toLowerCase();
		return users
			.filter((user) => !selectedAssigneeIds.includes(user.id))
			.filter((user) => !query || user.name.toLowerCase().includes(query))
			.slice(0, 8);
	});
	const dependencySuggestions = $derived.by(() => {
		const query = dependencyQuery.trim().toLowerCase();
		return tasks
			.filter((task) => task.id !== event?.id)
			.filter((task) => !selectedDependencyIds.includes(task.id))
			.filter((task) => !query || task.task_name.toLowerCase().includes(query))
			.slice(0, 8);
	});
	const tagSuggestions = $derived.by(() => {
		const query = tagQuery.trim().toLowerCase();
		return tags
			.filter((tag) => !selectedTags.some((selected) => selected.id === tag.id))
			.filter((tag) => !query || tag.tag.toLowerCase().includes(query))
			.slice(0, 8);
	});
	const canCreateTag = $derived.by(() => {
		const query = tagQuery.trim();
		if (!query) return false;
		return ![...tags, ...selectedTags].some((tag) => tag.tag.toLowerCase() === query.toLowerCase());
	});

	$effect(() => {
		const key = open ? (event?.id ?? 'create') : 'closed';
		if (key === initializedKey) return;
		initializedKey = key;
		if (!open) return;

		if (event) populateFromEvent(event);
		else resetCreateForm();
	});

	function todayStr(): string {
		return toDateInput(new Date());
	}

	function toDateInput(value: Date): string {
		return `${value.getFullYear()}-${`${value.getMonth() + 1}`.padStart(2, '0')}-${`${value.getDate()}`.padStart(2, '0')}`;
	}

	function toTimeInput(value: Date): string {
		return `${`${value.getHours()}`.padStart(2, '0')}:${`${value.getMinutes()}`.padStart(2, '0')}`;
	}

	function resetCreateForm() {
		const today = todayStr();
		title = '';
		description = '';
		date = today;
		endDate = today;
		startTime = '09:00';
		endTime = '10:00';
		allDay = false;
		color = '#0b57d0';
		completed = false;
		selectedTags = [];
		selectedAssigneeIds = [];
		selectedDependencyIds = [];
		resetTransientState();
	}

	function populateFromEvent(value: RichTask) {
		const start = new Date(value.start_at);
		const end = new Date(value.end_at);
		title = value.task_name;
		description = value.description ?? '';
		date = toDateInput(start);
		endDate = toDateInput(end);
		startTime = toTimeInput(start);
		endTime = toTimeInput(end);
		allDay = !!value.all_day;
		color = colorToHex(value.color);
		completed = !!value.completed;
		selectedTags = (value.tags ?? [])
			.filter((link) => !!link.tag)
			.map((link) => ({ id: link.tag!.id, tag: link.tag!.tag, color: link.tag!.color }));
		selectedAssigneeIds = (value.assignees ?? []).map((assignee) => assignee.user_id);
		selectedDependencyIds = (value.dependencies ?? []).map(
			(dependency) => dependency.dependency_id
		);
		resetTransientState();
	}

	function resetTransientState() {
		tagQuery = '';
		assigneeQuery = '';
		dependencyQuery = '';
		errorMsg = '';
		busyAction = null;
	}

	function close() {
		open = false;
		resetTransientState();
	}

	function addTag(tag: FilterTag) {
		if (selectedTags.some((selected) => selected.id === tag.id)) return;
		selectedTags = [...selectedTags, { id: tag.id, tag: tag.tag, color: tag.color }];
		tagQuery = '';
	}

	function createTagFromQuery() {
		const value = tagQuery.trim();
		if (!value) return;
		const existing = tags.find((tag) => tag.tag.toLowerCase() === value.toLowerCase());
		if (existing) addTag(existing);
		else if (canCreateTag) {
			selectedTags = [...selectedTags, { tag: value, color: hexToColor(color) }];
			tagQuery = '';
		}
	}

	function removeTag(index: number) {
		selectedTags = selectedTags.filter((_, current) => current !== index);
	}

	function addAssignee(user: UserSummary) {
		if (!selectedAssigneeIds.includes(user.id)) {
			selectedAssigneeIds = [...selectedAssigneeIds, user.id];
		}
		assigneeQuery = '';
	}

	function removeAssignee(id: string) {
		selectedAssigneeIds = selectedAssigneeIds.filter((value) => value !== id);
	}

	function addDependency(task: RichTask) {
		if (!selectedDependencyIds.includes(task.id)) {
			selectedDependencyIds = [...selectedDependencyIds, task.id];
		}
		dependencyQuery = '';
	}

	function removeDependency(id: string) {
		selectedDependencyIds = selectedDependencyIds.filter((value) => value !== id);
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

	function timeLabel(value: Date): string {
		return `${`${value.getHours()}`.padStart(2, '0')}:${`${value.getMinutes()}`.padStart(2, '0')}`;
	}

	async function save() {
		if (!isEditable) return;
		errorMsg = '';
		if (!title.trim()) {
			errorMsg = 'Please add a title.';
			return;
		}

		const start = allDay ? new Date(`${date}T00:00:00`) : new Date(`${date}T${startTime}:00`);
		const end = allDay ? new Date(`${endDate}T23:59:59`) : new Date(`${endDate}T${endTime}:00`);
		if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
			errorMsg = 'Invalid date or time.';
			return;
		}
		if (end < start) {
			errorMsg = 'End must be after start.';
			return;
		}

		busyAction = 'save';
		try {
			const payload = {
				task_name: title.trim(),
				description: description.trim() || null,
				color: hexToColor(color),
				start_at: start.getTime(),
				end_at: end.getTime(),
				all_day: allDay ? 1 : 0,
				assignee_ids: selectedAssigneeIds,
				dependency_ids: selectedDependencyIds,
				tags: selectedTags.map((tag) => ({ id: tag.id, tag: tag.tag, color: tag.color })),
				...(event
					? { completed: completed ? Date.now() : null }
					: { status: 'todo' as const, importance_value: 0 })
			};
			const response = await fetch(
				event ? `/api/events?id=${encodeURIComponent(event.id)}` : '/api/events',
				{
					method: event ? 'PUT' : 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload)
				}
			);
			if (!response.ok) {
				const message = await response.text().catch(() => '');
				throw new Error(message || `Request failed (${response.status})`);
			}

			const saved: RichTask = await response.json();
			if (event) onupdated?.(saved);
			else oncreated?.(saved);
			close();
		} catch (error) {
			errorMsg =
				error instanceof Error ? error.message : `Failed to ${event ? 'update' : 'create'} event.`;
		} finally {
			busyAction = null;
		}
	}

	async function removeEvent() {
		if (!event || !canEdit || !confirm('Delete this event?')) return;
		busyAction = 'delete';
		errorMsg = '';
		try {
			const response = await fetch(`/api/events?id=${encodeURIComponent(event.id)}`, {
				method: 'DELETE'
			});
			if (!response.ok) {
				const message = await response.text().catch(() => '');
				throw new Error(message || `Request failed (${response.status})`);
			}
			ondeleted?.(event.id);
			close();
		} catch (error) {
			errorMsg = error instanceof Error ? error.message : 'Failed to delete event.';
		} finally {
			busyAction = null;
		}
	}
</script>

{#snippet activityThread(task: RichTask)}
	<details class="thread" open>
		<summary>
			<span class="lbl">Activity thread</span>
			<span class="thread-count"
				>{(task.comments ?? []).length + (task.attachments ?? []).length}</span
			>
		</summary>
		<div class="thread-body">
			{#if mergedActivity(task).length}
				<div class="comment-list">
					{#each mergedActivity(task) as item (item.type + item.id)}
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
									<a href={item.file_url} target="_blank" rel="noreferrer">{item.file_name}</a>
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
{/snippet}

{#if open && (isCreate || event)}
	<button
		class="task-dialog-scrim"
		aria-label={`Close ${dialogTitle.toLowerCase()}`}
		onclick={close}
	></button>

	<div
		class="task-dialog task-dialog--event"
		role="dialog"
		aria-modal="true"
		aria-label={dialogTitle}
	>
		<div class="grabber" aria-hidden="true"></div>
		<header class="head">
			<h2>{dialogTitle}</h2>
			<button class="icon" aria-label="Close" onclick={close}>
				<MdiIcon path={mdiClose} size={20} />
			</button>
		</header>

		{#if isEditable}
			<form
				class="body"
				onsubmit={(submitEvent) => {
					submitEvent.preventDefault();
					save();
				}}
			>
				<label class="field title-field">
					<span class="lbl">Title</span>
					<input
						class="title-input"
						type="text"
						bind:value={title}
						placeholder="Add title"
						required
					/>
				</label>

				<div class="check-row">
					<label class="row"
						><input type="checkbox" bind:checked={allDay} /><span>All day</span></label
					>
					{#if !isCreate}
						<label class="row"
							><input type="checkbox" bind:checked={completed} /><span>Completed</span></label
						>
					{/if}
				</div>

				<div class="grid2">
					<label class="field"
						><span class="lbl">Start date</span><input
							type="date"
							bind:value={date}
							required
						/></label
					>
					{#if !allDay}
						<label class="field"
							><span class="lbl">Start time</span><input
								type="time"
								bind:value={startTime}
							/></label
						>
					{/if}
				</div>
				<div class="grid2">
					<label class="field"
						><span class="lbl">End date</span><input
							type="date"
							bind:value={endDate}
							required
						/></label
					>
					{#if !allDay}
						<label class="field"
							><span class="lbl">End time</span><input type="time" bind:value={endTime} /></label
						>
					{/if}
				</div>

				<label class="field">
					<span class="lbl">Description</span>
					<textarea rows="3" bind:value={description} placeholder="Add description"></textarea>
				</label>

				<div class="field">
					<span class="lbl">Color</span>
					<div class="color-row">
						<input class="picker" type="color" bind:value={color} aria-label="Custom color" />
						<div class="swatches">
							{#each presetColors as preset}
								<button
									type="button"
									class="swatch"
									class:selected={color === preset}
									style:background={preset}
									aria-label={`Color ${preset}`}
									onclick={() => (color = preset)}
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
							<button type="button" class="tag-chip" onclick={() => removeAssignee(id)}
								><MdiIcon path={mdiClose} size={14} />{user?.name ?? id}</button
							>
						{/each}
					</div>
					<div class="tag-input-wrap">
						<input
							class="tag-input"
							type="search"
							bind:value={assigneeQuery}
							placeholder="Find an assignee"
							onkeydown={(keyEvent) => {
								if (keyEvent.key !== 'Enter') return;
								keyEvent.preventDefault();
								const exact = users.find(
									(user) => user.name.toLowerCase() === assigneeQuery.trim().toLowerCase()
								);
								if (exact) addAssignee(exact);
							}}
						/>
					</div>
					{#if assigneeQuery.trim() && assigneeSuggestions.length}
						<div class="suggestions">
							{#each assigneeSuggestions as user (user.id)}
								<button type="button" class="suggestion" onclick={() => addAssignee(user)}
									><MdiIcon path={mdiAccountMultipleOutline} size={14} />{user.name}</button
								>
							{/each}
						</div>
					{/if}
				</div>

				<div class="field">
					<span class="lbl">Dependencies</span>
					<div class="selected-tags">
						{#each selectedDependencyIds as id (id)}
							{@const dependency = tasks.find((item) => item.id === id)}
							<button type="button" class="tag-chip" onclick={() => removeDependency(id)}
								><MdiIcon path={mdiLinkVariant} size={14} />{dependency?.task_name ?? id}</button
							>
						{/each}
					</div>
					<div class="tag-input-wrap">
						<input
							class="tag-input"
							type="search"
							bind:value={dependencyQuery}
							placeholder="Find a dependency"
							onkeydown={(keyEvent) => {
								if (keyEvent.key !== 'Enter') return;
								keyEvent.preventDefault();
								const exact = dependencySuggestions.find(
									(task) => task.task_name.toLowerCase() === dependencyQuery.trim().toLowerCase()
								);
								if (exact) addDependency(exact);
							}}
						/>
					</div>
					{#if dependencyQuery.trim() && dependencySuggestions.length}
						<div class="suggestions">
							{#each dependencySuggestions as dependency (dependency.id)}
								<button type="button" class="suggestion" onclick={() => addDependency(dependency)}
									><MdiIcon path={mdiLinkVariant} size={14} />{dependency.task_name}</button
								>
							{/each}
						</div>
					{/if}
				</div>

				<div class="field tag-field">
					<div class="field-heading">
						<span class="lbl">Tags</span>
						<span class="selection-count">{selectedTags.length} selected</span>
					</div>
					<div class="selected-tags">
						{#each selectedTags as tag, index (tag.id ?? `${tag.tag}-${index}`)}
							<button type="button" class="tag-chip" onclick={() => removeTag(index)}>
								<span class="tag-dot" style:background={tag.color ? colorToHex(tag.color) : color}
								></span>
								{tag.tag}<MdiIcon path={mdiClose} size={13} />
							</button>
						{/each}
					</div>
					<div class="filter-input">
						<MdiIcon path={mdiMagnify} size={17} />
						<input
							type="search"
							bind:value={tagQuery}
							placeholder="Filter or create a tag"
							aria-label="Filter tags"
							onkeydown={(keyEvent) => {
								if (keyEvent.key === 'Enter') {
									keyEvent.preventDefault();
									createTagFromQuery();
								}
							}}
						/>
						{#if canCreateTag}<button type="button" class="mini" onclick={createTagFromQuery}
								>Create</button
							>{/if}
					</div>
					<div class="tag-results" aria-live="polite">
						{#each tagSuggestions as tag (tag.id)}
							<button type="button" class="tag-option" onclick={() => addTag(tag)}>
								<span class="tag-dot" style:background={colorToHex(tag.color)}></span>
								<span>{tag.tag}</span><span class="add-label">Add</span>
							</button>
						{:else}
							<p class="no-results">
								{tagQuery.trim() ? 'No matching tags' : 'All available tags are selected'}
							</p>
						{/each}
					</div>
				</div>

				{#if event}{@render activityThread(event)}{/if}
				{#if errorMsg}<p class="err">{errorMsg}</p>{/if}

				<footer class="foot">
					{#if event}
						<button type="button" class="btn danger" onclick={removeEvent} disabled={!!busyAction}
							><MdiIcon path={mdiDeleteOutline} size={16} />{busyAction === 'delete'
								? 'Deleting…'
								: 'Delete'}</button
						>
						<div class="spacer"></div>
					{/if}
					<button type="button" class="btn ghost" onclick={close}>Cancel</button>
					<button class="btn primary" type="submit" disabled={!!busyAction}
						>{busyAction === 'save'
							? 'Saving…'
							: isCreate
								? 'Create event'
								: 'Save changes'}</button
					>
				</footer>
			</form>
		{:else if event}
			<div class="body read">
				<div class="title">{event.task_name}</div>
				<p class="meta">
					{new Date(event.start_at).toLocaleDateString()}
					{event.all_day ? '(All day)' : timeLabel(new Date(event.start_at))} – {new Date(
						event.end_at
					).toLocaleDateString()}
					{event.all_day ? '' : timeLabel(new Date(event.end_at))}
				</p>
				{#if event.description}<p class="desc">{event.description}</p>{:else}<p class="desc mute">
						No description
					</p>{/if}
				{#if (event.tags ?? []).length}
					<div class="selected-tags">
						{#each event.tags ?? [] as link (link.tag_id)}
							{#if link.tag}<span class="tag-chip"
									><span class="tag-dot" style:background={colorToHex(link.tag.color)}></span>{link
										.tag.tag}</span
								>{/if}
						{/each}
					</div>
				{/if}
				{@render activityThread(event)}
				<p class="owner-note">You can view this event, but only the owner can edit it.</p>
			</div>
		{/if}
	</div>
{/if}

<style>
	.task-dialog--event {
		width: min(540px, calc(100vw - 32px));
		max-height: calc(100dvh - 48px);
		padding: 10px 20px 20px;
	}
	.grabber {
		display: none;
	}
	.task-dialog--event .body {
		gap: 14px;
	}
	.title-input {
		border: 0;
		border-bottom: 1px solid var(--color-border);
		border-radius: 0;
		padding: 8px 2px;
		font-size: 18px;
	}
	.title-input:focus {
		border-bottom-width: 2px;
		border-bottom-color: var(--color-primary);
		outline: none;
	}
	.check-row,
	.field-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
	}
	.check-row {
		justify-content: flex-start;
	}
	.spacer {
		flex: 1;
	}
	.tag-field {
		padding: 12px;
		border: 1px solid var(--color-border);
		border-radius: 14px;
		background: color-mix(in oklch, var(--color-muted) 55%, transparent);
	}
	.selection-count {
		color: var(--color-muted-foreground);
		font-size: 11px;
	}
	.filter-input {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 42px;
		padding: 0 8px 0 12px;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		background: var(--color-background);
		color: var(--color-muted-foreground);
	}
	.filter-input:focus-within {
		border-color: var(--color-primary);
		box-shadow: 0 0 0 1px var(--color-primary);
	}
	.filter-input input {
		min-width: 0;
		flex: 1;
		border: 0;
		background: transparent;
		color: var(--color-foreground);
		outline: 0;
	}
	.mini {
		border: 0;
		border-radius: 999px;
		background: var(--color-primary-muted);
		color: var(--color-primary);
		padding: 6px 11px;
		font-size: 12px;
		cursor: pointer;
	}
	.tag-results {
		display: grid;
		gap: 4px;
		max-height: 156px;
		overflow-y: auto;
	}
	.tag-option {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: 9px;
		width: 100%;
		padding: 8px 10px;
		border: 0;
		border-radius: 9px;
		background: transparent;
		color: var(--color-foreground);
		text-align: left;
		cursor: pointer;
	}
	.tag-option:hover {
		background: var(--color-muted);
	}
	.add-label {
		color: var(--color-primary);
		font-size: 11px;
		font-weight: 600;
	}
	.no-results {
		margin: 0;
		padding: 8px 10px;
		color: var(--color-muted-foreground);
		font-size: 12px;
	}
	.tag-dot {
		width: 10px;
		height: 10px;
		flex-shrink: 0;
		border-radius: 50%;
	}
	.title {
		font-size: 20px;
		font-weight: 600;
	}
	.meta,
	.desc,
	.owner-note {
		margin: 0;
	}
	.meta,
	.owner-note {
		color: var(--color-muted-foreground);
		font-size: 12px;
	}
	.desc {
		font-size: 14px;
		white-space: pre-wrap;
	}
	@media (max-width: 860px) {
		.task-dialog--event {
			top: auto;
			bottom: 0;
			left: 0;
			width: 100%;
			max-height: 92dvh;
			padding: 8px 20px calc(20px + env(safe-area-inset-bottom));
			transform: none;
			border-radius: 24px 24px 0 0;
			animation: slide-up 220ms ease;
		}
		.grabber {
			display: block;
			width: 36px;
			height: 4px;
			margin: 2px auto 6px;
			border-radius: 999px;
			background: #c4c7c5;
		}
	}
	@keyframes slide-up {
		from {
			opacity: 0.6;
			transform: translateY(24px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
