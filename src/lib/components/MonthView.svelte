<script lang="ts">
	import Button, { Label } from '@smui/button';
	import IconButton from '@smui/icon-button';
	import Tooltip, { Wrapper } from '@smui/tooltip';
	import { mdiCloudCheckOutline, mdiArrowUpCircleOutline } from '@mdi/js';
	import MdiIcon from './MdiIcon.svelte';
	import {
		WEEKDAYS, MONTHS, buildMonthGrid, isSameDay, addMonths
	} from '$lib/calendar';
	import { events, filters, workspace, eventPalette, MOCK_TODAY } from '$lib/mock/data';

	type View = 'Month' | 'Week' | 'Day';
	const views: View[] = ['Month', 'Week', 'Day'];

	let viewDate = $state(new Date(2026, 7, 1)); // August 2026
	let view = $state<View>('Month');
	let activeFilters = $state(new Set(filters.map((f) => f.id)));

	const cells = $derived(buildMonthGrid(viewDate.getFullYear(), viewDate.getMonth()));
	const eventsByDay = $derived(Map.groupBy(events, (e) => e.date));

	function toggleFilter(id: string) {
		const next = new Set(activeFilters);
		next.has(id) ? next.delete(id) : next.add(id);
		activeFilters = next;
	}
</script>

<section class="main">
	<!-- Toolbar -->
	<header class="toolbar">
		<h1>{MONTHS[viewDate.getMonth()]} {viewDate.getFullYear()}</h1>
		<Button variant="outlined" class="today-btn" onclick={() => (viewDate = new Date(MOCK_TODAY))}>
			<Label>Today</Label>
		</Button>
		<span class="spacer"></span>
		<div class="segmented">
			{#each views as v}
				<button class:active={view === v} onclick={() => (view = v)}>{v}</button>
			{/each}
		</div>
	</header>

	<!-- Sharing banner -->
	<div class="banner">
		<MdiIcon path={mdiCloudCheckOutline} size={18} />
		<span>
			Shared with {workspace.sharedWith} people · {workspace.permission} · {workspace.session}
		</span>
	</div>

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
		<span class="spacer"></span>
		<Wrapper>
			<IconButton class="jump" onclick={() => (viewDate = addMonths(viewDate, 1))}>
				<MdiIcon path={mdiArrowUpCircleOutline} size={22} />
			</IconButton>
			<Tooltip>Jump a month (mock)</Tooltip>
		</Wrapper>
	</div>

	{#if view !== 'Month'}
		<div class="placeholder">{view} view — not built yet (mock).</div>
	{:else}
		<!-- Month grid -->
		<div class="grid">
			{#each WEEKDAYS as d}
				<div class="dow">{d}</div>
			{/each}
			{#each cells as cell (cell.key)}
				<div class="cell" class:dim={!cell.inMonth}>
					<span class="daynum" class:today={isSameDay(cell.date, MOCK_TODAY)}>
						{cell.date.getDate()}
					</span>
					<div class="events">
						{#each eventsByDay.get(cell.key) ?? [] as ev (ev.id)}
							{@const c = eventPalette[ev.color]}
							<button
								class="event"
								style:background={c.bg}
								style:color={c.fg}
								title={ev.title}
							>
								{ev.title}
							</button>
						{/each}
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
	.toolbar { display: flex; align-items: center; gap: 16px; padding: 12px 24px 8px; }
	h1 { font-size: 22px; font-weight: 400; color: #1f1f1f; margin: 0; }
	.toolbar :global(.today-btn) {
		border-radius: 999px; text-transform: none; color: #444746; border-color: #c4c7c5;
	}
	.spacer { flex: 1; }
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
	.chips :global(.jump) { color: #444746; }

	.placeholder { padding: 48px 24px; color: #747775; }

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
</style>