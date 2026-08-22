<script lang="ts">
	import Button from '@smui/button';
	import {
		mdiChevronLeft,
		mdiChevronRight,
		mdiMenu,
		mdiAccountMultipleOutline,
		mdiCircleMedium
	} from '@mdi/js';
	import MdiIcon from './MdiIcon.svelte';
	import WeekView from './WeekView.svelte';
	import EventDetailsDialog from './EventDetailsDialog.svelte';
	import {
		WEEKDAYS,
		MONTHS,
		buildMonthGrid,
		isSameDay,
		addMonths,
		addDays,
		toKey
	} from '$lib/calendar';
	import type { CalendarEvent, FilterTag } from '$lib/mock/data';

	type View = 'Month' | 'Week';

	let {
		onMenu,
		onPeople,
		filters,
		events,
		viewerId,
		isAdmin,
		onUpdated,
		onDeleted
	}: {
		onMenu?: () => void;
		onPeople?: () => void;
		filters: FilterTag[];
		events: CalendarEvent[];
		viewerId: string | null;
		isAdmin: boolean;
		onUpdated?: (ev: CalendarEvent) => void;
		onDeleted?: (id: string) => void;
	} = $props();

	let view = $state<View>('Month');
	let viewDate = $state(new Date());
	let activeFilters = $state(new Set(filters.map((f) => f.id)));
	let detailsOpen = $state(false);
	let selectedEvent = $state<CalendarEvent | null>(null);

	const cells = $derived(buildMonthGrid(viewDate.getFullYear(), viewDate.getMonth()));
	const eventsByDay = $derived.by(() => {
		const map = new Map<string, CalendarEvent[]>();
		for (const ev of events) {
			const start = new Date(ev.start_at);
			const end = new Date(ev.end_at);
			const day = new Date(start.getFullYear(), start.getMonth(), start.getDate());
			const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
			let guard = 0;
			while (day <= last && guard++ < 400) {
				const key = toKey(day);
				const bucket = map.get(key) ?? [];
				bucket.push(ev);
				map.set(key, bucket);
				day.setDate(day.getDate() + 1);
			}
		}
		return map;
	});

	function colorHex(c: { r: number; g: number; b: number }): string {
		return `#${[c.r, c.g, c.b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
	}

	function dayOnly(d: Date): Date {
		return new Date(d.getFullYear(), d.getMonth(), d.getDate());
	}

	function spansPrevDay(ev: CalendarEvent, day: Date): boolean {
		const prev = addDays(dayOnly(day), -1);
		const start = dayOnly(new Date(ev.start_at));
		const end = dayOnly(new Date(ev.end_at));
		return prev >= start && prev <= end;
	}

	function spansNextDay(ev: CalendarEvent, day: Date): boolean {
		const next = addDays(dayOnly(day), 1);
		const start = dayOnly(new Date(ev.start_at));
		const end = dayOnly(new Date(ev.end_at));
		return next >= start && next <= end;
	}

	function openEvent(ev: CalendarEvent) {
		selectedEvent = ev;
		detailsOpen = true;
	}

	function canEditEvent(ev: CalendarEvent | null): boolean {
		if (!ev) return false;
		return isAdmin || (!!viewerId && ev.owner === viewerId);
	}

	function step(dir: -1 | 1) {
		viewDate = view === 'Month' ? addMonths(viewDate, dir) : addDays(viewDate, dir * 7);
	}

	function toggleFilter(id: string) {
		const next = new Set(activeFilters);
		next.has(id) ? next.delete(id) : next.add(id);
		activeFilters = next;
	}

	function handleUpdated(ev: CalendarEvent) {
		onUpdated?.(ev);
	}

	function handleDeleted(id: string) {
		onDeleted?.(id);
	}
</script>

<section class="main">
	<header class="toolbar">
		<div class="tb-row">
			<button class="icon-btn only-mobile" aria-label="Open menu" onclick={() => onMenu?.()}>
				<MdiIcon path={mdiMenu} size={22} />
			</button>
			<h1>{MONTHS[viewDate.getMonth()]} {viewDate.getFullYear()}</h1>
			<span class="spacer"></span>
			<Button variant="outlined" class="today-btn" onclick={() => (viewDate = new Date())}
				>Today</Button
			>
			<button
				class="icon-btn only-mobile"
				aria-label="Open people panel"
				onclick={() => onPeople?.()}
			>
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
			<div class="segmented" role="tablist" aria-label="Calendar view switch">
				<button class:active={view === 'Month'} onclick={() => (view = 'Month')}>Month</button>
				<button class:active={view === 'Week'} onclick={() => (view = 'Week')}>Week</button>
			</div>
		</div>
	</header>

	<div class="chips">
		<span class="chip-label">FILTERS:</span>
		{#each filters as f (f.id)}
			<button class="chip" class:off={!activeFilters.has(f.id)} onclick={() => toggleFilter(f.id)}>
				<span class="dot" style:background={colorHex(f.color)}></span>
				{f.tag}
			</button>
		{/each}
	</div>

	{#if view === 'Month'}
		<div class="grid">
			{#each WEEKDAYS as d}
				<div class="dow">{d}</div>
			{/each}
			{#each cells as cell (cell.key)}
				{@const dayEvents = eventsByDay.get(cell.key) ?? []}
				<div class="cell" class:dim={!cell.inMonth}>
					<span class="daynum" class:today={isSameDay(cell.date, new Date())}
						>{cell.date.getDate()}</span
					>
					<div class="events">
						{#each dayEvents.slice(0, 3) as ev (ev.id)}
							<button
								class="event"
								class:cont-prev={spansPrevDay(ev, cell.date)}
								class:cont-next={spansNextDay(ev, cell.date)}
								style:background={`rgba(${ev.color.r}, ${ev.color.g}, ${ev.color.b}, 0.15)`}
								style:color={`rgb(${ev.color.r}, ${ev.color.g}, ${ev.color.b})`}
								title={ev.task_name}
								onclick={() => openEvent(ev)}
							>
								{#if !spansPrevDay(ev, cell.date)}
									{ev.task_name}
								{:else}
									<MdiIcon path={mdiCircleMedium} size={12} />
								{/if}
							</button>
						{/each}
						{#if dayEvents.length > 3}
							<span class="more">+{dayEvents.length - 3} more</span>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{:else}
		<div class="week-wrap">
			<WeekView {viewDate} {events} onSelectEvent={openEvent} />
		</div>
	{/if}

		<!-- Upcoming list removed -->

	<EventDetailsDialog
		bind:open={detailsOpen}
		event={selectedEvent}
		canEdit={canEditEvent(selectedEvent)}
		onupdated={handleUpdated}
		ondeleted={handleDeleted}
	/>
</section>

<style>
	.main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		background: #fff;
		border-radius: 16px 0 0 0;
		border-left: 1px solid #e1e3e1;
		overflow-y: auto;
		overflow-x: hidden;
	}
	.toolbar {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 10px 24px 4px;
	}
	.tb-row {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	h1 {
		font-size: 22px;
		font-weight: 400;
		color: #1f1f1f;
		margin: 0;
	}
	.toolbar :global(.today-btn) {
		border-radius: 999px;
		text-transform: none;
		color: #444746;
		border-color: #c4c7c5;
	}
	.spacer {
		flex: 1;
	}
	.nav-group {
		display: flex;
		gap: 2px;
	}
	.icon-btn {
		width: 36px;
		height: 36px;
		flex-shrink: 0;
		display: grid;
		place-items: center;
		border: 0;
		border-radius: 50%;
		background: none;
		color: #444746;
		cursor: pointer;
	}
	.icon-btn:hover {
		background: #f0f4f9;
	}
	.only-mobile {
		display: none;
	}

	.segmented {
		display: flex;
		border: 1px solid #c4c7c5;
		border-radius: 999px;
		overflow: hidden;
	}
	.segmented button {
		border: 0;
		background: none;
		padding: 7px 18px;
		cursor: pointer;
		font-size: 13px;
		color: #444746;
	}
	.segmented button.active {
		background: #c2e7ff;
		color: #001d35;
		font-weight: 600;
	}

	.chips {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 12px 24px;
	}
	.chip-label {
		font-size: 11px;
		font-weight: 600;
		color: #444746;
	}
	.chip {
		display: flex;
		align-items: center;
		gap: 7px;
		border: 1px solid #c4c7c5;
		border-radius: 8px;
		background: #fff;
		padding: 5px 12px;
		cursor: pointer;
		font-size: 12.5px;
		color: #1f1f1f;
	}
	.chip.off {
		opacity: 0.45;
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}

	.grid {
		flex: 0 0 auto;
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		grid-template-rows: 28px repeat(6, minmax(104px, 1fr));
		border-top: 1px solid #e1e3e1;
	}
	.dow {
		font-size: 11px;
		font-weight: 500;
		color: #444746;
		text-align: center;
		padding-top: 8px;
		border-left: 1px solid #e1e3e1;
	}
	.dow:nth-child(7n + 1) {
		border-left: 0;
	}
	.cell {
		border-left: 1px solid #e1e3e1;
		border-top: 1px solid #e1e3e1;
		padding: 4px 6px;
		overflow: hidden;
	}
	.cell:nth-child(7n + 8) {
		border-left: 0;
	}
	.cell.dim .daynum {
		color: #9aa0a6;
	}
	.daynum {
		font-size: 12px;
		color: #1f1f1f;
		height: 22px;
		width: 22px;
		display: grid;
		place-items: center;
		border-radius: 50%;
	}
	.daynum.today {
		background: #0b57d0;
		color: #fff;
		font-weight: 600;
	}
	.events {
		display: flex;
		flex-direction: column;
		gap: 3px;
		margin-top: 4px;
	}
	.event {
		border: 0;
		cursor: pointer;
		text-align: left;
		font-size: 11.5px;
		font-weight: 500;
		border-radius: 4px;
		padding: 2px 6px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		display: flex;
		align-items: center;
		gap: 2px;
	}
	.event.cont-prev {
		margin-left: -6px;
		padding-left: 8px;
		border-top-left-radius: 0;
		border-bottom-left-radius: 0;
	}
	.event.cont-next {
		margin-right: -6px;
		padding-right: 8px;
		border-top-right-radius: 0;
		border-bottom-right-radius: 0;
	}
	.more {
		font-size: 10.5px;
		color: #5f6368;
		padding-left: 6px;
	}
	.week-wrap {
		border-top: 1px solid #e1e3e1;
		min-height: 0;
	}
	.upcoming-wrap {
		border-top: 1px solid #e1e3e1;
		padding: 0 8px 10px;
		overflow-x: auto;
	}

	@media (max-width: 860px) {
		.only-mobile {
			display: grid;
		}
		.main {
			border-radius: 0;
			border-left: 0;
		}
		.toolbar {
			padding: 6px 8px 0;
			gap: 2px;
		}
		.tb-row {
			gap: 4px;
		}
		h1 {
			font-size: 18px;
		}
		.icon-btn {
			width: 34px;
			height: 34px;
		}
		.segmented button {
			padding: 6px 12px;
			font-size: 12px;
		}
		.chips {
			padding: 8px 12px;
			overflow-x: auto;
			scrollbar-width: none;
		}
		.chips::-webkit-scrollbar {
			display: none;
		}
		.chip {
			flex-shrink: 0;
		}
		.grid {
			grid-template-rows: 24px repeat(6, minmax(72px, 1fr));
		}
		.dow {
			font-size: 10px;
			padding-top: 6px;
		}
		.cell {
			padding: 2px 3px;
		}
		.daynum {
			margin: 0 auto;
			font-size: 11px;
			height: 20px;
			width: 20px;
		}
		.events {
			gap: 2px;
			margin-top: 2px;
		}
		.event {
			font-size: 10px;
			padding: 1px 4px;
		}
		.event.cont-prev {
			margin-left: -3px;
			padding-left: 5px;
		}
		.event.cont-next {
			margin-right: -3px;
			padding-right: 5px;
		}
		.upcoming-wrap {
			padding: 0 4px 10px;
		}
	}
</style>
