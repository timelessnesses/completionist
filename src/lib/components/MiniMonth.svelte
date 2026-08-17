<script lang="ts">
	import IconButton from '@smui/icon-button';
	import { mdiChevronLeft, mdiChevronRight } from '@mdi/js';
	import MdiIcon from './MdiIcon.svelte';
	import { WEEKDAYS_NARROW, MONTHS, buildMonthGrid, isSameDay, addMonths } from '$lib/calendar';
	import type { CalendarEvent } from '$lib/mock/data';

	let {
		events,
		initial = new Date(), // October 2026, like the mock
	}: { initial?: Date, events: CalendarEvent[] } = $props();

	let cursor = $state(initial);
	// Mock: day 14 selected to mirror the design. Wire to real state later.
	let selected = $state(new Date());

	const cells = $derived(buildMonthGrid(cursor.getFullYear(), cursor.getMonth()));
</script>

<div class="mini">
	<div class="mini-head">
		<span class="mini-title">{MONTHS[cursor.getMonth()]} {cursor.getFullYear()}</span>
		<span class="mini-nav">
			<IconButton size="mini" onclick={() => (cursor = addMonths(cursor, -1))}>
				<MdiIcon path={mdiChevronLeft} size={18} />
			</IconButton>
			<IconButton size="mini" onclick={() => (cursor = addMonths(cursor, 1))}>
				<MdiIcon path={mdiChevronRight} size={18} />
			</IconButton>
		</span>
	</div>

	<div class="mini-grid">
		{#each WEEKDAYS_NARROW as d}
			<span class="dow">{d}</span>
		{/each}
		{#each cells as cell (cell.key)}
			<button
				class="day"
				class:dim={!cell.inMonth}
				class:selected={isSameDay(cell.date, selected)}
				class:today={isSameDay(cell.date, new Date())}
				onclick={() => (selected = cell.date)}
			>
				{cell.date.getDate()}
			</button>
		{/each}
	</div>
</div>

<style>
	.mini { padding: 0 8px; }
	.mini-head {
		display: flex; align-items: center; justify-content: space-between;
		padding: 4px 8px;
	}
	.mini-title { font-size: 14px; font-weight: 500; color: #1f1f1f; }
	.mini-nav :global(.mdc-icon-button) { width: 28px; height: 28px; padding: 4px; color: #5f6368; }
	.mini-grid {
		display: grid; grid-template-columns: repeat(7, 1fr);
		text-align: center; row-gap: 2px;
	}
	.dow { font-size: 10px; color: #5f6368; padding: 4px 0; }
	.day {
		border: 0; background: none; cursor: pointer;
		font-size: 11px; color: #1f1f1f;
		height: 26px; width: 26px; margin: 0 auto;
		border-radius: 50%; display: grid; place-items: center;
	}
	.day:hover { background: #f0f4f9; }
	.day.dim { color: #9aa0a6; }
	.day.selected { background: #0b57d0; color: #fff; font-weight: 600; }
	.day.today:not(.selected) { background: #c2e7ff; color: #001d35; font-weight: 600; }
</style>