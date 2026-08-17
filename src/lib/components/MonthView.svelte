<script lang="ts">
	import Button, { Label } from '@smui/button';
	import {
		mdiCloudCheckOutline,
		mdiChevronLeft,
		mdiChevronRight,
		mdiMenu,
		mdiAccountMultipleOutline
	} from '@mdi/js';
	import MdiIcon from './MdiIcon.svelte';
	import WeekView from './WeekView.svelte';
	import {
		WEEKDAYS, MONTHS, buildMonthGrid, isSameDay, addMonths, addDays
	} from '$lib/calendar';
	import type { CalendarEvent, FilterTag } from '$lib/mock/data';

	type View = 'Month' | 'Week';
	const views: View[] = ['Month', 'Week'];

	let {
		onMenu,
		onPeople,
		filters,
		events
	}: {
		onMenu?: () => void;
		onPeople?: () => void;
		filters: FilterTag[];
		events: CalendarEvent[];
	} = $props();

	let viewDate = $state(new Date()); // August 2026
	let view = $state<View>('Month');
	let activeFilters = $state(new Set(filters.map((f) => f.id)));

	const cells = $derived(buildMonthGrid(viewDate.getFullYear(), viewDate.getMonth()));
	const eventsByDay = $derived(Map.groupBy(events, (e) => e.date));

	function step(dir: -1 | 1) {
		viewDate = view === 'Month' ? addMonths(viewDate, dir) : addDays(viewDate, dir * 7);
	}

	function toggleFilter(id: string) {
		const next = new Set(activeFilters);
		next.has(id) ? next.delete(id) : next.add(id);
		activeFilters = next;
	}
</script>

<section class="main">
	<!-- Toolbar -->
	<header class="toolbar">
		<div class="tb-row">
			<button class="icon-btn only-mobile" aria-label="Open menu" onclick={() => onMenu?.()}>
				<MdiIcon path={mdiMenu} size={22} />
			</button>
			<h1>{MONTHS[viewDate.getMonth()]} {viewDate.getFullYear()}</h1>
			<span class="spacer"></span>
			<Button
				variant="outlined"
				class="today-btn"
				onclick={() => (viewDate = new Date())}
			>
				Today
			</Button>
			<button class="icon-btn only-mobile" aria-label="Open people panel" onclick={() => onPeople?.()}>
				<MdiIcon path={mdiAccountMultipleOutline} size={22} />
			</button>
		</div>
		<div class="tb-row">
			<div class="nav-group">
				<button class="icon-btn" aria-label="Previous" onclick={() => step(-1)}>
					<MdiIcon path={mdiChevronLeft} size={22} />
				</button>
				<button class="icon-btn" aria-label="Next" onclick={() => step(1)}>
					<MdiIcon path={mdiChevronRight} size={22} />
				</button>
			</div>
			<span class="spacer"></span>
			<div class="segmented">
				{#each views as v}
					<button class:active={view === v} onclick={() => (view = v)}>{v}</button>
				{/each}
			</div>
		</div>
	</header>

	<!-- Sharing banner -->
	<!-- <div class="banner">
		<MdiIcon path={mdiCloudCheckOutline} size={18} />
		<span>
			Shared with {workspace.sharedWith} people · {workspace.permission} · {workspace.session}
		</span>
	</div> -->

	<!-- Filter chips -->
	<div class="chips">
		<span class="chip-label">FILTERS:</span>
		{#each filters as f (f.id)}
			<button
				class="chip"
				class:off={!activeFilters.has(f.id)}
				onclick={() => toggleFilter(f.id)}
			>
				<span class="dot" style:background={f.color}></span>
				{f.label}
			</button>
		{/each}
	</div>

	{#if view === 'Week'}
		<!-- Week view -->
		<WeekView {viewDate} {events} />
	{:else}
		<!-- Month grid -->
		<div class="grid">
			{#each WEEKDAYS as d}
				<div class="dow">{d}</div>
			{/each}
			{#each cells as cell (cell.key)}
				{@const dayEvents = eventsByDay.get(cell.key) ?? []}
				<div class="cell" class:dim={!cell.inMonth}>
					<span class="daynum" class:today={isSameDay(cell.date, new Date())}>
						{cell.date.getDate()}
					</span>
					<div class="events">
						{#each dayEvents.slice(0, 3) as ev (ev.id)}
							<button
								class="event"
								style:background={`rgba(${ev.color.r}, ${ev.color.g}, ${ev.color.b}, 0.15)`}
								// style:color={c.fg}
								title={ev.title}
							>
								{ev.title}
							</button>
						{/each}
						{#if dayEvents.length > 3}
							<span class="more">+{dayEvents.length - 3} more</span>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</section>

<style>
	.main {
		flex: 1; min-width: 0;
		display: flex; flex-direction: column;
		background: #fff; border-radius: 16px 0 0 0;
		border-left: 1px solid #e1e3e1;
		overflow: hidden;
	}
	.toolbar {
		display: flex; flex-direction: column; gap: 6px;
		padding: 10px 24px 4px;
	}
	.tb-row { display: flex; align-items: center; gap: 10px; }
	h1 { font-size: 22px; font-weight: 400; color: #1f1f1f; margin: 0; }
	.toolbar :global(.today-btn) {
		border-radius: 999px; text-transform: none; color: #444746; border-color: #c4c7c5;
	}
	.spacer { flex: 1; }
	.nav-group { display: flex; gap: 2px; }
	.icon-btn {
		width: 36px; height: 36px; flex-shrink: 0;
		display: grid; place-items: center;
		border: 0; border-radius: 50%; background: none;
		color: #444746; cursor: pointer;
	}
	.icon-btn:hover { background: #f0f4f9; }
	.only-mobile { display: none; }
	.segmented {
		display: flex; border: 1px solid #c4c7c5; border-radius: 999px; overflow: hidden;
	}
	.segmented button {
		border: 0; background: none; padding: 7px 18px; cursor: pointer;
		font-size: 13px; color: #444746;
	}
	.segmented button.active { background: #c2e7ff; color: #001d35; font-weight: 600; }

	.banner {
		display: flex; align-items: center; gap: 10px;
		margin: 4px 24px 0; padding: 8px 14px;
		background: #e8f0fe; color: #0b57d0;
		border-radius: 10px; font-size: 13px;
	}

	.chips { display: flex; align-items: center; gap: 8px; padding: 12px 24px; }
	.chip-label { font-size: 11px; font-weight: 600; color: #444746; }
	.chip {
		display: flex; align-items: center; gap: 7px;
		border: 1px solid #c4c7c5; border-radius: 8px;
		background: #fff; padding: 5px 12px; cursor: pointer;
		font-size: 12.5px; color: #1f1f1f;
	}
	.chip.off { opacity: 0.45; }
	.dot { width: 8px; height: 8px; border-radius: 50%; }

	.grid {
		flex: 1; overflow-y: auto;
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		grid-template-rows: 28px repeat(6, minmax(104px, 1fr));
		border-top: 1px solid #e1e3e1;
	}
	.dow {
		font-size: 11px; font-weight: 500; color: #444746;
		text-align: center; padding-top: 8px;
		border-left: 1px solid #e1e3e1;
	}
	.dow:nth-child(7n + 1) { border-left: 0; }
	.cell {
		border-left: 1px solid #e1e3e1;
		border-top: 1px solid #e1e3e1;
		padding: 4px 6px; overflow: hidden;
	}
	.cell:nth-child(7n + 8) { border-left: 0; }
	.cell.dim .daynum { color: #9aa0a6; }
	.daynum {
		font-size: 12px; color: #1f1f1f;
		height: 22px; width: 22px; display: grid; place-items: center;
		border-radius: 50%;
	}
	.daynum.today { background: #0b57d0; color: #fff; font-weight: 600; }
	.events { display: flex; flex-direction: column; gap: 3px; margin-top: 4px; }
	.event {
		border: 0; cursor: pointer; text-align: left;
		font-size: 11.5px; font-weight: 500;
		border-radius: 4px; padding: 2px 6px;
		white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
	}
	.more { font-size: 10.5px; color: #5f6368; padding-left: 6px; }

	/* ---- Mobile (Google Calendar phone style) ---- */
	@media (max-width: 860px) {
		.only-mobile { display: grid; }
		.main { border-radius: 0; border-left: 0; }
		.toolbar { padding: 6px 8px 0; gap: 2px; }
		.tb-row { gap: 4px; }
		h1 { font-size: 18px; }
		.icon-btn { width: 34px; height: 34px; }
		.segmented button { padding: 6px 14px; font-size: 12px; }
		.banner { margin: 4px 12px 0; padding: 6px 10px; font-size: 12px; }
		.chips { padding: 8px 12px; overflow-x: auto; scrollbar-width: none; }
		.chips::-webkit-scrollbar { display: none; }
		.chip { flex-shrink: 0; }
		.grid { grid-template-rows: 24px repeat(6, minmax(72px, 1fr)); }
		.dow { font-size: 10px; padding-top: 6px; }
		.cell { padding: 2px 3px; }
		.daynum { margin: 0 auto; font-size: 11px; height: 20px; width: 20px; }
		.events { gap: 2px; margin-top: 2px; }
		.event { font-size: 10px; padding: 1px 4px; }
	}
</style>