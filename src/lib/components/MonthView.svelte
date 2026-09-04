<script lang="ts">
	import Button from '@smui/button';
	import {
		mdiChevronLeft,
		mdiChevronRight,
		mdiMenu,
		mdiAccountMultipleOutline,
		mdiCheckboxMarkedCircleOutline,
		mdiTriangleOutline
	} from '@mdi/js';
	import MdiIcon from './MdiIcon.svelte';
	import WeekView from './WeekView.svelte';
	import EventDialog from './EventDialog.svelte';
	import {
		WEEKDAYS,
		MONTHS,
		buildMonthGrid,
		isSameDay,
		addMonths,
		addDays
	} from '$lib/features/calendar/date';
	import { layoutMonthWeeks } from '$lib/features/calendar/month-layout';
	import type { RichTask, FilterTag, UserSummary } from '$lib/features/tasks/types';

	type View = 'Month' | 'Week';

	let {
		onMenu,
		onPeople,
		filters,
		events,
		users = [],
		tasks = [],
		viewerId,
		isAdmin,
		onUpdated,
		onDeleted
	}: {
		onMenu?: () => void;
		onPeople?: () => void;
		filters: FilterTag[];
		events: RichTask[];
		users?: UserSummary[];
		tasks?: RichTask[];
		viewerId: string | null;
		isAdmin: boolean;
		onUpdated?: (ev: RichTask) => void;
		onDeleted?: (id: string) => void;
	} = $props();

	let view = $state<View>('Month');
	let viewDate = $state(new Date());
	let activeFilters = $state(new Set<string>());
	let detailsOpen = $state(false);
	let selectedEvent = $state<RichTask | null>(null);

	$effect(() => {
		const currentFilterIds = new Set(filters.map((filter) => filter.id));
		const next = new Set([...activeFilters].filter((id) => currentFilterIds.has(id)));
		if (next.size !== activeFilters.size || [...next].some((id) => !activeFilters.has(id))) {
			activeFilters = next;
		}
	});

	const cells = $derived(buildMonthGrid(viewDate.getFullYear(), viewDate.getMonth()));
	const filteredEvents = $derived.by(() => {
		if (activeFilters.size === 0) return events;

		return events.filter((event) => {
			const tagIds = (event.tags ?? []).map((link) => link.tag_id);
			return tagIds.some((id) => activeFilters.has(id));
		});
	});
	const monthWeeks = $derived(layoutMonthWeeks(cells, filteredEvents));

	function colorHex(c: { r: number; g: number; b: number }): string {
		return `#${[c.r, c.g, c.b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
	}

	function openEvent(ev: RichTask) {
		selectedEvent = ev;
		detailsOpen = true;
	}

	function canEditEvent(ev: RichTask | null): boolean {
		if (!ev) return false;
		return isAdmin || (!!viewerId && ev.owner === viewerId);
	}

	function canCompleteEvent(ev: RichTask | null): boolean {
		if (!ev || !viewerId) return isAdmin;
		return (
			isAdmin ||
			ev.owner === viewerId ||
			(ev.assignees ?? []).some((assignee) => assignee.user_id === viewerId)
		);
	}

	function step(dir: -1 | 1) {
		viewDate = view === 'Month' ? addMonths(viewDate, dir) : addDays(viewDate, dir * 7);
	}

	function toggleFilter(id: string) {
		const next = new Set(activeFilters);
		next.has(id) ? next.delete(id) : next.add(id);
		activeFilters = next;
	}

	function showAllTags() {
		activeFilters = new Set();
	}

	function handleUpdated(ev: RichTask) {
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
		<button
			class="chip all-tags"
			class:off={activeFilters.size > 0}
			aria-pressed={activeFilters.size === 0}
			onclick={showAllTags}
		>
			<span class="all-tags-mark" aria-hidden="true"></span>
			Show all
		</button>
		{#each filters as f (f.id)}
			<button
				class="chip"
				class:off={!activeFilters.has(f.id)}
				aria-pressed={activeFilters.has(f.id)}
				onclick={() => toggleFilter(f.id)}
			>
				<span class="dot" style:background={colorHex(f.color)}></span>
				{f.tag}
			</button>
		{/each}
	</div>

	{#if view === 'Month'}
		<div class="grid">
			<div class="weekday-row">
				{#each WEEKDAYS as d}
					<div class="dow">{d}</div>
				{/each}
			</div>
			<div class="month-weeks">
				{#each monthWeeks as week (week.key)}
					<div
						class="month-week"
						style:grid-template-rows={`30px repeat(${week.laneCount}, 24px) minmax(4px, 1fr)`}
					>
						{#each week.cells as cell, index (cell.key)}
							<div class="cell" class:dim={!cell.inMonth} style:grid-column={index + 1}>
								<span class="daynum" class:today={isSameDay(cell.date, new Date())}
									>{cell.date.getDate()}</span
								>
							</div>
						{/each}
						{#each week.bars as bar (bar.event.id)}
							<button
								class="event"
								class:continues-before={bar.continuesBefore}
								class:continues-after={bar.continuesAfter}
								style:grid-column={`${bar.startColumn} / span ${bar.span}`}
								style:grid-row={bar.lane + 2}
								style:background={`rgba(${bar.event.color.r}, ${bar.event.color.g}, ${bar.event.color.b}, 0.15)`}
								style:color={`rgb(${bar.event.color.r}, ${bar.event.color.g}, ${bar.event.color.b})`}
								title={bar.event.task_name}
								onclick={() => openEvent(bar.event)}
							>
								<span class="event-label">{bar.event.task_name}</span>
								{#if bar.event.completed}
									<span class="event-status done" aria-hidden="true">
										<MdiIcon path={mdiCheckboxMarkedCircleOutline} size={14} />
									</span>
								{:else if (bar.event.dependents?.length ?? 0) > 0}
									<span class="event-status blocked" aria-hidden="true">
										<MdiIcon path={mdiTriangleOutline} size={14} />
									</span>
								{/if}
							</button>
						{/each}
					</div>
				{/each}
			</div>
		</div>
	{:else}
		<div class="week-wrap">
			<WeekView
				{viewDate}
				events={filteredEvents}
				followCurrentTime={true}
				onSelectEvent={openEvent}
			/>
		</div>
	{/if}

	<!-- Upcoming list removed -->

	<EventDialog
		bind:open={detailsOpen}
		event={selectedEvent}
		canEdit={canEditEvent(selectedEvent)}
		canComplete={canCompleteEvent(selectedEvent)}
		tags={filters}
		onupdated={handleUpdated}
		ondeleted={handleDeleted}
		{users}
		{tasks}
	/>
</section>

<style>
	.main {
		flex: 1;
		height: 100%;
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
		/* background: #fff; */
		border-radius: 16px 0 0 0;
		border-left: 1px solid #e1e3e1;
		overflow: hidden;
	}
	.toolbar {
		flex: 0 0 auto;
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
		/* color: #1f1f1f; */
		margin: 0;
	}
	.toolbar :global(.today-btn) {
		border-radius: 999px;
		text-transform: none;
		/* color: #444746; */
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
		color: var(--color-foreground);
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
		color: var(--color-foreground);
	}
	.segmented button.active {
		background: #c2e7ff;
		color: #001d35;
		font-weight: 600;
	}

	.chips {
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 12px 24px;
	}
	.chip-label {
		font-size: 11px;
		font-weight: 600;
		color: var(--color-foreground);
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
		transition:
			opacity 150ms ease,
			background 150ms ease,
			border-color 150ms ease,
			box-shadow 150ms ease;
	}
	.chip:not(.off) {
		border-color: #a8c7fa;
		background: #e8f0fe;
		color: #0842a0;
		box-shadow: inset 0 0 0 1px rgb(11 87 208 / 6%);
	}
	.chip.off {
		opacity: 0.45;
	}
	.chip:hover {
		opacity: 1;
	}
	.chip:focus-visible {
		outline: 2px solid #0b57d0;
		outline-offset: 2px;
	}
	.all-tags-mark {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: conic-gradient(#0b57d0 0 25%, #34a853 0 50%, #fbbc04 0 75%, #ea4335 0);
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}

	.grid {
		flex: 1 1 0;
		min-height: 0;
		min-width: 0;
		width: 100%;
		display: flex;
		flex-direction: column;
		border-top: 1px solid #e1e3e1;
		overflow: auto;
	}
	.weekday-row,
	.month-week {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
	}
	.weekday-row {
		flex: 0 0 28px;
		position: sticky;
		top: 0;
		z-index: 3;
		background: var(--color-background);
	}
	.month-weeks {
		flex: 1;
		display: grid;
		grid-template-rows: repeat(6, minmax(96px, 1fr));
	}
	.month-week {
		min-height: 96px;
		position: relative;
	}
	.dow {
		font-size: 11px;
		font-weight: 500;
		color: var(--color-foreground);
		text-align: center;
		padding-top: 8px;
		border-left: 1px solid #e1e3e1;
	}
	.dow:nth-child(7n + 1) {
		border-left: 0;
	}
	.month-week .cell {
		grid-row: 1 / -1;
		position: relative;
		z-index: 0;
		min-width: 0;
		min-height: 0;
		border-left: 1px solid #e1e3e1;
		border-top: 1px solid #e1e3e1;
		padding: 4px 6px;
	}
	.month-week .cell:first-child {
		border-left: 0;
	}
	.cell.dim .daynum {
		color: #4d5155 !important;
	}
	.daynum {
		font-size: 12px;
		line-height: 1;
		color: var(--color-foreground);
		height: 22px;
		width: 22px;
		min-width: 22px;
		max-width: 22px;
		flex-shrink: 0;
		box-sizing: border-box;
		display: inline-grid;
		place-items: center;
		border-radius: 50%;
	}
	.daynum.today {
		background: #0b57d0;
		color: #fff;
		font-weight: 600;
	}
	.event {
		z-index: 1;
		align-self: center;
		min-width: 0;
		margin: 1px 6px;
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
		gap: 6px;
	}
	.event-label {
		min-width: 0;
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.event-status {
		flex-shrink: 0;
	}
	.event-status.done {
		color: #188038;
	}
	.event-status.blocked {
		color: #d93025;
	}
	.event.continues-before {
		margin-left: 0;
		border-top-left-radius: 0;
		border-bottom-left-radius: 0;
	}
	.event.continues-after {
		margin-right: 0;
		border-top-right-radius: 0;
		border-bottom-right-radius: 0;
	}
	.week-wrap {
		flex: 1 1 0;
		border-top: 1px solid #e1e3e1;
		min-height: 0;
		display: flex;
		overflow: hidden;
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
		.weekday-row {
			flex-basis: 24px;
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
		.event {
			font-size: 10px;
			padding: 1px 4px;
			margin-inline: 3px;
		}
		.event.continues-before {
			margin-left: 0;
		}
		.event.continues-after {
			margin-right: 0;
		}
	}
</style>
