<script lang="ts">
	import MdiIcon from '$lib/components/MdiIcon.svelte';
	import WeekView from '$lib/components/WeekView.svelte';
	import {
		mdiAccountMultipleOutline,
		mdiBugOutline,
		mdiCalendarMonth,
		mdiClockOutline,
		mdiCloudSyncOutline
	} from '@mdi/js';
	import {
		WEEKDAYS,
		MONTHS,
		buildMonthGrid,
		isSameDay,
		addMonths,
		toDateKey as toKey,
		prettyDate
	} from '$lib/features/calendar/date';
	import { layoutMonthWeeks } from '$lib/features/calendar/month-layout';
	import {
		compareEventStarts,
		compareMostRecentlyStarted,
		formatTimeUntil,
		shouldShowPrestartCountdown
	} from '$lib/features/calendar/preview-timing';
	import type { PageProps } from './$types';
	import type { RichTask } from '$lib/features/tasks/types';
	import { onMount, tick } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { fly, scale } from 'svelte/transition';
	import { subscribeWS } from '$lib/websocket.svelte';
	import { compareTaskPriority } from '$lib/features/tasks/priority';

	const { data }: PageProps = $props();
	const initialWorkerTime = data.workerTime;
	let events = $state<RichTask[]>(data.event);
	let viewDate = $state(new Date());
	let live = $state(false);
	let previewSubscribed = $state(false);
	let clockOffsetMs = $state(initialWorkerTime - Date.now());
	let nowMs = $state(initialWorkerTime);
	let timerNowMs = $state(initialWorkerTime);
	let clockSynced = $state(false);
	let clockSyncing = $state(false);
	let clockLatencyMs = $state<number | null>(null);
	let workerEdge = $state(data.workerEdge);
	let activeCountdownReady = $state(false);
	let lastActiveEventId: string | null = null;
	let debugEvent = $state<RichTask | null>(null);
	let debugStartsAtMs = $state(0);
	let debugIntroEndMs = $state(0);
	let debugEndMs = $state(0);
	let debugBroadcasting = $state(false);
	let monthGridEl: HTMLElement;
	const debugFallbackEvent: RichTask = {
		id: 'preview-debug-event',
		parent: null,
		task_name: 'Preview test event',
		description: 'Local-only event trigger simulation.',
		color: { r: 11, g: 87, b: 208 },
		owner: 'preview-debug',
		created_at: new Date(),
		start_at: new Date(),
		end_at: new Date(Date.now() + 90_000),
		status: 'todo',
		all_day: 0,
		importance_value: 0,
		completed: null,
		deleted_at: null
	};

	$effect(() => {
		events = data.event;
	});

	const cells = $derived(buildMonthGrid(viewDate.getFullYear(), viewDate.getMonth()));
	const monthWeeks = $derived(layoutMonthWeeks(cells, events));
	const prioritizedEvents = $derived(
		[...events]
			.filter((event) => !event.completed && event.status !== 'cancelled')
			.sort((a, b) => compareTaskPriority(a, b, data.viewerId))
	);
	const activeEvent = $derived.by(
		() =>
			prioritizedEvents
				.filter((ev) => {
					const start = +new Date(ev.start_at);
					const end = +new Date(ev.end_at);
					return start <= nowMs && nowMs < end;
				})
				.sort(compareMostRecentlyStarted)[0]
	);
	const upcomingEvents = $derived(
		prioritizedEvents
			.filter((event) => +new Date(event.start_at) > nowMs && +new Date(event.end_at) > nowMs)
			.sort(compareEventStarts)
	);
	const nextEvent = $derived(upcomingEvents[0]);
	const nextEventDependencies = $derived.by(() => {
		if (!nextEvent) return [];
		const eventMap = new Map(events.map((event) => [event.id, event]));
		const dependencies = (nextEvent.dependencies ?? []).flatMap((link) => {
			const dependency = eventMap.get(link.dependency_id) ?? link.dependency;
			return dependency ? [dependency as RichTask] : [];
		});
		return [...new Map(dependencies.map((event) => [event.id, event])).values()].sort(
			(a, b) => +new Date(a.start_at) - +new Date(b.start_at)
		);
	});
	const followingEvents = $derived(upcomingEvents.slice(1, 4));
	const msUntilNext = $derived(nextEvent ? +new Date(nextEvent.start_at) - nowMs : Infinity);
	const timerMsUntilNext = $derived(
		nextEvent ? +new Date(nextEvent.start_at) - timerNowMs : Infinity
	);
	const isCountdownState = $derived(shouldShowPrestartCountdown(nextEvent, nowMs));
	const workerClockTime = $derived(formatWorkerTime(nowMs));
	const workerClockDate = $derived(formatWorkerDate(nowMs));
	const debugTarget = $derived(nextEvent ?? prioritizedEvents[0] ?? debugFallbackEvent);
	const debugPrestartActive = $derived(
		!!debugEvent && debugStartsAtMs > 0 && timerNowMs < debugStartsAtMs
	);
	const debugIntroActive = $derived(
		!!debugEvent && !debugPrestartActive && timerNowMs < debugIntroEndMs
	);

	$effect(() => {
		void viewDate;
		void tick().then(() => {
			const todayCell = monthGridEl?.querySelector<HTMLElement>('[data-today="true"]');
			if (!monthGridEl || !todayCell) return;
			const gridRect = monthGridEl.getBoundingClientRect();
			const cellRect = todayCell.getBoundingClientRect();
			const cellTop = cellRect.top - gridRect.top + monthGridEl.scrollTop;
			const centeredTop = cellTop - (monthGridEl.clientHeight - cellRect.height) / 2;
			monthGridEl.scrollTo({ top: Math.max(0, centeredTop), behavior: 'smooth' });
		});
	});

	$effect(() => {
		const eventId = activeEvent?.id ?? null;
		if (eventId === lastActiveEventId) return;
		lastActiveEventId = eventId;
		activeCountdownReady = false;
		if (!eventId) return;
		const eventDuration = +new Date(activeEvent!.end_at) - +new Date(activeEvent!.start_at);
		if (eventDuration < 30_000) {
			activeCountdownReady = true;
			return;
		}

		const revealTimer = window.setTimeout(() => {
			activeCountdownReady = true;
		}, 2200);
		return () => window.clearTimeout(revealTimer);
	});

	async function syncWorkerClock() {
		if (clockSyncing) return;
		clockSyncing = true;
		const startedWall = Date.now();
		const startedPerformance = performance.now();
		try {
			const response = await fetch(`/preview/time?nonce=${startedWall}`, { cache: 'no-store' });
			if (!response.ok) throw new Error(`Clock sync failed (${response.status})`);
			const result = (await response.json()) as { workerTime: number; edge: string };
			const roundTrip = performance.now() - startedPerformance;
			const receivedWall = Date.now();
			// Estimate the current Worker time at the midpoint of the network round trip.
			clockOffsetMs = result.workerTime + roundTrip / 2 - receivedWall;
			clockLatencyMs = Math.round(roundTrip);
			workerEdge = result.edge;
			clockSynced = true;
		} catch {
			clockSynced = false;
		} finally {
			clockSyncing = false;
		}
	}

	onMount(() => {
		const tick = setInterval(() => {
			nowMs = Date.now() + clockOffsetMs;
		}, 1_000);
		const timerTick = setInterval(() => {
			timerNowMs = Date.now() + clockOffsetMs;
		}, 50);
		const clockResync = setInterval(() => void syncWorkerClock(), 15_000);
		const onVisibilityChange = () => {
			if (document.visibilityState === 'visible') void syncWorkerClock();
		};
		document.addEventListener('visibilitychange', onVisibilityChange);
		void syncWorkerClock();

		const unsubscribeWS = subscribeWS({
			open: (ws) => {
				live = true;
				previewSubscribed = false;
				ws.send(JSON.stringify({ type: 'preview_subscribe' }));
			},
			close: () => {
				live = false;
				previewSubscribed = false;
			},
			message: (event) => {
				let message: any;
				try {
					message = JSON.parse(event.data);
				} catch {
					return;
				}
				if (message.type === 'preview_subscribed') previewSubscribed = true;
				if (message.type === 'shouldRefetch') invalidateAll();
				if (message.type === 'preview_debug_event') receiveDebugEvent(message);
			}
		});

		return () => {
			clearInterval(tick);
			clearInterval(timerTick);
			clearInterval(clockResync);
			document.removeEventListener('visibilitychange', onVisibilityChange);
			unsubscribeWS();
		};
	});

	$effect(() => {
		if (debugEvent && timerNowMs >= debugEndMs) closeDebugTrigger();
	});

	async function runDebugTrigger() {
		if (!data.debugEnvironment || debugBroadcasting) return;
		debugBroadcasting = true;
		try {
			const response = await fetch('/preview/debug', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: debugTarget.id, taskName: debugTarget.task_name })
			});
			if (!response.ok) throw new Error(await response.text());
			const result = (await response.json()) as { payload?: Parameters<typeof receiveDebugEvent>[0] };
			if (result.payload) receiveDebugEvent(result.payload);
		} catch (error) {
			console.error('Could not broadcast preview debug event', error);
		} finally {
			debugBroadcasting = false;
		}
	}

	function receiveDebugEvent(message: {
		event?: { id?: string; taskName?: string };
		startsAt?: number;
		introEndsAt?: number;
		endsAt?: number;
	}) {
		if (
			!message.startsAt ||
			!message.introEndsAt ||
			!message.endsAt ||
			message.introEndsAt <= message.startsAt ||
			message.endsAt <= message.introEndsAt
		)
			return;
		const existing = events.find((event) => event.id === message.event?.id);
		debugEvent = existing ?? {
			...debugFallbackEvent,
			id: message.event?.id || debugFallbackEvent.id,
			task_name: message.event?.taskName || debugFallbackEvent.task_name
		};
		debugStartsAtMs = message.startsAt;
		debugIntroEndMs = message.introEndsAt;
		debugEndMs = message.endsAt;
	}

	function closeDebugTrigger() {
		debugEvent = null;
		debugStartsAtMs = 0;
		debugIntroEndMs = 0;
		debugEndMs = 0;
	}

	function formatWorkerTime(timestamp: number): string {
		return new Intl.DateTimeFormat('en-GB', {
			timeZone: 'Asia/Bangkok',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			hour12: false
		}).format(timestamp);
	}

	function formatWorkerDate(timestamp: number): string {
		return new Intl.DateTimeFormat('en-GB', {
			timeZone: 'Asia/Bangkok',
			weekday: 'short',
			day: '2-digit',
			month: 'short'
		}).format(timestamp);
	}

	function hex(ev: RichTask): string {
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
		const hours = Math.floor(clamped / 3_600_000);
		const minutes = Math.floor((clamped % 3_600_000) / 60_000);
		const seconds = Math.floor((clamped % 60_000) / 1000);
		const millis = Math.floor(clamped % 1000);
		const clock = `${pad2(minutes)}:${pad2(seconds)}.${`${millis}`.padStart(3, '0')}`;
		return hours ? `${pad2(hours)}:${clock}` : clock;
	}

	function ringOffset(remainingMs: number, totalMs: number): number {
		const circumference = 301.593;
		if (totalMs <= 0) return circumference;
		const ratio = Math.min(Math.max(remainingMs / totalMs, 0), 1);
		return circumference * (1 - ratio);
	}

	function startLabel(ev: RichTask): string {
		const start = new Date(ev.start_at);
		if (ev.all_day) return prettyDate(toKey(start));
		return `${prettyDate(toKey(start))}, ${pad2(start.getHours())}:${pad2(start.getMinutes())}`;
	}

	function eventWindow(event: RichTask): string {
		const start = new Date(event.start_at);
		const end = new Date(event.end_at);
		if (event.all_day) return `${prettyDate(toKey(start))} · All day`;
		return `${prettyDate(toKey(start))} · ${pad2(start.getHours())}:${pad2(start.getMinutes())}–${pad2(end.getHours())}:${pad2(end.getMinutes())}`;
	}

</script>

{#snippet upcomingQueue(queue: RichTask[])}
	<div class="countdown-upcoming">
		<div class="countdown-upcoming-heading">
			<span>Upcoming next</span>
			<small>{queue.length ? `${queue.length} queued` : 'Queue clear'}</small>
		</div>
		{#if queue.length}
			<div class="countdown-upcoming-list">
				{#each queue as queuedEvent (queuedEvent.id)}
					<div class="countdown-upcoming-item">
						<span
							class="countdown-upcoming-color"
							style:background={`rgb(${queuedEvent.color.r}, ${queuedEvent.color.g}, ${queuedEvent.color.b})`}
						></span>
						<strong>{queuedEvent.task_name}</strong>
						<time datetime={new Date(queuedEvent.start_at).toISOString()}
							>{formatTimeUntil(queuedEvent.start_at, nowMs)}</time
						>
					</div>
				{/each}
			</div>
		{:else}
			<div class="countdown-upcoming-empty">No other events are scheduled.</div>
		{/if}
	</div>
{/snippet}

{#snippet eventClockCard(
	event: RichTask,
	intro: boolean,
	remainingMs: number,
	totalMs: number,
	debugLabel: string | null = null,
	queue: RichTask[] = []
)}
	<div class="clock-event-card" class:intro transition:scale={{ start: 0.92, duration: 280 }}>
		{#if debugLabel}<div class="debug-mode">{debugLabel}</div>{/if}
		<div
			class="event-clock"
			class:intro
			style:--ring-offset={ringOffset(remainingMs, totalMs)}
			aria-label={intro ? 'Event start animation' : `${countdownWithMs(remainingMs)} remaining`}
		>
			<svg viewBox="0 0 104 104" aria-hidden="true">
				<circle class="clock-track" cx="52" cy="52" r="48"></circle>
				<circle class="clock-progress" cx="52" cy="52" r="48"></circle>
			</svg>
			<div class="clock-center">
				<div class="countdown-prelude" class:active={intro} aria-hidden="true">
					<span class="prelude-orbit orbit-outer"></span>
					<span class="prelude-orbit orbit-middle"></span>
					<span class="prelude-orbit orbit-inner"></span>
					<span class="prelude-core"><i></i></span>
				</div>
				<div class="event-clock-copy intro-copy" class:active={intro} aria-hidden={!intro}>
					<strong>Get ready</strong>
					<small>Preparing countdown</small>
				</div>
				<div class="event-clock-copy timer-copy" class:active={!intro} aria-hidden={intro}>
					<strong>{countdownWithMs(remainingMs)}</strong>
					<small>Time remaining</small>
				</div>
			</div>
		</div>
		<div class="eyebrow">{intro ? 'Event triggered' : 'Active event'}</div>
		<h3>{event.task_name}</h3>
		<p>{intro ? 'The countdown is about to begin.' : `Started ${startLabel(event)}`}</p>
		{@render upcomingQueue(queue)}
	</div>
{/snippet}

<svelte:head>
	<title>Calendar Preview</title>
</svelte:head>

<div class="wrap">
	<header class="top">
		<span class="logo"><MdiIcon path={mdiCalendarMonth} size={18} /></span>
		<h1>Calendar preview</h1>
		<span class="live" class:on={live}>{live ? 'Live' : 'Offline'}</span>
		<span class="spacer"></span>
		{#if data.debugEnvironment}
			<button
				class="debug-trigger"
				type="button"
				disabled={debugBroadcasting || !previewSubscribed}
				title={previewSubscribed
					? 'Broadcast the event-trigger animation to preview subscribers'
					: 'Waiting for the preview subscription'}
				onclick={runDebugTrigger}
			>
				<MdiIcon path={mdiBugOutline} size={16} />
				<span>{debugBroadcasting ? 'Broadcasting…' : 'Test trigger'}</span>
				<small>{data.debugEnvironment}</small>
			</button>
		{/if}
		<div
			class="worker-clock"
			class:synced={clockSynced}
			title={clockSynced
				? `Synced to Cloudflare ${workerEdge} · ${clockLatencyMs ?? 0}ms round trip`
				: 'Synchronizing with Cloudflare Worker'}
			aria-live="polite"
		>
			<span class="clock-icon"><MdiIcon path={mdiCloudSyncOutline} size={16} /></span>
			<span class="clock-copy">
				<strong>{workerClockTime}</strong>
				<small>{workerClockDate} · GMT+7</small>
			</span>
			<span class="sync-dot" aria-hidden="true"></span>
		</div>
		<button class="nav" aria-label="Previous" onclick={() => (viewDate = addMonths(viewDate, -1))}
			>‹</button
		>
		<button class="today" onclick={() => (viewDate = new Date())}>Today</button>
		<button class="nav" aria-label="Next" onclick={() => (viewDate = addMonths(viewDate, 1))}
			>›</button
		>
	</header>

	{#if nextEvent}
		<section
			class="upcoming-feature"
			style:--event-color={hex(nextEvent)}
			aria-labelledby="next-event-title"
			transition:fly={{ y: -8, duration: 300 }}
		>
			<div class="feature-main">
				<div class="feature-kicker"><span></span> Next upcoming event</div>
				<h2 id="next-event-title">{nextEvent.task_name}</h2>
				<p class:muted={!nextEvent.description}>
					{nextEvent.description || 'No description has been added for this event.'}
				</p>
				<div class="feature-details">
					<span><MdiIcon path={mdiClockOutline} size={16} />{eventWindow(nextEvent)}</span>
					<span>
						<MdiIcon path={mdiAccountMultipleOutline} size={16} />
						{#if (nextEvent.assignees ?? []).length}
							{(nextEvent.assignees ?? [])
								.map((assignee) => assignee.user?.name ?? assignee.user_id)
								.join(', ')}
						{:else}
							Unassigned
						{/if}
					</span>
				</div>
			</div>
			<div class="feature-countdown">
				<span>Begins in</span>
				<strong>{formatTimeUntil(nextEvent.start_at, nowMs)}</strong>
				<small>Worker-synced</small>
			</div>
			{#if nextEventDependencies.length}
				<div
					class="feature-queue"
					aria-label={`All ${nextEventDependencies.length} dependencies for ${nextEvent.task_name}`}
				>
					{#each nextEventDependencies as event (event.id)}
						<div>
							<span class="queue-dot" style:background={hex(event)}></span>
							<span class="queue-copy"
								><strong>{event.task_name}</strong><small>{startLabel(event)}</small></span
							>
						</div>
					{/each}
				</div>
			{/if}
		</section>
	{/if}

	<h2 class="month">{MONTHS[viewDate.getMonth()]} {viewDate.getFullYear()}</h2>

	<div class="cal-layout">
		<section class="month-pane">
			<h3 class="pane-title">Month</h3>
			<div class="grid" bind:this={monthGridEl}>
				<div class="weekday-row">
					{#each WEEKDAYS as d}
						<div class="dow">{d}</div>
					{/each}
				</div>
				<div class="month-weeks">
					{#each monthWeeks as week, weekIndex (week.key)}
						<div
							class="month-week"
							style:grid-template-rows={`30px repeat(${week.laneCount}, 23px) minmax(4px, 1fr)`}
						>
							{#each week.cells as cell, dayIndex (cell.key)}
								<div
									class="cell"
									class:dim={!cell.inMonth}
									data-today={isSameDay(cell.date, new Date())}
									style:grid-column={dayIndex + 1}
									style:animation-delay={`${Math.min(weekIndex * 7 + dayIndex, 13) * 18}ms`}
								>
									<span class="daynum" class:today={isSameDay(cell.date, new Date())}>
										{cell.date.getDate()}
									</span>
								</div>
							{/each}
							{#each week.bars as bar (bar.event.id)}
								<div
									class="event"
									class:continues-before={bar.continuesBefore}
									class:continues-after={bar.continuesAfter}
									style:grid-column={`${bar.startColumn} / span ${bar.span}`}
									style:grid-row={bar.lane + 2}
									style:background={`rgba(${bar.event.color.r}, ${bar.event.color.g}, ${bar.event.color.b}, 0.18)`}
									title={bar.event.task_name}
								>
									{bar.event.task_name}
								</div>
							{/each}
						</div>
					{/each}
				</div>
			</div>
		</section>

		<section class="week-pane">
			<h3 class="pane-title">Week</h3>
			<WeekView {viewDate} {events} />
		</section>
	</div>

	{#if isCountdownState && nextEvent}
		<div class="countdown-overlay" aria-live="polite" transition:fly={{ y: 12, duration: 260 }}>
			<div
				class="countdown-card"
				style:--countdown-accent={hex(nextEvent)}
				transition:scale={{ start: 0.96, duration: 260 }}
			>
				<div class="eyebrow">Starting Soon</div>
				<h3>{nextEvent.task_name}</h3>
				<div class="timer">{countdownWithMs(timerMsUntilNext)}</div>
				<p>Starts in under one minute.</p>
				{@render upcomingQueue(followingEvents)}
			</div>
		</div>
	{/if}

	{#if activeEvent && !isCountdownState}
		<div class="active-overlay" aria-live="polite" transition:fly={{ y: 18, duration: 320 }}>
			{@render eventClockCard(
				activeEvent,
				!activeCountdownReady,
				+new Date(activeEvent.end_at) - timerNowMs,
				+new Date(activeEvent.end_at) - +new Date(activeEvent.start_at),
				null,
				upcomingEvents.slice(0, 3)
			)}
		</div>
	{/if}

	{#if debugEvent && debugPrestartActive}
		<div class="countdown-overlay" aria-live="polite" transition:fly={{ y: 12, duration: 260 }}>
			<div
				class="countdown-card"
				style:--countdown-accent={hex(debugEvent)}
				transition:scale={{ start: 0.96, duration: 260 }}
			>
				<button
					class="debug-close"
					type="button"
					aria-label="Close debug simulation"
					onclick={closeDebugTrigger}>×</button
				>
				<div class="eyebrow">Test · Starting Soon</div>
				<h3>{debugEvent.task_name}</h3>
				<div class="timer">{countdownWithMs(debugStartsAtMs - timerNowMs)}</div>
				<p>Simulated task starts in ten seconds.</p>
			</div>
		</div>
	{:else if debugEvent}
		<div
			class="active-overlay debug-overlay"
			aria-live="polite"
			transition:fly={{ y: 18, duration: 260 }}
		>
			<button
				class="debug-close"
				type="button"
				aria-label="Close debug simulation"
				onclick={closeDebugTrigger}>×</button
			>
			{@render eventClockCard(
				debugEvent,
				debugIntroActive,
				debugEndMs - timerNowMs,
				debugEndMs - debugIntroEndMs,
				`${data.debugEnvironment ?? 'shared'} preview · broadcast to subscribers`,
				upcomingEvents.slice(0, 3)
			)}
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
	.worker-clock {
		display: grid;
		grid-template-columns: 28px auto 6px;
		align-items: center;
		gap: 8px;
		min-width: 162px;
		padding: 5px 11px 5px 7px;
		border: 1px solid #c4c7c5;
		border-radius: 999px;
		background: #fff;
		color: #1f1f1f;
		font-variant-numeric: tabular-nums;
		transition:
			background 160ms ease,
			border-color 160ms ease;
	}
	.worker-clock:hover {
		background: #f8fafd;
	}
	.worker-clock.synced {
		border-color: #a8c7fa;
	}
	.clock-icon {
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		border-radius: 50%;
		color: #0b57d0;
		background: #e8f0fe;
	}
	.clock-copy {
		display: grid;
		line-height: 1.05;
	}
	.clock-copy strong {
		font-family: 'Google Sans', Roboto, 'Segoe UI', sans-serif;
		font-size: 14px;
		font-weight: 500;
		letter-spacing: 0.01em;
	}
	.clock-copy small {
		margin-top: 3px;
		color: #5f6368;
		font-size: 8.5px;
		font-weight: 500;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	.sync-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #b0b7b4;
		animation: sync-pulse 1.2s ease-in-out infinite;
	}
	.worker-clock.synced .clock-icon {
		color: #0b57d0;
	}
	.worker-clock.synced .sync-dot {
		background: #20a052;
		animation: none;
		box-shadow: 0 0 0 3px rgba(32, 160, 82, 0.12);
	}
	.debug-trigger {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 38px;
		padding: 0 8px 0 12px;
		border: 1px solid #f6c453;
		border-radius: 999px;
		background: #fef7e0;
		color: #7a4f01;
		font-size: 11px;
		font-weight: 600;
		cursor: pointer;
		transition:
			background 160ms ease,
			transform 160ms ease;
	}
	.debug-trigger:hover:not(:disabled) {
		background: #fce8b2;
		transform: translateY(-1px);
	}
	.debug-trigger:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.debug-trigger small {
		padding: 3px 6px;
		border-radius: 999px;
		background: #f9ab00;
		color: #3c2a00;
		font-size: 8px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
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
	.upcoming-feature {
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 14px 24px;
		margin-top: 12px;
		padding: 16px 18px 14px 22px;
		border: 1px solid #dfe3e8;
		border-radius: 18px;
		overflow: hidden;
		background:
			linear-gradient(105deg, color-mix(in srgb, var(--event-color) 10%, #fff), #fff 52%), #fff;
		box-shadow: 0 1px 2px rgb(60 64 67 / 10%);
	}
	.upcoming-feature::before {
		position: absolute;
		inset: 0 auto 0 0;
		width: 5px;
		background: var(--event-color);
		content: '';
	}
	.feature-main {
		min-width: 0;
	}
	.feature-kicker {
		display: flex;
		align-items: center;
		gap: 7px;
		color: #5f6368;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	.feature-kicker span {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--event-color);
		box-shadow: 0 0 0 4px color-mix(in srgb, var(--event-color) 15%, transparent);
	}
	.feature-main h2 {
		margin: 5px 0 3px;
		font-size: clamp(19px, 2.3vw, 25px);
		font-weight: 500;
		letter-spacing: -0.015em;
	}
	.feature-main > p {
		max-width: 760px;
		margin: 0;
		overflow: hidden;
		color: #444746;
		font-size: 12.5px;
		line-height: 1.45;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.feature-main > p.muted {
		color: #80868b;
		font-style: italic;
	}
	.feature-details {
		display: flex;
		flex-wrap: wrap;
		gap: 7px 16px;
		margin-top: 10px;
	}
	.feature-details > span {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		color: #444746;
		font-size: 11.5px;
	}
	.feature-countdown {
		display: grid;
		align-content: center;
		min-width: 112px;
		padding-left: 20px;
		border-left: 1px solid #e1e3e1;
		text-align: right;
	}
	.feature-countdown span,
	.feature-countdown small {
		color: #5f6368;
		font-size: 9px;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	.feature-countdown strong {
		margin: 2px 0;
		color: var(--event-color);
		font-size: 24px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.feature-queue {
		display: grid;
		grid-column: 1 / -1;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 8px;
		padding-top: 11px;
		border-top: 1px solid #edf0f2;
	}
	.feature-queue > div {
		display: grid;
		grid-template-columns: 8px minmax(0, 1fr);
		align-items: center;
		gap: 8px;
		min-width: 0;
		padding: 6px 9px;
		border-radius: 9px;
		background: rgb(248 250 253 / 82%);
	}
	.queue-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}
	.queue-copy {
		display: grid;
		min-width: 0;
	}
	.queue-copy strong,
	.queue-copy small {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.queue-copy strong {
		font-size: 10.5px;
		font-weight: 600;
	}
	.queue-copy small {
		color: #5f6368;
		font-size: 9px;
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
		position: relative;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		border-top: 1px solid #e1e3e1;
		background: #fff;
		border-radius: 12px;
	}
	.weekday-row,
	.month-week {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
	}
	.weekday-row {
		position: sticky;
		top: 0;
		z-index: 3;
		flex: 0 0 26px;
		background: #fff;
	}
	.month-weeks {
		flex: 1;
		display: grid;
		grid-template-rows: repeat(6, minmax(96px, auto));
	}
	.month-week {
		position: relative;
		min-height: 96px;
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
		position: relative;
		z-index: 0;
		grid-row: 1 / -1;
		min-width: 0;
		min-height: 96px;
		border-left: 1px solid #e1e3e1;
		border-top: 1px solid #e1e3e1;
		padding: 4px 6px;
		overflow: visible;
		animation: cell-enter 360ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
	}
	.month-week .cell:first-child {
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
	.event {
		z-index: 1;
		align-self: center;
		min-width: 0;
		margin: 1px 6px;
		font-size: 11px;
		font-weight: 500;
		border-radius: 4px;
		padding: 2px 6px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
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
	.countdown-overlay,
	.active-overlay {
		position: fixed;
		inset: 0;
		display: grid;
		place-items: center;
		pointer-events: none;
		z-index: 1000;
	}
	.countdown-overlay {
		background: rgb(240 244 249 / 86%);
		backdrop-filter: blur(5px);
	}
	.countdown-card {
		--countdown-accent: #0b57d0;
		position: relative;
		pointer-events: auto;
		background:
			linear-gradient(112deg, color-mix(in srgb, var(--countdown-accent) 9%, #fff), #fff 58%),
			#fff;
		color: #1f1f1f;
		border: 1px solid #dfe3e8;
		border-radius: 18px;
		padding: 24px 26px 20px;
		text-align: center;
		width: min(460px, calc(100vw - 40px));
		max-height: calc(100vh - 40px);
		overflow-y: auto;
		box-shadow: 0 18px 60px rgb(60 64 67 / 22%);
	}
	.countdown-card::before {
		position: absolute;
		inset: 0 auto 0 0;
		width: 5px;
		background: var(--countdown-accent);
		content: '';
	}
	.countdown-card h3 {
		margin: 6px 0 10px;
		font-size: 28px;
		font-weight: 600;
	}
	.countdown-card .timer {
		color: var(--countdown-accent);
		font-size: 44px;
		font-weight: 700;
		letter-spacing: 1px;
		font-variant-numeric: tabular-nums;
	}
	.countdown-card p {
		margin: 10px 0 0;
		color: #5f6368;
	}
	.countdown-upcoming {
		margin-top: 20px;
		padding-top: 15px;
		border-top: 1px solid #e1e3e1;
		text-align: left;
	}
	.countdown-upcoming-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 9px;
		color: #5f6368;
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.09em;
		text-transform: uppercase;
	}
	.countdown-upcoming-heading small {
		color: #0b57d0;
		font-size: 8px;
	}
	.countdown-upcoming-list {
		display: grid;
		gap: 4px;
	}
	.countdown-upcoming-item {
		display: grid;
		grid-template-columns: 8px minmax(0, 1fr) auto;
		align-items: center;
		gap: 9px;
		min-height: 31px;
		padding: 3px 8px;
		border-radius: 9px;
		background: #f0f4f9;
	}
	.countdown-upcoming-color {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		box-shadow: 0 0 0 3px rgb(11 87 208 / 7%);
	}
	.countdown-upcoming-item strong {
		overflow: hidden;
		font-size: 11px;
		font-weight: 550;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.countdown-upcoming-item time {
		color: #5f6368;
		font-size: 9px;
		font-variant-numeric: tabular-nums;
	}
	.countdown-upcoming-empty {
		padding: 9px 10px;
		border: 1px dashed #d8dde6;
		border-radius: 9px;
		color: #80868b;
		font-size: 10px;
		text-align: center;
	}
	.eyebrow {
		color: #5f6368;
		text-transform: uppercase;
		font-size: 11px;
		letter-spacing: 1px;
		opacity: 0.85;
	}

	.active-overlay {
		z-index: 1010;
		background: rgba(110, 114, 121, 0.94);
		pointer-events: none;
	}
	.debug-overlay {
		z-index: 1020;
		background: rgb(32 33 36 / 82%);
		backdrop-filter: blur(4px);
	}
	.debug-close {
		position: absolute;
		top: 18px;
		right: 20px;
		display: grid;
		place-items: center;
		width: 38px;
		height: 38px;
		border: 1px solid rgb(255 255 255 / 36%);
		border-radius: 50%;
		background: rgb(255 255 255 / 14%);
		color: #fff;
		font-size: 24px;
		line-height: 1;
		cursor: pointer;
		pointer-events: auto;
	}
	.countdown-card .debug-close {
		top: 10px;
		right: 10px;
		width: 32px;
		height: 32px;
		border-color: #d8dde6;
		background: #f0f4f9;
		color: #444746;
		font-size: 20px;
	}
	.debug-mode {
		justify-self: center;
		margin-bottom: 12px;
		padding: 5px 9px;
		border-radius: 999px;
		background: #fef7e0;
		color: #7a4f01;
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	.clock-event-card {
		display: grid;
		justify-items: center;
		width: min(520px, calc(100vw - 40px));
		max-height: calc(100vh - 40px);
		padding: 28px 28px 26px;
		overflow-y: auto;
		border: 1px solid rgb(255 255 255 / 38%);
		border-radius: 24px;
		background: rgb(248 250 253 / 96%);
		color: #202124;
		box-shadow: 0 18px 60px rgb(32 33 36 / 24%);
		pointer-events: auto;
		text-align: center;
	}
	.clock-event-card .countdown-upcoming {
		width: 100%;
		border-top-color: #e1e3e1;
	}
	.clock-event-card .countdown-upcoming-heading {
		color: #5f6368;
	}
	.clock-event-card .countdown-upcoming-item {
		background: #f0f4f9;
	}
	.clock-event-card .countdown-upcoming-item time {
		color: #5f6368;
	}
	.clock-event-card .countdown-upcoming-empty {
		border-color: #d8dde6;
		color: #80868b;
	}
	.event-clock {
		position: relative;
		display: grid;
		place-items: center;
		width: 238px;
		height: 238px;
		margin: 2px 0 20px;
		border-radius: 50%;
		background: radial-gradient(circle, #fff 0 58%, #edf3fc 59% 64%, transparent 65%);
		box-shadow:
			inset 0 0 0 1px #dce5f2,
			0 12px 34px rgb(11 87 208 / 14%);
		transition:
			background 420ms ease,
			box-shadow 420ms ease;
	}
	.event-clock::before {
		position: absolute;
		inset: 14px;
		border-radius: 50%;
		background: repeating-conic-gradient(#7b8798 0 1deg, transparent 1deg 15deg);
		opacity: 0.34;
		-webkit-mask: radial-gradient(transparent 0 71%, #000 72% 100%);
		mask: radial-gradient(transparent 0 71%, #000 72% 100%);
		content: '';
		transition: opacity 360ms ease 80ms;
	}
	.event-clock svg {
		position: absolute;
		z-index: 1;
		inset: 0;
		width: 100%;
		height: 100%;
		padding: 8px;
		transform: rotate(-90deg);
		transition:
			opacity 360ms ease,
			transform 480ms cubic-bezier(0.2, 0.8, 0.2, 1),
			filter 360ms ease;
	}
	.clock-track,
	.clock-progress {
		fill: none;
		stroke-width: 4;
	}
	.clock-track {
		stroke: #d6e2f3;
	}
	.clock-progress {
		stroke: #0b57d0;
		stroke-linecap: round;
		stroke-dasharray: 301.593;
		stroke-dashoffset: var(--ring-offset);
		transition: stroke-dashoffset 80ms linear;
	}
	.event-clock.intro svg {
		opacity: 0;
		filter: blur(3px);
		transform: rotate(-125deg) scale(0.76);
	}
	.event-clock.intro {
		background: radial-gradient(circle, #fff 0 43%, #f2f7ff 44% 60%, transparent 61%);
		animation: prelude-breathe 1.2s ease-in-out infinite alternate;
	}
	.event-clock.intro::before {
		opacity: 0;
	}
	.clock-center {
		position: relative;
		z-index: 2;
		display: grid;
		width: 210px;
		height: 210px;
		place-items: center;
	}
	.event-clock.intro .clock-center {
		box-sizing: border-box;
		padding: 0;
	}
	.event-clock-copy {
		position: absolute;
		inset: 0;
		display: grid;
		place-content: center;
		color: #202124;
		opacity: 0;
		transform: scale(0.88);
		transition:
			opacity 240ms ease,
			transform 420ms cubic-bezier(0.2, 0.8, 0.2, 1);
	}
	.event-clock-copy.active {
		opacity: 1;
		transform: scale(1);
	}
	.intro-copy strong {
		position: absolute;
		bottom: 17px;
		justify-self: center;
	}
	.intro-copy small {
		position: absolute;
		bottom: 2px;
		justify-self: center;
	}
	.clock-center strong {
		font-size: 24px;
		font-weight: 650;
		letter-spacing: 0.025em;
		font-variant-numeric: tabular-nums;
	}
	.clock-center small {
		margin-top: 5px;
		color: #5f6368;
		font-size: 9px;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	.countdown-prelude {
		position: absolute;
		inset: 0;
		width: 210px;
		height: 210px;
		opacity: 0;
		filter: blur(4px);
		transform: rotate(24deg) scale(0.7);
		transition:
			opacity 260ms ease,
			filter 360ms ease,
			transform 480ms cubic-bezier(0.4, 0, 0.2, 1);
	}
	.countdown-prelude.active {
		opacity: 1;
		filter: blur(0);
		transform: rotate(0) scale(1);
	}
	.countdown-prelude:not(.active) .prelude-orbit,
	.countdown-prelude:not(.active) .prelude-core {
		animation-play-state: paused;
	}
	.prelude-orbit,
	.prelude-core {
		position: absolute;
		inset: 50% auto auto 50%;
		border-radius: 50%;
		transform: translate(-50%, -50%);
	}
	.prelude-orbit {
		border: 3px solid transparent;
	}
	.orbit-outer {
		width: 124px;
		height: 124px;
		border-top-color: #0b57d0;
		border-right-color: #a8c7fa;
		box-shadow: 0 0 18px rgb(11 87 208 / 12%);
		animation: prelude-orbit 1.15s cubic-bezier(0.5, 0.1, 0.5, 0.9) infinite;
	}
	.orbit-middle {
		width: 88px;
		height: 88px;
		border-right-color: #7c4dff;
		border-bottom-color: #d7c5ff;
		animation: prelude-orbit-reverse 0.82s cubic-bezier(0.5, 0.1, 0.5, 0.9) infinite;
	}
	.orbit-inner {
		width: 54px;
		height: 54px;
		border-top-color: #00a6a6;
		border-left-color: #9de4df;
		animation: prelude-orbit 0.62s linear infinite;
	}
	.prelude-core {
		display: grid;
		width: 25px;
		height: 25px;
		place-items: center;
		background: #0b57d0;
		box-shadow:
			0 0 0 8px rgb(11 87 208 / 10%),
			0 0 24px rgb(11 87 208 / 38%);
		animation: prelude-core 0.9s ease-in-out infinite alternate;
	}
	.prelude-core i {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #fff;
	}
	.clock-event-card h3 {
		margin: 7px 0 5px;
		font-size: 28px;
		font-weight: 600;
	}
	.clock-event-card p {
		margin: 0;
		color: #5f6368;
		font-size: 12px;
	}
	@keyframes cell-enter {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
	@keyframes sync-pulse {
		50% {
			opacity: 0.35;
			transform: scale(0.75);
		}
	}
	@keyframes prelude-orbit {
		from {
			transform: translate(-50%, -50%) rotate(0deg) scale(0.96);
		}
		to {
			transform: translate(-50%, -50%) rotate(360deg) scale(1.04);
		}
	}
	@keyframes prelude-orbit-reverse {
		from {
			transform: translate(-50%, -50%) rotate(360deg);
		}
		to {
			transform: translate(-50%, -50%) rotate(0deg);
		}
	}
	@keyframes prelude-breathe {
		to {
			box-shadow:
				inset 0 0 0 1px #c8d9f0,
				0 16px 46px rgb(11 87 208 / 24%);
			transform: scale(1.025);
		}
	}
	@keyframes prelude-core {
		to {
			box-shadow:
				0 0 0 13px rgb(11 87 208 / 7%),
				0 0 32px rgb(11 87 208 / 48%);
			transform: translate(-50%, -50%) scale(1.12);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.cell {
			animation: none;
		}
		.wrap {
			transition: none;
		}
		.event-clock.intro,
		.prelude-orbit,
		.prelude-core {
			animation-duration: 1.8s;
		}
	}

	@media (max-width: 1180px) {
		.cal-layout {
			grid-template-columns: 1fr;
		}
	}
	@media (max-width: 720px) {
		.wrap {
			padding: 10px;
		}
		.upcoming-feature {
			grid-template-columns: 1fr;
			padding: 14px 14px 12px 18px;
		}
		.feature-countdown {
			grid-row: 1;
			justify-self: end;
			min-width: auto;
			padding: 0;
			border: 0;
		}
		.feature-main {
			grid-row: 1;
			padding-right: 92px;
		}
		.feature-main > p {
			white-space: normal;
			display: -webkit-box;
			-webkit-box-orient: vertical;
			-webkit-line-clamp: 2;
			line-clamp: 2;
		}
		.feature-queue {
			grid-template-columns: 1fr;
		}
		.clock-icon,
		.clock-copy small {
			display: none;
		}
		.debug-trigger > span,
		.debug-trigger small {
			display: none;
		}
		.debug-trigger {
			width: 38px;
			padding: 0;
			justify-content: center;
		}
		.worker-clock {
			min-width: auto;
			grid-template-columns: auto 6px;
			padding: 7px 10px;
		}
		.clock-copy strong {
			font-size: 13px;
		}
	}
</style>
