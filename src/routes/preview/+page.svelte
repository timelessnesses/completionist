<script lang="ts">
	import MdiIcon from '$lib/components/MdiIcon.svelte';
	import { mdiCalendarMonth } from '@mdi/js';
	import {
		WEEKDAYS,
		MONTHS,
		buildMonthGrid,
		isSameDay,
		addMonths,
		toKey
	} from '$lib/calendar';
	import type { PageProps } from './$types';
	import type { CalendarEvent } from '$lib/mock/data';
	import { onMount } from 'svelte';

	const { data }: PageProps = $props();
	let events = $state<CalendarEvent[]>(data.event);
	let viewDate = $state(new Date());
	let live = $state(false);

	const cells = $derived(buildMonthGrid(viewDate.getFullYear(), viewDate.getMonth()));
	const eventsByDay = $derived(
		Map.groupBy(events, (e) => toKey(new Date(e.start_at)))
	);

	onMount(() => {
		const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
		const ws = new WebSocket(`${proto}://${window.location.host}/api/ws`);

		ws.addEventListener('open', () => {
			live = true;
			ws.send(JSON.stringify({ type: 'preview_subscribe' }));
		});
		ws.addEventListener('close', () => (live = false));
		ws.addEventListener('message', (e) => {
			let msg: any;
			try {
				msg = JSON.parse(e.data);
			} catch {
				return;
			}
			if (msg.type === 'new_calendar_event' && msg.event) {
				const ev: CalendarEvent = msg.event;
				if (!events.some((x) => x.id === ev.id)) events = [...events, ev];
			}
		});

		return () => ws.close();
	});

	function hex(ev: CalendarEvent): string {
		const c = ev.color;
		if (typeof c === 'object' && c !== null && 'r' in c) {
			return `#${[c.r, c.g, c.b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
		}
		return '#0b57d0';
	}
</script>

<svelte:head>
	<title>Calendar Preview</title>
</svelte:head>

<div class="wrap">
	<header class="top">
		<span class="logo"><MdiIcon path={mdiCalendarMonth} size={18} /></span>
		<h1>Calendar preview</h1>
		<span class="live" class:on={live}>{live ? 'Live' : 'Offline'}</span>
		<span class="spacer"></span>
		<button class="nav" aria-label="Previous" onclick={() => (viewDate = addMonths(viewDate, -1))}>‹</button>
		<button class="today" onclick={() => (viewDate = new Date())}>Today</button>
		<button class="nav" aria-label="Next" onclick={() => (viewDate = addMonths(viewDate, 1))}>›</button>
	</header>

	<h2 class="month">{MONTHS[viewDate.getMonth()]} {viewDate.getFullYear()}</h2>

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
						<div
							class="event"
							style:background={`rgba(${ev.color.r}, ${ev.color.g}, ${ev.color.b}, 0.18)`}
							title={ev.task_name}
						>
							{ev.task_name}
						</div>
					{/each}
					{#if dayEvents.length > 3}
						<span class="more">+{dayEvents.length - 3} more</span>
					{/if}
				</div>
			</div>
		{/each}
	</div>
</div>

<style>
	:global(html), :global(body) {
		margin: 0; height: 100%; background: #f8fafd; color: #1f1f1f;
		font-family: 'Google Sans', 'Roboto', 'Segoe UI', Arial, sans-serif;
	}
	.wrap { display: flex; flex-direction: column; height: 100%; padding: 12px 20px; box-sizing: border-box; }
	.top { display: flex; align-items: center; gap: 8px; }
	.logo {
		width: 30px; height: 30px; border-radius: 8px;
		background: #0b57d0; color: #fff; display: grid; place-items: center;
	}
	h1 { font-size: 18px; font-weight: 500; margin: 0; }
	.live {
		font-size: 10.5px; font-weight: 700; letter-spacing: 0.4px;
		padding: 3px 8px; border-radius: 999px;
		background: #e1e3e1; color: #444746;
	}
	.live.on { background: #ceead6; color: #188038; }
	.spacer { flex: 1; }
	.nav {
		border: 0; background: none; width: 32px; height: 32px; border-radius: 50%;
		cursor: pointer; font-size: 18px; color: #444746;
	}
	.nav:hover { background: #f0f4f9; }
	.today {
		border: 1px solid #c4c7c5; background: none; border-radius: 999px;
		padding: 6px 14px; cursor: pointer; font-size: 12.5px; color: #444746;
	}
	.month { font-size: 20px; font-weight: 400; margin: 8px 0 10px; }
	.grid {
		flex: 1; overflow-y: auto;
		display: grid; grid-template-columns: repeat(7, 1fr);
		grid-template-rows: 26px repeat(6, minmax(96px, 1fr));
		border-top: 1px solid #e1e3e1; background: #fff;
		border-radius: 12px;
	}
	.dow {
		font-size: 11px; font-weight: 500; color: #444746;
		text-align: center; padding-top: 8px; border-left: 1px solid #e1e3e1;
	}
	.dow:nth-child(7n + 1) { border-left: 0; }
	.cell { border-left: 1px solid #e1e3e1; border-top: 1px solid #e1e3e1; padding: 4px 6px; overflow: hidden; }
	.cell:nth-child(7n + 8) { border-left: 0; }
	.cell.dim .daynum { color: #9aa0a6; }
	.daynum { font-size: 12px; color: #1f1f1f; height: 22px; width: 22px; display: grid; place-items: center; border-radius: 50%; }
	.daynum.today { background: #0b57d0; color: #fff; font-weight: 600; }
	.events { display: flex; flex-direction: column; gap: 3px; margin-top: 4px; }
	.event { font-size: 11px; font-weight: 500; border-radius: 4px; padding: 2px 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.more { font-size: 10.5px; color: #5f6368; padding-left: 6px; }
</style>
