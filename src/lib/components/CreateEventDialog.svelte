<script lang="ts">
	import { mdiClose, mdiAccountMultipleOutline, mdiLinkVariant } from '@mdi/js';
	import MdiIcon from './MdiIcon.svelte';
	import type { FilterTag, RichTask, UserSummary } from '$lib/features/tasks/types';
	import { colorToHex, hexToColor } from '$lib/features/tasks/color';

	let {
		open = $bindable(false),
		onevent,
		tags = [],
		users = [],
		tasks = []
	}: {
		open?: boolean;
		onevent?: (ev: RichTask) => void;
		tags?: FilterTag[];
		users?: UserSummary[];
		tasks?: RichTask[];
	} = $props();

	let title = $state('');
	let description = $state('');
	let date = $state(todayStr());
	let startTime = $state('09:00');
	let endDate = $state(todayStr());
	let endTime = $state('10:00');
	let allDay = $state(false);
	let color = $state('#0b57d0');
	let busy = $state(false);
	let errorMsg = $state('');
	let tagInput = $state('');
	let assigneeQuery = $state('');
	let dependencyQuery = $state('');
	let selectedAssigneeIds = $state<string[]>([]);
	let selectedDependencyIds = $state<string[]>([]);
	let selectedTags = $state<
		Array<{ id?: string; tag: string; color?: { r: number; g: number; b: number } }>
	>([]);

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
			.filter((task) => !selectedDependencyIds.includes(task.id))
			.filter((task) => !q || task.task_name.toLowerCase().includes(q))
			.slice(0, 8);
	});
	const tagSuggestions = $derived.by(() => {
		const query = tagInput.trim().toLowerCase();
		return tags
			.filter((tag) => !selectedTags.some((picked) => picked.id === tag.id))
			.filter((tag) => !query || tag.tag.toLowerCase().includes(query))
			.slice(0, 8);
	});

	function todayStr(): string {
		const d = new Date();
		return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
	}

	function close() {
		open = false;
		errorMsg = '';
		tagInput = '';
		assigneeQuery = '';
		dependencyQuery = '';
		selectedAssigneeIds = [];
		selectedDependencyIds = [];
		selectedTags = [];
	}

	function addTag(tag: FilterTag) {
		if (selectedTags.some((picked) => picked.id === tag.id || picked.tag === tag.tag)) return;
		selectedTags = [...selectedTags, { id: tag.id, tag: tag.tag, color: tag.color }];
		tagInput = '';
	}

	function createTagFromInput() {
		const trimmed = tagInput.trim();
		if (!trimmed) return;
		if (selectedTags.some((picked) => picked.tag.toLowerCase() === trimmed.toLowerCase())) {
			tagInput = '';
			return;
		}
		selectedTags = [...selectedTags, { tag: trimmed, color: hexToColor(color) }];
		tagInput = '';
	}

	function removeTagAt(index: number) {
		selectedTags = selectedTags.filter((_, i) => i !== index);
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

	async function submit() {
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
			const res = await fetch('/api/events', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					task_name: title.trim(),
					description: description.trim() || null,
					color: hexToColor(color),
					start_at: start.getTime(),
					end_at: end.getTime(),
					all_day: allDay ? 1 : 0,
					status: 'todo',
					importance_value: 0,
					assignee_ids: selectedAssigneeIds,
					dependency_ids: selectedDependencyIds,
					tags: selectedTags.map((tag) => ({
						id: tag.id,
						tag: tag.tag,
						color: tag.color
					}))
				})
			});
			if (!res.ok) {
				const t = await res.text().catch(() => '');
				throw new Error(t || `Request failed (${res.status})`);
			}
			const created: RichTask = await res.json();

			onevent?.(created);

			// reset
			title = '';
			description = '';
			close();
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'Failed to create event.';
		} finally {
			busy = false;
		}
	}
</script>

{#if open}
	<!-- scrim -->
	<button class="task-dialog-scrim" aria-label="Close create event" onclick={close}></button>

	<div
		class="task-dialog task-dialog--create"
		role="dialog"
		aria-modal="true"
		aria-label="Create event"
	>
		<div class="grabber" aria-hidden="true"></div>
		<header class="head">
			<h2>Create event</h2>
			<button class="icon" aria-label="Close" onclick={close}>
				<MdiIcon path={mdiClose} size={20} />
			</button>
		</header>

		<form
			class="body"
			onsubmit={(e) => {
				e.preventDefault();
				submit();
			}}
		>
			<label class="field title-field">
				<input
					class="title-input"
					type="text"
					bind:value={title}
					placeholder="Add title"
					required
				/>
			</label>

			<label class="row">
				<input type="checkbox" bind:checked={allDay} />
				<span>All day</span>
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
				<textarea rows="3" bind:value={description} placeholder="Add description"></textarea>
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
							<MdiIcon path={mdiClose} size={14} />
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
						{@const task = tasks.find((item) => item.id === id)}
						<button type="button" class="tag-chip" onclick={() => removeDependency(id)}>
							<MdiIcon path={mdiLinkVariant} size={14} />
							{task?.task_name ?? id}
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

			<div class="field">
				<span class="lbl">Tags</span>
				<div class="tag-row">
					<div class="tag-input-wrap">
						<input
							class="tag-input"
							type="text"
							bind:value={tagInput}
							placeholder="Add a tag"
							onkeydown={(e) => {
								if (e.key === 'Enter') {
									e.preventDefault();
									createTagFromInput();
								}
							}}
						/>
						{#if tagInput.trim()}
							<button type="button" class="mini" onclick={createTagFromInput}>Create</button>
						{/if}
					</div>
					<div class="selected-tags">
						{#each selectedTags as tag, index (tag.id ?? `${tag.tag}-${index}`)}
							<button type="button" class="tag-chip" onclick={() => removeTagAt(index)}>
								<span class="tag-dot" style:background={tag.color ? colorToHex(tag.color) : color}
								></span>
								{tag.tag}
							</button>
						{/each}
					</div>
					{#if tagSuggestions.length}
						<div class="suggestions">
							{#each tagSuggestions as tag (tag.id)}
								<button type="button" class="suggestion" onclick={() => addTag(tag)}>
									<span class="tag-dot" style:background={colorToHex(tag.color)}></span>
									{tag.tag}
								</button>
							{/each}
						</div>
					{/if}
				</div>
			</div>

			{#if errorMsg}
				<p class="err">{errorMsg}</p>
			{/if}

			<footer class="foot">
				<button type="button" class="btn ghost" onclick={close}>Cancel</button>
				<button class="btn primary" type="submit" disabled={busy}>
					{busy ? 'Saving…' : 'Save'}
				</button>
			</footer>
		</form>
	</div>
{/if}

<style>
	.task-dialog--create {
		width: min(480px, calc(100vw - 32px));
		max-height: calc(100dvh - 64px);
		padding: 8px 20px 20px;
	}
	.grabber {
		display: none;
	}

	.task-dialog--create .head {
		padding: 4px 0;
	}
	.task-dialog--create .body {
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
		outline: none;
		border-bottom-color: var(--color-primary);
		border-bottom-width: 2px;
	}
	.tag-row {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.mini {
		border: 0;
		border-radius: 999px;
		background: #e8f0fe;
		color: #0b57d0;
		padding: 0 12px;
		font-size: 12px;
	}
	.tag-dot {
		width: 10px;
		height: 10px;
		border-radius: 999px;
		flex-shrink: 0;
	}
	.task-dialog--create .foot {
		justify-content: flex-end;
	}

	/* Mobile: Google-Calendar style bottom sheet that takes the lower space */
	@media (max-width: 860px) {
		.task-dialog--create {
			top: auto;
			bottom: 0;
			left: 0;
			transform: none;
			width: 100%;
			max-height: 92dvh;
			border-radius: 24px 24px 0 0;
			padding: 8px 20px calc(20px + env(safe-area-inset-bottom));
			animation: slide-up 0.22s ease;
		}
		.grabber {
			display: block;
			width: 36px;
			height: 4px;
			border-radius: 999px;
			background: #c4c7c5;
			margin: 2px auto 6px;
		}
	}
	@keyframes slide-up {
		from {
			transform: translateY(24px);
			opacity: 0.6;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}
</style>
