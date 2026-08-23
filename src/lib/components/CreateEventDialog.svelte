<script lang="ts">
	import { mdiClose, mdiAccountMultipleOutline, mdiLinkVariant } from '@mdi/js';
	import MdiIcon from './MdiIcon.svelte';
	import { getWS } from '$lib/websocket.svelte';
	import type { FilterTag, RichTask, UserSummary } from '$lib/mock/data';

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
	let selectedTags = $state<Array<{ id?: string; tag: string; color?: { r: number; g: number; b: number } }>>(
		[]
	);

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

	function hexToRgb(hex: string): { r: number; g: number; b: number } {
		const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
		return {
			r: parseInt(m![1], 16),
			g: parseInt(m![2], 16),
			b: parseInt(m![3], 16)
		};
	}

	function rgbToHex(c: { r: number; g: number; b: number }): string {
		return `#${[c.r, c.g, c.b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
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
		selectedTags = [...selectedTags, { tag: trimmed, color: hexToRgb(color) }];
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
					color: hexToRgb(color),
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

			// Notify other clients over the global websocket (best effort).
			try {
				getWS()?.send(
					JSON.stringify({ type: 'new_calendar_event', calendar_id: created.id, event: created })
				);
			} catch {
				/* best effort */
			}

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
	<button class="scrim" aria-label="Close create event" onclick={close}></button>

	<div class="sheet" role="dialog" aria-modal="true" aria-label="Create event">
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
								const exact = users.find((user) =>
									user.name.toLowerCase() === assigneeQuery.trim().toLowerCase()
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
								const exact = tasks.find((task) =>
									task.task_name.toLowerCase() === dependencyQuery.trim().toLowerCase()
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
								<span class="tag-dot" style:background={tag.color ? rgbToHex(tag.color) : color}></span>
								{tag.tag}
							</button>
						{/each}
					</div>
					{#if tagSuggestions.length}
						<div class="suggestions">
							{#each tagSuggestions as tag (tag.id)}
								<button type="button" class="suggestion" onclick={() => addTag(tag)}>
									<span class="tag-dot" style:background={rgbToHex(tag.color)}></span>
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
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 60;
		border: 0;
		padding: 0;
		cursor: default;
		background: rgba(15, 23, 42, 0.35);
	}

	/* Desktop: centred dialog */
	.sheet {
		position: fixed;
		z-index: 61;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: min(480px, calc(100vw - 32px));
		max-height: calc(100dvh - 64px);
		overflow-y: auto;
		background: var(--color-background);
		border-radius: 16px;
		box-shadow: 0 8px 30px rgba(0, 0, 0, 0.25);
		padding: 8px 20px 20px;
	}
	.grabber {
		display: none;
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 4px 0;
	}
	h2 {
		margin: 0;
		font-size: 16px;
		font-weight: 500;
		/* color: #1f1f1f; */
	}
	.icon {
		display: grid;
		place-items: center;
		width: 34px;
		height: 34px;
		border: 0;
		border-radius: 50%;
		background: none;
		/* color: #444746; */
		cursor: pointer;
	}
	.icon:hover {
		background: var(--color-foreground);
		color: var(--color-background);
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: 14px;
		margin-top: 8px;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.field input[type='date'],
	.field input[type='time'],
	.field textarea,
	.title-input {
		font: inherit;
		font-size: 13.5px;
		color: var(--color-foreground);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		padding: 9px 12px;
		background: var(--color-background);
		width: 100%;
	}
	.field textarea {
		resize: vertical;
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
	.lbl {
		font-size: 12px;
		/* color: #444746; */
	}
	.grid2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13.5px;
		/* color: #1f1f1f; */
	}

	.swatches {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.color-row {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.picker {
		width: 52px;
		height: 36px;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		background: transparent;
		padding: 3px;
	}
	.tag-row {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.tag-input-wrap {
		display: flex;
		gap: 8px;
	}
	.tag-input {
		flex: 1;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		padding: 9px 12px;
		background: var(--color-background);
		color: var(--color-foreground);
	}
	.mini {
		border: 0;
		border-radius: 999px;
		background: #e8f0fe;
		color: #0b57d0;
		padding: 0 12px;
		font-size: 12px;
	}
	.selected-tags,
	.suggestions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.tag-chip,
	.suggestion {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		padding: 8px 12px;
		background: var(--color-background);
		color: var(--color-foreground);
		font-size: 12px;
	}
	.tag-dot {
		width: 10px;
		height: 10px;
		border-radius: 999px;
		flex-shrink: 0;
	}
	.swatch {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		border: 2px solid transparent;
		cursor: pointer;
		padding: 0;
	}

	.err {
		margin: 0;
		font-size: 12.5px;
		color: #a50e0e;
	}

	.foot {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 4px;
	}
	.btn {
		border: 0;
		border-radius: 999px;
		padding: 9px 20px;
		cursor: pointer;
		font: inherit;
		font-size: 13.5px;
		font-weight: 600;
	}
	.btn.ghost {
		background: none;
		color: #0b57d0;
	}
	.btn.ghost:hover {
		background: #eef2f7;
	}
	.btn.primary {
		background: #0b57d0;
		color: #fff;
	}
	.btn.primary:disabled {
		opacity: 0.6;
		cursor: default;
	}

	/* Mobile: Google-Calendar style bottom sheet that takes the lower space */
	@media (max-width: 860px) {
		.sheet {
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
