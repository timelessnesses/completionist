<script lang="ts">
	import MdiIcon from '$lib/components/MdiIcon.svelte';
	import WeekView from '$lib/components/WeekView.svelte';
	import { mdiCalendarMonth } from '@mdi/js';
	import {
		WEEKDAYS,
		MONTHS,
		buildMonthGrid,
		isSameDay,
		addMonths,
		toKey,
		prettyDate
	} from '$lib/calendar';
	import type { PageProps } from './$types';
	import type { CalendarEvent } from '$lib/mock/data';
	import { onMount } from 'svelte';

	const { data }: PageProps = $props();
	let events = $state<CalendarEvent[]>(data.event);
	let viewDate = $state(new Date());
	let live = $state(false);
	let nowMs = $state(Date.now());

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
	const sortedByStart = $derived(
		[...events].sort((a, b) => +new Date(a.start_at) - +new Date(b.start_at))
	);
	const activeEvent = $derived.by(() =>
		sortedByStart.find((ev) => {
			const start = +new Date(ev.start_at);
			const end = +new Date(ev.end_at);
			return start <= nowMs && nowMs < end;
		})
	);
	const nextEvent = $derived.by(() => sortedByStart.find((ev) => +new Date(ev.start_at) > nowMs));
	const msUntilNext = $derived(nextEvent ? +new Date(nextEvent.start_at) - nowMs : Infinity);
	const isCountdownState = $derived(!activeEvent && msUntilNext > 0 && msUntilNext <= 60_000);
	const upcomingAfterActive = $derived.by(() => {
		const threshold = activeEvent ? +new Date(activeEvent.end_at) : nowMs;
		return sortedByStart.filter((ev) => +new Date(ev.start_at) > threshold).slice(0, 4);
	});

	onMount(() => {
		const tick = setInterval(() => {
			nowMs = Date.now();
		}, 50);

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

		return () => {
			clearInterval(tick);
			ws.close();
		};
	});

	function hex(ev: CalendarEvent): string {
		const c = ev.color;
		if (typeof c === 'object' && c !== null && 'r' in c) {
			return `#${[c.r, c.g, c.b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
		}
		return '#0b57d0';
	}

	function pad2(n: number): string {
		return `${n}`.padStart(2, '0');
	}

	function countdownWithMs(ms: number): string {
		const clamped = Math.max(ms, 0);
		const minutes = Math.floor(clamped / 60_000);
		const seconds = Math.floor((clamped % 60_000) / 1000);
		const millis = clamped % 1000;
		return `${pad2(minutes)}:${pad2(seconds)}.${`${millis}`.padStart(3, '0')}`;
	}

	function durationLeft(ms: number): string {
		const clamped = Math.max(ms, 0);
		const hours = Math.floor(clamped / 3_600_000);
		const minutes = Math.floor((clamped % 3_600_000) / 60_000);
		const seconds = Math.floor((clamped % 60_000) / 1000);
		return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
	}

	function startLabel(ev: CalendarEvent): string {
		const start = new Date(ev.start_at);
		if (ev.all_day) return prettyDate(toKey(start));
		return `${prettyDate(toKey(start))}, ${pad2(start.getHours())}:${pad2(start.getMinutes())}`;
	}
</script>

<svelte:head>
	<title>Calendar Preview</title>
</svelte:head>

<div class="wrap" class:dimmed={isCountdownState}>
	<header class="top">
		<span class="logo"><MdiIcon path={mdiCalendarMonth} size={18} /></span>
		<h1>Calendar preview</h1>
		<span class="live" class:on={live}>{live ? 'Live' : 'Offline'}</span>
		<span class="spacer"></span>
		<button class="nav" aria-label="Previous" onclick={() => (viewDate = addMonths(viewDate, -1))}
			>‹</button
		>
		<button class="today" onclick={() => (viewDate = new Date())}>Today</button>
		<button class="nav" aria-label="Next" onclick={() => (viewDate = addMonths(viewDate, 1))}
			>›</button
		>
	</header>

	<h2 class="month">{MONTHS[viewDate.getMonth()]} {viewDate.getFullYear()}</h2>

	<div class="cal-layout">
		<section class="month-pane">
			<h3 class="pane-title">Month</h3>
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
		</section>

		<section class="week-pane">
			<h3 class="pane-title">Week</h3>
			<WeekView {viewDate} {events} />
		</section>
	</div>

	{#if isCountdownState && nextEvent}
		<div class="countdown-overlay" aria-live="polite">
			<div class="countdown-card">
				<div class="eyebrow">Starting Soon</div>
				<h3>{nextEvent.task_name}</h3>
				<div class="timer">{countdownWithMs(msUntilNext)}</div>
				<p>Starts in under one minute.</p>
			</div>
		</div>
	{/if}

	{#if activeEvent}
		<div class="active-overlay" aria-live="polite">
			<div class="active-card">
				<div class="eyebrow">Active Event</div>
				<h3>{activeEvent.task_name}</h3>
				<div class="left">Time left {durationLeft(+new Date(activeEvent.end_at) - nowMs)}</div>
				<div class="meta">Started {startLabel(activeEvent)}</div>
				{#if upcomingAfterActive.length > 0}
					<div class="next">Upcoming</div>
					<ul>
						{#each upcomingAfterActive as ev (ev.id)}
							<li>
								<span class="dot" style:background={hex(ev)}></span>
								<span class="name">{ev.task_name}</span>
								<span class="when">{startLabel(ev)}</span>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	:global(html),
	:global(body) {
		margin: 0;
		height: 100%;
		background: #f8fafd;
		color: #1f1f1f;
		font-family: 'Google Sans', 'Roboto', 'Segoe UI', Arial, sans-serif;
	}
	.wrap {
		display: flex;
		flex-direction: column;
		height: 100%;
		padding: 12px 20px;
		box-sizing: border-box;
		position: relative;
		transition:
			filter 150ms ease,
			background 150ms ease;
	}
	.wrap.dimmed {
		filter: brightness(0.55) saturate(0.85);
	}
	.top {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.logo {
		width: 30px;
		height: 30px;
		border-radius: 8px;
		background: #0b57d0;
		color: #fff;
		display: grid;
		place-items: center;
	}
	h1 {
		font-size: 18px;
		font-weight: 500;
		margin: 0;
	}
	.live {
		font-size: 10.5px;
		font-weight: 700;
		letter-spacing: 0.4px;
		padding: 3px 8px;
		border-radius: 999px;
		background: #e1e3e1;
		color: #444746;
	}
	.live.on {
		background: #ceead6;
		color: #188038;
	}
	.spacer {
		flex: 1;
	}
	.nav {
		border: 0;
		background: none;
		width: 32px;
		height: 32px;
		border-radius: 50%;
		cursor: pointer;
		font-size: 18px;
		color: #444746;
	}
	.nav:hover {
		background: #f0f4f9;
	}
	.today {
		border: 1px solid #c4c7c5;
		background: none;
		border-radius: 999px;
		padding: 6px 14px;
		cursor: pointer;
		font-size: 12.5px;
		color: #444746;
	}
	.month {
		font-size: 20px;
		font-weight: 400;
		margin: 8px 0 10px;
	}
	.cal-layout {
		flex: 1;
		min-height: 0;
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 14px;
	}
	.month-pane,
	.week-pane {
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}



	.pane-title {
		margin: 0 0 8px;
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.45px;
		text-transform: uppercase;
		/* color: #5f6368; */
	}
	.grid {
		flex: 1;
		overflow-y: auto;
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		grid-template-rows: 26px repeat(6, minmax(96px, 1fr));
		border-top: 1px solid #e1e3e1;
		background: #fff;
		border-radius: 12px;
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
	line-height: 22px; /* match height directly instead of relying on place-items */
	color: #1f1f1f;
	height: 22px;
	width: 22px;
	flex-shrink: 0;
	box-sizing: border-box;
	display: inline-flex; /* flex box in both dimensions is more reliably constrained than inline-grid */
	align-items: center;
	justify-content: center;
	border-radius: 50%;
	aspect-ratio: 1 / 1; /* belt-and-suspenders: forces a true circle regardless of width/height conflicts */
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
		font-size: 11px;
		font-weight: 500;
		border-radius: 4px;
		padding: 2px 6px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.more {
		font-size: 10.5px;
		color: #5f6368;
		padding-left: 6px;
	}

	.countdown-overlay,
	.active-overlay {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		pointer-events: none;
		z-index: 10;
	}
	.countdown-card {
		pointer-events: auto;
		background: rgba(20, 24, 29, 0.78);
		color: #fff;
		border-radius: 16px;
		padding: 22px 26px;
		text-align: center;
		min-width: min(420px, calc(100vw - 40px));
		backdrop-filter: blur(4px);
	}
	.countdown-card h3 {
		margin: 6px 0 10px;
		font-size: 28px;
		font-weight: 600;
	}
	.countdown-card .timer {
		font-size: 44px;
		font-weight: 700;
		letter-spacing: 1px;
		font-variant-numeric: tabular-nums;
	}
	.countdown-card p {
		margin: 10px 0 0;
		opacity: 0.9;
	}
	.eyebrow {
		text-transform: uppercase;
		font-size: 11px;
		letter-spacing: 1px;
		opacity: 0.85;
	}

	.active-overlay {
		background: rgba(110, 114, 121, 0.94);
		pointer-events: auto;
	}
	.active-card {
		width: min(760px, calc(100vw - 40px));
		background: rgba(246, 247, 248, 0.97);
		border-radius: 18px;
		padding: 20px 24px;
		color: #202124;
	}
	.active-card h3 {
		margin: 6px 0 12px;
		font-size: 30px;
		font-weight: 700;
	}
	.active-card .left {
		font-size: 20px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.active-card .meta {
		margin-top: 4px;
		font-size: 12px;
		color: #5f6368;
	}
	.active-card .next {
		margin-top: 16px;
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.6px;
		color: #5f6368;
	}
	.active-card ul {
		margin: 8px 0 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 7px;
	}
	.active-card li {
		display: grid;
		grid-template-columns: 10px 1fr auto;
		gap: 10px;
		align-items: center;
		padding: 8px 10px;
		background: #fff;
		border-radius: 10px;
		border: 1px solid #e1e3e1;
	}
	.active-card .dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
	}
	.active-card .name {
		font-size: 13px;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.active-card .when {
		font-size: 12px;
		color: #5f6368;
	}

	@media (max-width: 1180px) {
		.cal-layout {
			grid-template-columns: 1fr;
		}
	}
</style>
