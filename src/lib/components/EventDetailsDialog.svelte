<script lang="ts">
	import { mdiClose, mdiDeleteOutline } from '@mdi/js';
	import MdiIcon from './MdiIcon.svelte';
	import type { CalendarEvent } from '$lib/mock/data';

	let {
		open = $bindable(false),
		event = null,
		canEdit = false,
		onupdated,
		ondeleted
	}: {
		open?: boolean;
		event?: CalendarEvent | null;
		canEdit?: boolean;
		onupdated?: (ev: CalendarEvent) => void;
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
	let busy = $state(false);
	let errorMsg = $state('');

	const presetColors = ['#0b57d0', '#188038', '#b0600a', '#a50e0e', '#7c3aed', '#0b8043'];

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
		color = rgbToHex(event.color);
		errorMsg = '';
	});

	function close() {
		open = false;
		errorMsg = '';
	}

	function toDateInput(d: Date): string {
		return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
	}

	function toTimeInput(d: Date): string {
		return `${`${d.getHours()}`.padStart(2, '0')}:${`${d.getMinutes()}`.padStart(2, '0')}`;
	}

	function rgbToHex(c: { r: number; g: number; b: number }): string {
		return `#${[c.r, c.g, c.b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
	}

	function hexToRgb(hex: string): { r: number; g: number; b: number } {
		const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
		return {
			r: parseInt(m![1], 16),
			g: parseInt(m![2], 16),
			b: parseInt(m![3], 16)
		};
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
					color: hexToRgb(color),
					start_at: start.getTime(),
					end_at: end.getTime(),
					all_day: allDay ? 1 : 0
				})
			});
			if (!res.ok) {
				const t = await res.text().catch(() => '');
				throw new Error(t || `Request failed (${res.status})`);
			}
			const updated: CalendarEvent = await res.json();
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
	<button class="scrim" aria-label="Close event details" onclick={close}></button>

	<div class="sheet" role="dialog" aria-modal="true" aria-label="Event details">
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

				{#if errorMsg}
					<p class="err">{errorMsg}</p>
				{/if}

				<footer class="foot">
					<button type="button" class="btn danger" onclick={removeEvent} disabled={busy}>
						<MdiIcon path={mdiDeleteOutline} size={16} /> Delete
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
				<p class="owner-note">You can view this event, but only the owner can edit it.</p>
			</div>
		{/if}
	</div>
{/if}

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 60;
		border: 0;
		padding: 0;
		background: rgba(15, 23, 42, 0.35);
	}
	.sheet {
		position: fixed;
		z-index: 61;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: min(520px, calc(100vw - 24px));
		max-height: calc(100dvh - 48px);
		overflow-y: auto;
		background: #fff;
		border-radius: 16px;
		box-shadow: 0 8px 30px rgba(0, 0, 0, 0.25);
		padding: 10px 18px 18px;
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	h2 {
		margin: 0;
		font-size: 16px;
		font-weight: 500;
		color: #1f1f1f;
	}
	.icon {
		display: grid;
		place-items: center;
		width: 34px;
		height: 34px;
		border: 0;
		border-radius: 50%;
		background: none;
		color: #444746;
		cursor: pointer;
	}
	.icon:hover {
		background: #f0f4f9;
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin-top: 8px;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.field input,
	.field textarea {
		font: inherit;
		font-size: 13.5px;
		color: #1f1f1f;
		border: 1px solid #c4c7c5;
		border-radius: 8px;
		padding: 9px 12px;
		background: #fff;
		width: 100%;
	}
	.field textarea {
		resize: vertical;
	}
	.lbl {
		font-size: 12px;
		color: #444746;
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
		color: #1f1f1f;
	}

	.swatches {
		display: flex;
		gap: 8px;
	}
	.swatch {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		border: 2px solid transparent;
		cursor: pointer;
		padding: 0;
	}
	.swatch.selected {
		border-color: #1f1f1f;
	}
	.err {
		margin: 0;
		font-size: 12.5px;
		color: #a50e0e;
	}

	.foot {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 4px;
	}
	.spacer {
		flex: 1;
	}
	.btn {
		border: 0;
		border-radius: 999px;
		padding: 9px 16px;
		cursor: pointer;
		font: inherit;
		font-size: 13px;
		font-weight: 600;
		display: inline-flex;
		gap: 6px;
		align-items: center;
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
	.btn.danger {
		background: #fde7e9;
		color: #a50e0e;
	}
	.btn:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.title {
		font-size: 20px;
		font-weight: 600;
		color: #1f1f1f;
	}
	.meta {
		margin: 0;
		font-size: 13px;
		color: #5f6368;
	}
	.desc {
		margin: 0;
		font-size: 14px;
		color: #1f1f1f;
		white-space: pre-wrap;
	}
	.desc.mute {
		color: #9aa0a6;
	}
	.owner-note {
		margin: 8px 0 0;
		font-size: 12px;
		color: #5f6368;
	}
</style>
