<script lang="ts">
	import { fly } from 'svelte/transition';
	import {
		mdiArrowLeft,
		mdiCalendarCheckOutline,
		mdiClose,
		mdiDeleteOutline,
		mdiMagnify,
		mdiPencilOutline,
		mdiPlus,
		mdiRestore
	} from '@mdi/js';
	import MdiIcon from '$lib/components/MdiIcon.svelte';
	import type { PageProps } from './$types';
	import type { RichTask } from '$lib/features/tasks/types';
	import { colorToHex, hexToColor } from '$lib/features/tasks/color';

	let { data }: PageProps = $props();
	let events = $state<RichTask[]>(data.events as RichTask[]);
	let query = $state('');
	let scope = $state<'active' | 'deleted' | 'all'>('active');
	let editorOpen = $state(false);
	let editingId = $state<string | null>(null);
	let busyId = $state<string | null>(null);
	let formError = $state('');
	let draft = $state(emptyDraft());

	const filteredEvents = $derived.by(() => {
		const needle = query.trim().toLowerCase();
		return events.filter((event) => {
			if (scope === 'active' && event.deleted_at) return false;
			if (scope === 'deleted' && !event.deleted_at) return false;
			return (
				!needle ||
				event.task_name.toLowerCase().includes(needle) ||
				(event.description ?? '').toLowerCase().includes(needle) ||
				(data.users.find((user) => user.id === event.owner)?.name ?? '')
					.toLowerCase()
					.includes(needle)
			);
		});
	});
	const activeCount = $derived(events.filter((event) => !event.deleted_at).length);
	const deletedCount = $derived(events.filter((event) => !!event.deleted_at).length);

	function emptyDraft() {
		const start = new Date();
		start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0);
		const end = new Date(start.getTime() + 60 * 60_000);
		return {
			task_name: '',
			description: '',
			owner_id: data.users[0]?.id ?? '',
			start_at: toLocalInput(start),
			end_at: toLocalInput(end),
			status: 'todo' as RichTask['status'],
			importance_value: 0,
			all_day: false,
			color: '#0b57d0'
		};
	}

	function toLocalInput(value: Date | number | string) {
		const date = new Date(value);
		const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
		return local.toISOString().slice(0, 16);
	}

	function openCreate() {
		editingId = null;
		draft = emptyDraft();
		formError = '';
		editorOpen = true;
	}

	function openEdit(event: RichTask) {
		editingId = event.id;
		draft = {
			task_name: event.task_name,
			description: event.description ?? '',
			owner_id: event.owner,
			start_at: toLocalInput(event.start_at),
			end_at: toLocalInput(event.end_at),
			status: event.status,
			importance_value: event.importance_value,
			all_day: !!event.all_day,
			color: colorToHex(event.color)
		};
		formError = '';
		editorOpen = true;
	}

	function closeEditor() {
		if (busyId === 'editor') return;
		editorOpen = false;
		formError = '';
	}

	async function saveEvent() {
		const start = new Date(draft.start_at);
		const end = new Date(draft.end_at);
		if (!draft.task_name.trim()) return (formError = 'Event name is required.');
		if (!draft.owner_id) return (formError = 'Select an owner.');
		if (!Number.isFinite(+start) || !Number.isFinite(+end) || end < start) {
			return (formError = 'End time must be after the start time.');
		}

		busyId = 'editor';
		formError = '';
		try {
			const response = await fetch(
				editingId ? `/api/events?id=${encodeURIComponent(editingId)}` : '/api/events',
				{
					method: editingId ? 'PUT' : 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						task_name: draft.task_name.trim(),
						description: draft.description.trim() || null,
						owner_id: draft.owner_id,
						start_at: +start,
						end_at: +end,
						status: draft.status,
						completed: draft.status === 'completed' ? Date.now() : null,
						importance_value: Number(draft.importance_value) || 0,
						all_day: draft.all_day ? 1 : 0,
						color: hexToColor(draft.color)
					})
				}
			);
			if (!response.ok) throw new Error(await response.text());
			const saved = (await response.json()) as RichTask;
			events = editingId
				? events.map((event) => (event.id === saved.id ? saved : event))
				: [saved, ...events];
			editorOpen = false;
		} catch (error) {
			formError = error instanceof Error ? error.message : 'Could not save the event.';
		} finally {
			busyId = null;
		}
	}

	async function softDelete(event: RichTask) {
		if (!confirm(`Move “${event.task_name}” to deleted events?`)) return;
		busyId = event.id;
		try {
			const response = await fetch(`/api/events?id=${encodeURIComponent(event.id)}`, {
				method: 'DELETE'
			});
			if (!response.ok) throw new Error(await response.text());
			const result = (await response.json()) as { deleted_at: number };
			events = events.map((item) =>
				item.id === event.id ? { ...item, deleted_at: new Date(result.deleted_at) } : item
			);
		} finally {
			busyId = null;
		}
	}

	async function restoreEvent(event: RichTask) {
		busyId = event.id;
		try {
			const response = await fetch(
				`/api/events?id=${encodeURIComponent(event.id)}&action=restore`,
				{ method: 'PATCH' }
			);
			if (!response.ok) throw new Error(await response.text());
			const restored = (await response.json()) as RichTask;
			events = events.map((item) => (item.id === restored.id ? restored : item));
		} finally {
			busyId = null;
		}
	}

	function ownerName(event: RichTask) {
		return data.users.find((user) => user.id === event.owner)?.name ?? 'Unknown owner';
	}

	function dateLabel(value: Date | number | string) {
		return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
	}
</script>

<svelte:head><title>Event administration · Completionist</title></svelte:head>

<main class="admin-shell">
	<header class="masthead">
		<a class="back" href="/" aria-label="Back to calendar"
			><MdiIcon path={mdiArrowLeft} size={19} /></a
		>
		<div class="mark"><MdiIcon path={mdiCalendarCheckOutline} size={22} /></div>
		<div>
			<p class="kicker">Admin workspace</p>
			<h1>Event administration</h1>
		</div>
		<button class="create" onclick={openCreate}
			><MdiIcon path={mdiPlus} size={18} /> New event</button
		>
	</header>

	<section class="metrics" aria-label="Event totals">
		<div><strong>{events.length}</strong><span>Total records</span></div>
		<div><strong>{activeCount}</strong><span>Active events</span></div>
		<div class="danger"><strong>{deletedCount}</strong><span>Recoverable</span></div>
	</section>

	<section class="workspace">
		<div class="controls">
			<label class="search"
				><MdiIcon path={mdiMagnify} size={18} /><input
					type="search"
					placeholder="Search name, notes, or owner"
					bind:value={query}
				/></label
			>
			<div class="scope" aria-label="Record filter">
				{#each ['active', 'deleted', 'all'] as option}
					<button class:active={scope === option} onclick={() => (scope = option as typeof scope)}
						>{option}</button
					>
				{/each}
			</div>
		</div>

		<div class="table-wrap">
			<table>
				<thead
					><tr
						><th>Event</th><th>Owner</th><th>Window</th><th>Status</th><th>Priority</th><th
							><span class="sr-only">Actions</span></th
						></tr
					></thead
				>
				<tbody>
					{#each filteredEvents as event, index (event.id)}
						<tr
							class:deleted={!!event.deleted_at}
							style:animation-delay={`${Math.min(index, 12) * 25}ms`}
						>
							<td
								><span class="event-name"
									><i style:background={colorToHex(event.color)}></i>{event.task_name}</span
								><small>{event.description || 'No description'}</small></td
							>
							<td>{ownerName(event)}</td>
							<td
								><time>{dateLabel(event.start_at)}</time><small>to {dateLabel(event.end_at)}</small
								></td
							>
							<td
								><span class="status" data-status={event.status}
									>{event.deleted_at ? 'deleted' : event.status}</span
								></td
							>
							<td>{event.importance_value}</td>
							<td class="actions">
								{#if event.deleted_at}
									<button
										title="Restore"
										disabled={busyId === event.id}
										onclick={() => restoreEvent(event)}
										><MdiIcon path={mdiRestore} size={18} /></button
									>
								{:else}
									<button title="Edit" onclick={() => openEdit(event)}
										><MdiIcon path={mdiPencilOutline} size={17} /></button
									>
									<button
										class="delete"
										title="Delete"
										disabled={busyId === event.id}
										onclick={() => softDelete(event)}
										><MdiIcon path={mdiDeleteOutline} size={18} /></button
									>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
			{#if filteredEvents.length === 0}<div class="empty">No records match this view.</div>{/if}
		</div>
	</section>
</main>

{#if editorOpen}
	<button class="scrim" aria-label="Close editor" onclick={closeEditor}></button>
	<aside
		class="editor"
		aria-label={editingId ? 'Edit event' : 'Create event'}
		transition:fly={{ x: 30, duration: 260 }}
	>
		<header>
			<div>
				<p class="kicker">{editingId ? 'Update record' : 'Create record'}</p>
				<h2>{editingId ? 'Edit event' : 'New event'}</h2>
			</div>
			<button class="close" type="button" onclick={closeEditor}
				><MdiIcon path={mdiClose} size={20} /></button
			>
		</header>
		<form
			onsubmit={(event) => {
				event.preventDefault();
				saveEvent();
			}}
		>
			<label class="wide"><span>Name</span><input bind:value={draft.task_name} required /></label>
			<label class="wide"
				><span>Description</span><textarea rows="4" bind:value={draft.description}
				></textarea></label
			>
			<label
				><span>Owner</span><select bind:value={draft.owner_id}
					>{#each data.users as user}<option value={user.id}>{user.name}</option>{/each}</select
				></label
			>
			<label
				><span>Status</span><select bind:value={draft.status}
					><option value="todo">To do</option><option value="progress">In progress</option><option
						value="completed">Completed</option
					><option value="cancelled">Cancelled</option></select
				></label
			>
			<label
				><span>Starts</span><input
					type="datetime-local"
					bind:value={draft.start_at}
					required
				/></label
			>
			<label
				><span>Ends</span><input type="datetime-local" bind:value={draft.end_at} required /></label
			>
			<label><span>Priority</span><input type="number" bind:value={draft.importance_value} /></label
			>
			<label><span>Color</span><input class="color" type="color" bind:value={draft.color} /></label>
			<label class="check wide"
				><input type="checkbox" bind:checked={draft.all_day} /><span>All-day event</span></label
			>
			{#if formError}<p class="form-error wide">{formError}</p>{/if}
			<footer class="wide">
				<button type="button" class="cancel" onclick={closeEditor}>Cancel</button><button
					class="save"
					disabled={busyId === 'editor'}
					>{busyId === 'editor' ? 'Saving…' : editingId ? 'Save changes' : 'Create event'}</button
				>
			</footer>
		</form>
	</aside>
{/if}

<style>
	:global(body) {
		background: #f8fafd;
	}
	.admin-shell {
		height: 100%;
		min-height: 100%;
		overflow-y: auto;
		padding: 24px clamp(18px, 4vw, 64px) 52px;
		color: #1f1f1f;
		background: #f8fafd;
		font-family: 'Google Sans', Roboto, 'Segoe UI', sans-serif;
	}
	.masthead {
		display: flex;
		align-items: center;
		gap: 14px;
		max-width: 1440px;
		margin: auto;
	}
	.back,
	.mark,
	.close {
		display: grid;
		place-items: center;
		border: 0;
		border-radius: 50%;
	}
	.back {
		width: 40px;
		height: 40px;
		color: #444746;
		background: transparent;
		transition: background 160ms ease;
	}
	.back:hover,
	.close:hover {
		background: #e9eef6;
	}
	.mark {
		width: 44px;
		height: 44px;
		color: #0b57d0;
		background: #c2e7ff;
	}
	.kicker {
		margin: 0 0 3px;
		color: #5f6368;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.16em;
		text-transform: uppercase;
	}
	h1,
	h2 {
		margin: 0;
		font-family: 'Google Sans', Roboto, 'Segoe UI', sans-serif;
		font-weight: 400;
		letter-spacing: -0.01em;
	}
	h1 {
		font-size: clamp(24px, 3vw, 32px);
	}
	.create {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 40px;
		padding: 0 18px;
		border: 0;
		border-radius: 999px;
		color: white;
		background: #0b57d0;
		box-shadow: 0 1px 2px rgb(60 64 67 / 30%);
		font-weight: 500;
		cursor: pointer;
		transition:
			background 160ms ease,
			box-shadow 160ms ease;
	}
	.create:hover {
		background: #0842a0;
		box-shadow: 0 2px 6px rgb(60 64 67 / 32%);
	}
	.metrics {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 12px;
		max-width: 1440px;
		margin: 24px auto 14px;
	}
	.metrics div {
		display: flex;
		align-items: baseline;
		gap: 10px;
		padding: 17px 20px;
		border: 1px solid #e1e3e1;
		border-radius: 16px;
		background: #fff;
	}
	.metrics strong {
		color: #1f1f1f;
		font-size: 28px;
		font-weight: 400;
		font-variant-numeric: tabular-nums;
	}
	.metrics span {
		color: #5f6368;
		font-size: 12px;
	}
	.metrics .danger strong {
		color: #b3261e;
	}
	.workspace {
		max-width: 1440px;
		margin: auto;
		border: 1px solid #e1e3e1;
		border-radius: 16px;
		overflow: hidden;
		background: #fff;
		box-shadow: 0 1px 2px rgb(60 64 67 / 8%);
	}
	.controls {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 14px;
		border-bottom: 1px solid #e1e3e1;
	}
	.search {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1;
		max-width: 520px;
		min-height: 44px;
		padding: 0 14px;
		border: 1px solid transparent;
		border-radius: 999px;
		color: #444746;
		background: #f0f4f9;
		transition:
			background 160ms ease,
			border-color 160ms ease;
	}
	.search:focus-within {
		border-color: #0b57d0;
		background: #fff;
	}
	.search input {
		width: 100%;
		border: 0;
		background: transparent;
		box-shadow: none;
		color: #1f1f1f;
		font-size: 13px;
		outline: 0;
	}
	.scope {
		display: flex;
		gap: 0;
		margin-left: auto;
		padding: 0;
		border: 1px solid #c4c7c5;
		border-radius: 999px;
		overflow: hidden;
		background: #fff;
	}
	.scope button {
		border: 0;
		border-right: 1px solid #c4c7c5;
		padding: 9px 15px;
		border-radius: 0;
		background: transparent;
		color: #444746;
		text-transform: capitalize;
		cursor: pointer;
		transition: background 160ms ease;
	}
	.scope button:last-child {
		border-right: 0;
	}
	.scope button:hover:not(.active) {
		background: #f0f4f9;
	}
	.scope button.active {
		background: #c2e7ff;
		color: #001d35;
		box-shadow: none;
		font-weight: 500;
	}
	.table-wrap {
		overflow-x: auto;
	}
	table {
		width: 100%;
		border-collapse: collapse;
	}
	th {
		padding: 12px 16px;
		color: #5f6368;
		background: #f8fafd;
		font-size: 10px;
		letter-spacing: 0.1em;
		text-align: left;
		text-transform: uppercase;
	}
	td {
		padding: 14px 16px;
		border-top: 1px solid #e8eaed;
		font-size: 13px;
		vertical-align: middle;
	}
	tr {
		animation: row-in 300ms ease both;
	}
	tr.deleted {
		opacity: 0.62;
		background: #fce8e6;
	}
	tbody tr:not(.deleted):hover {
		background: #f8fafd;
	}
	td small,
	td time {
		display: block;
	}
	td small {
		max-width: 340px;
		margin-top: 3px;
		overflow: hidden;
		color: #5f6368;
		font-size: 11px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.event-name {
		display: flex;
		align-items: center;
		gap: 9px;
		font-weight: 500;
	}
	.event-name i {
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}
	.status {
		display: inline-flex;
		padding: 4px 8px;
		border-radius: 999px;
		background: #f0f4f9;
		color: #444746;
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
	}
	.status[data-status='completed'] {
		color: #0d652d;
		background: #e6f4ea;
	}
	.status[data-status='cancelled'] {
		color: #b3261e;
		background: #fce8e6;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 5px;
	}
	.actions button,
	.close {
		width: 36px;
		height: 36px;
		border: 0;
		border-radius: 50%;
		color: #444746;
		background: transparent;
		cursor: pointer;
		transition: background 160ms ease;
	}
	.actions button:hover {
		background: #f0f4f9;
	}
	.actions .delete {
		color: #b3261e;
		background: transparent;
	}
	.actions .delete:hover {
		background: #fce8e6;
	}
	.actions button:disabled {
		opacity: 0.45;
	}
	.empty {
		padding: 56px;
		color: #5f6368;
		text-align: center;
	}
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 80;
		border: 0;
		background: rgb(32 33 36 / 42%);
		backdrop-filter: blur(2px);
	}
	.editor {
		position: fixed;
		z-index: 90;
		inset: 12px 12px 12px auto;
		width: min(540px, calc(100vw - 24px));
		padding: 26px;
		overflow-y: auto;
		border: 1px solid #e1e3e1;
		border-radius: 24px;
		background: #fff;
		box-shadow: 0 8px 30px rgb(60 64 67 / 28%);
	}
	.editor header {
		display: flex;
		justify-content: space-between;
		align-items: start;
		margin-bottom: 24px;
	}
	.editor h2 {
		font-size: 26px;
	}
	.editor form {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 15px;
	}
	.editor label {
		display: grid;
		gap: 6px;
	}
	.editor label > span {
		color: #444746;
		font-size: 11px;
		font-weight: 500;
	}
	.editor input,
	.editor textarea,
	.editor select {
		width: 100%;
		border: 1px solid #c4c7c5;
		border-radius: 8px;
		background: white;
		color: #1f1f1f;
		font: inherit;
		transition:
			border-color 160ms ease,
			box-shadow 160ms ease;
	}
	.editor input:focus,
	.editor textarea:focus,
	.editor select:focus {
		border-color: #0b57d0;
		box-shadow: 0 0 0 1px #0b57d0;
		outline: 0;
	}
	.editor .wide {
		grid-column: 1 / -1;
	}
	.editor .color {
		min-height: 42px;
		padding: 5px;
	}
	.editor .check {
		display: flex;
		align-items: center;
		grid-template-columns: auto 1fr;
	}
	.editor .check input {
		width: auto;
	}
	.editor footer {
		display: flex;
		justify-content: flex-end;
		gap: 9px;
		margin-top: 8px;
	}
	.editor footer button {
		min-height: 40px;
		padding: 0 18px;
		border: 0;
		border-radius: 999px;
		font-weight: 500;
		cursor: pointer;
	}
	.cancel {
		background: transparent;
		color: #0b57d0;
	}
	.cancel:hover {
		background: #e8f0fe;
	}
	.save {
		background: #0b57d0;
		color: white;
	}
	.save:hover:not(:disabled) {
		background: #0842a0;
	}
	.save:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.form-error {
		margin: 0;
		padding: 10px;
		border-radius: 8px;
		color: #b3261e;
		background: #fce8e6;
		font-size: 12px;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
	}
	@keyframes row-in {
		from {
			opacity: 0;
			transform: translateY(5px);
		}
	}
	@media (max-width: 700px) {
		.admin-shell {
			padding: 16px 10px 40px;
		}
		.masthead .mark {
			display: none;
		}
		.create {
			padding: 10px;
		}
		.metrics {
			grid-template-columns: 1fr 1fr 1fr;
		}
		.metrics div {
			display: grid;
			padding: 12px;
		}
		.controls {
			align-items: stretch;
			flex-direction: column;
		}
		.scope {
			margin: 0;
		}
		.scope button {
			flex: 1;
		}
		.editor form {
			grid-template-columns: 1fr;
		}
		.editor form > * {
			grid-column: 1;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		tr {
			animation: none;
		}
	}
</style>
