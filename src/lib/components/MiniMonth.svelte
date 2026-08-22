<script lang="ts">
	import IconButton from '@smui/icon-button';
	import { mdiChevronLeft, mdiChevronRight } from '@mdi/js';
	import MdiIcon from './MdiIcon.svelte';
	import {
		WEEKDAYS_NARROW,
		MONTHS,
		buildMonthGrid,
		isSameDay,
		addMonths,
		toKey
	} from '$lib/calendar';
	import type { CalendarEvent } from '$lib/mock/data';

	let {
		events,
		initial = new Date() // October 2026, like the mock
	}: { initial?: Date; events: CalendarEvent[] } = $props();

	let cursor = $state(initial);
	// Mock: day 14 selected to mirror the design. Wire to real state later.
	let selected = $state(new Date());

	const cells = $derived(buildMonthGrid(cursor.getFullYear(), cursor.getMonth()));

	// Map of date-key -> info about events touching that date.
	type Marker = {
		single: boolean;
		span: boolean;
		color: string;
		continuesPrev: boolean;
		continuesNext: boolean;
	};
	const markers = $derived.by(() => {
		const map = new Map<string, Marker>();
		for (const ev of events) {
			const start = new Date(ev.start_at);
			const end = new Date(ev.end_at);
			const startKey = toKey(start);
			const endKey = toKey(end);

			// Normalize color to a css hex string.
			const c = ev.color;
			const hex =
				typeof c === 'object' && c !== null && 'r' in c
					? `#${[c.r, c.g, c.b].map((n) => (n as number).toString(16).padStart(2, '0')).join('')}`
					: '#0b57d0';

			if (startKey === endKey) {
				const prev = map.get(startKey) ?? {
					single: false,
					span: false,
					color: hex,
					continuesPrev: false,
					continuesNext: false
				};
				prev.single = true;
				prev.color = hex;
				map.set(startKey, prev);
			} else {
				// Multi-day event: mark every day it touches as a span and keep join hints.
				const day = new Date(start.getFullYear(), start.getMonth(), start.getDate());
				const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
				let guard = 0;
				while (day <= last && guard++ < 400) {
					const k = toKey(day);
					const prev = map.get(k) ?? {
						single: false,
						span: false,
						color: hex,
						continuesPrev: false,
						continuesNext: false
					};
					prev.span = true;
					prev.color = hex;
					const isStart = toKey(day) === startKey;
					const isEnd = toKey(day) === endKey;
					prev.continuesPrev = !isStart;
					prev.continuesNext = !isEnd;
					map.set(k, prev);
					day.setDate(day.getDate() + 1);
				}
			}
		}
		return map;
	});
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
			{@const mark = markers.get(cell.key)}
			<button
				class="day"
				class:dim={!cell.inMonth}
				class:selected={isSameDay(cell.date, selected)}
				class:today={isSameDay(cell.date, new Date())}
				onclick={() => (selected = cell.date)}
			>
				<span class="num-bubble">{cell.date.getDate()}</span>
				{#if mark}
					{#if mark.span}
						<span
							class="mark line"
							class:start={!mark.continuesPrev}
							class:end={!mark.continuesNext}
							style:background={mark.color}
						></span>
					{:else if mark.single}
						<span class="mark dot" style:background={mark.color}></span>
					{/if}
				{/if}
			</button>
		{/each}
	</div>
</div>

<style>
	.mini {
		padding: 0 8px;
	}
	.mini-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 4px 8px;
	}
	.mini-title {
		font-size: 14px;
		font-weight: 500;
	}
	.mini-nav :global(.mdc-icon-button) {
		width: 28px;
		height: 28px;
		padding: 4px;
	}
	.mini-grid {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		text-align: center;
		row-gap: 2px;
	}
	.dow {
		font-size: 10px;
		padding: 4px 0;
	}
	.day {
		position: relative;
		border: 0;
		background: none;
		cursor: pointer;
		font-size: 11px;
		height: 28px;
		width: 100%;
		margin: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1px;
		line-height: 1;
	}
	.num-bubble {
		line-height: 1;
		width: 22px;
		height: 22px;
		display: grid;
		place-items: center;
		border-radius: 50%;
	}
	.mark {
		display: block;
	}
	.mark.dot {
		width: 4px;
		height: 4px;
		border-radius: 50%;
	}
	.mark.line {
		position: absolute;
		left: -1px;
		right: -1px;
		top: 20px;
		height: 3px;
		border-radius: 0;
	}
	.mark.line.start {
		left: 50%;
		border-top-left-radius: 2px;
		border-bottom-left-radius: 2px;
	}
	.mark.line.end {
		right: 50%;
		border-top-right-radius: 2px;
		border-bottom-right-radius: 2px;
	}
	.day.selected .mark,
	.day.today:not(.selected) .mark {
		background: currentColor !important;
	}

	.day:hover .num-bubble {
		background: #f0f4f9;
	}
	.day.dim {
		/* color: #9aa0a6; */
	}
	.day.selected .num-bubble {
		background: #0b57d0;
		/* color: #fff; */
		font-weight: 600;
	}
	.day.today:not(.selected) .num-bubble {
		background: #c2e7ff;
		color: #001d35;
		font-weight: 600;
	}
</style>
