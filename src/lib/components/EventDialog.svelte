<script lang="ts">
	import { onMount } from 'svelte';
	import {
		mdiAccountMultipleOutline,
		mdiBellOutline,
		mdiClose,
		mdiDeleteOutline,
		mdiLinkVariant,
		mdiMagnify,
		mdiPaperclip,
		mdiPlus
	} from '@mdi/js';
	import MdiIcon from './MdiIcon.svelte';
	import type { FilterTag, RichTask, UserSummary } from '$lib/features/tasks/types';
	import { colorToHex, hexToColor } from '$lib/features/tasks/color';
	import { reminderRuleSummary } from '$lib/features/reminders/schedule';
	import {
		hasModernAndroidPicker,
		pickModernDate,
		pickModernTime
	} from '$lib/modern-picker';
	import type { ReminderUnit } from '$lib/server/db/schema';

	type SelectedTag = {
		id?: string;
		tag: string;
		color?: { r: number; g: number; b: number };
	};

	type ReminderDraft = {
		key: string;
		leadValue: number;
		leadUnit: ReminderUnit;
		repeatEnabled: boolean;
		repeatValue: number;
		repeatUnit: ReminderUnit;
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
	let reminders = $state<ReminderDraft[]>([]);
	let reminderDraftSequence = 0;
	let tagQuery = $state('');
	let assigneeQuery = $state('');
	let dependencyQuery = $state('');
	let selectedTags = $state<SelectedTag[]>([]);
	let selectedAssigneeIds = $state<string[]>([]);
	let selectedDependencyIds = $state<string[]>([]);
	let busyAction = $state<'save' | 'delete' | null>(null);
	let errorMsg = $state('');
	let useModernAndroidPicker = $state(false);
	let initializedKey = '';

	onMount(() => {
		useModernAndroidPicker = hasModernAndroidPicker();
	});

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

	async function chooseDate(target: 'start' | 'end', clickEvent: MouseEvent) {
		if (!useModernAndroidPicker) return;
		clickEvent.preventDefault();
		try {
			const value = await pickModernDate(
				target === 'start' ? date : endDate,
				target === 'start' ? 'Select start date' : 'Select end date'
			);
			if (value === null) return;
			if (target === 'start') date = value;
			else endDate = value;
		} catch (error) {
			console.error('Could not open Android date picker', error);
			errorMsg = 'Could not open the date picker.';
		}
	}

	async function chooseTime(target: 'start' | 'end', clickEvent: MouseEvent) {
		if (!useModernAndroidPicker) return;
		clickEvent.preventDefault();
		try {
			const value = await pickModernTime(
				target === 'start' ? startTime : endTime,
				target === 'start' ? 'Select start time' : 'Select end time'
			);
			if (value === null) return;
			if (target === 'start') startTime = value;
			else endTime = value;
		} catch (error) {
			console.error('Could not open Android time picker', error);
			errorMsg = 'Could not open the time picker.';
		}
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
		reminders = [];
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
		reminders = (value.reminders ?? []).map((reminder) =>
			createReminderDraft({
				key: reminder.id,
				leadValue: reminder.lead_value,
				leadUnit: reminder.lead_unit,
				repeatEnabled: !!(reminder.repeat_value && reminder.repeat_unit),
				repeatValue: reminder.repeat_value ?? 1,
				repeatUnit: reminder.repeat_unit ?? 'day'
			})
		);
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

	function createReminderDraft(initial: Partial<ReminderDraft> = {}): ReminderDraft {
		return {
			key: initial.key ?? `reminder-${++reminderDraftSequence}`,
			leadValue: initial.leadValue ?? 1,
			leadUnit: initial.leadUnit ?? 'day',
			repeatEnabled: initial.repeatEnabled ?? false,
			repeatValue: initial.repeatValue ?? 1,
			repeatUnit: initial.repeatUnit ?? 'day'
		};
	}

	function addReminder() {
		if (reminders.length >= 20) return;
		reminders = [...reminders, createReminderDraft()];
	}

	function removeReminder(key: string) {
		reminders = reminders.filter((reminder) => reminder.key !== key);
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
		for (const [index, reminder] of reminders.entries()) {
			if (
				!Number.isInteger(reminder.leadValue) ||
				reminder.leadValue < 1 ||
				reminder.leadValue > 1000
			) {
				errorMsg = `Reminder ${index + 1} lead time must be between 1 and 1000.`;
				return;
			}
			if (
				reminder.repeatEnabled &&
				(!Number.isInteger(reminder.repeatValue) ||
					reminder.repeatValue < 1 ||
					reminder.repeatValue > 1000)
			) {
				errorMsg = `Reminder ${index + 1} repeat interval must be between 1 and 1000.`;
				return;
			}
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
				reminders: reminders.map((reminder) => ({
					lead_value: reminder.leadValue,
					lead_unit: reminder.leadUnit,
					repeat_value: reminder.repeatEnabled ? reminder.repeatValue : null,
					repeat_unit: reminder.repeatEnabled ? reminder.repeatUnit : null
				})),
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
							readonly={useModernAndroidPicker}
							onclick={(clickEvent) => chooseDate('start', clickEvent)}
							required
						/></label
					>
					{#if !allDay}
						<label class="field"
							><span class="lbl">Start time</span><input
								type="time"
								bind:value={startTime}
								readonly={useModernAndroidPicker}
								onclick={(clickEvent) => chooseTime('start', clickEvent)}
							/></label
						>
					{/if}
				</div>
				<div class="grid2">
					<label class="field"
						><span class="lbl">End date</span><input
							type="date"
							bind:value={endDate}
							readonly={useModernAndroidPicker}
							onclick={(clickEvent) => chooseDate('end', clickEvent)}
							required
						/></label
					>
					{#if !allDay}
						<label class="field"
							><span class="lbl">End time</span><input
								type="time"
								bind:value={endTime}
								readonly={useModernAndroidPicker}
								onclick={(clickEvent) => chooseTime('end', clickEvent)}
							/></label
						>
					{/if}
				</div>

				<section class="reminder-card" class:enabled={reminders.length > 0}>
					<div class="reminder-heading">
						<span class="reminder-icon"><MdiIcon path={mdiBellOutline} size={18} /></span>
						<div>
							<strong>Event reminders</strong>
							<span>Notify the owner and assignees through their enabled channels.</span>
						</div>
						<button
							type="button"
							class="add-reminder"
							onclick={addReminder}
							disabled={reminders.length >= 20}
						>
							<MdiIcon path={mdiPlus} size={15} /> Add
						</button>
					</div>
					{#if reminders.length}
						<div class="reminder-list">
							{#each reminders as reminder, index (reminder.key)}
								<article class="reminder-rule">
									<div class="reminder-rule-head">
										<span>Reminder {index + 1}</span>
										<button
											type="button"
											class="remove-reminder"
											aria-label={`Remove reminder ${index + 1}`}
											onclick={() => removeReminder(reminder.key)}
										>
											<MdiIcon path={mdiDeleteOutline} size={15} />
										</button>
									</div>
									<div class="reminder-controls">
										<span class="reminder-sentence">Notify me</span>
										<input
											class="number-input"
											type="number"
											min="1"
											max="1000"
											step="1"
											bind:value={reminder.leadValue}
											aria-label={`Reminder ${index + 1} lead value`}
										/>
										<select
											bind:value={reminder.leadUnit}
											aria-label={`Reminder ${index + 1} lead unit`}
										>
											<option value="hour">hour(s)</option>
											<option value="day">day(s)</option>
											<option value="week">week(s)</option>
											<option value="month">month(s)</option>
										</select>
										<span class="reminder-sentence">before it ends</span>
									</div>
									<label class="repeat-toggle row">
										<input type="checkbox" bind:checked={reminder.repeatEnabled} />
										<span>Repeat until the event ends</span>
									</label>
									{#if reminder.repeatEnabled}
										<div class="reminder-controls repeat-controls">
											<span class="reminder-sentence">Every</span>
											<input
												class="number-input"
												type="number"
												min="1"
												max="1000"
												step="1"
												bind:value={reminder.repeatValue}
												aria-label={`Reminder ${index + 1} repeat value`}
											/>
											<select
												bind:value={reminder.repeatUnit}
												aria-label={`Reminder ${index + 1} repeat unit`}
											>
												<option value="hour">hour(s)</option>
												<option value="day">day(s)</option>
												<option value="week">week(s)</option>
												<option value="month">month(s)</option>
											</select>
										</div>
									{/if}
								</article>
							{/each}
						</div>
					{:else}
						<button type="button" class="empty-reminders" onclick={addReminder}>
							<MdiIcon path={mdiPlus} size={16} /> Add your first reminder
						</button>
					{/if}
				</section>

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
				{#if event.reminders?.length}
					<div class="read-reminders">
						{#each event.reminders as reminder (reminder.id)}
							<div class="read-reminder">
								<MdiIcon path={mdiBellOutline} size={16} />
								<span>{reminderRuleSummary(reminder)}</span>
							</div>
						{/each}
					</div>
				{/if}
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
	.reminder-card {
		display: grid;
		gap: 12px;
		padding: 13px 14px;
		border: 1px solid var(--color-border);
		border-radius: 14px;
		background: color-mix(in oklch, var(--color-muted) 45%, transparent);
		transition:
			border-color 160ms ease,
			background 160ms ease;
	}
	.reminder-card.enabled {
		border-color: color-mix(in oklch, var(--color-primary) 45%, var(--color-border));
		background: color-mix(in oklch, var(--color-primary-muted) 42%, var(--color-background));
	}
	.reminder-heading {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: 11px;
	}
	.reminder-heading div {
		display: grid;
		gap: 2px;
	}
	.reminder-heading strong {
		font-size: 13px;
		font-weight: 600;
	}
	.reminder-heading div span {
		color: var(--color-muted-foreground);
		font-size: 11px;
		line-height: 1.35;
	}
	.reminder-icon {
		display: grid;
		place-items: center;
		width: 34px;
		height: 34px;
		border-radius: 50%;
		background: var(--color-primary-muted);
		color: var(--color-primary);
	}
	.add-reminder,
	.empty-reminders {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 5px;
		border: 0;
		border-radius: 999px;
		background: var(--color-primary-muted);
		color: var(--color-primary);
		font: inherit;
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
	}
	.add-reminder {
		padding: 7px 11px;
	}
	.add-reminder:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.empty-reminders {
		width: 100%;
		padding: 13px;
		border: 1px dashed color-mix(in oklch, var(--color-primary) 35%, var(--color-border));
		border-radius: 10px;
		background: color-mix(in oklch, var(--color-background) 70%, transparent);
	}
	.reminder-list,
	.read-reminders {
		display: grid;
		gap: 9px;
	}
	.reminder-rule {
		display: grid;
		gap: 10px;
		padding: 11px;
		border: 1px solid color-mix(in oklch, var(--color-primary) 24%, var(--color-border));
		border-radius: 11px;
		background: var(--color-background);
		animation: reminder-in 180ms ease-out;
	}
	.reminder-rule-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		color: var(--color-muted-foreground);
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	.remove-reminder {
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		border: 0;
		border-radius: 50%;
		background: transparent;
		color: var(--color-muted-foreground);
		cursor: pointer;
	}
	.remove-reminder:hover {
		background: color-mix(in oklch, var(--color-danger) 10%, transparent);
		color: var(--color-danger);
	}
	.reminder-controls {
		display: grid;
		grid-template-columns: auto 72px minmax(112px, 1fr) auto;
		align-items: center;
		gap: 7px;
	}
	.reminder-controls.repeat-controls {
		grid-template-columns: auto 72px minmax(112px, 1fr);
		padding-left: 24px;
	}
	.reminder-controls input,
	.reminder-controls select {
		min-width: 0;
		width: 100%;
		padding: 8px 9px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-background);
		color: var(--color-foreground);
		font: inherit;
		font-size: 12px;
	}
	.reminder-sentence,
	.repeat-toggle {
		font-size: 12px;
	}
	.repeat-toggle {
		padding-left: 24px;
	}
	.read-reminder {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 12px;
		border-radius: 10px;
		background: var(--color-primary-muted);
		color: var(--color-primary);
		font-size: 12px;
	}
	@keyframes reminder-in {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
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
		.reminder-controls,
		.reminder-controls.repeat-controls {
			grid-template-columns: auto 64px 1fr;
			padding-left: 0;
		}
		.reminder-controls > .reminder-sentence:last-child {
			grid-column: 1 / -1;
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
