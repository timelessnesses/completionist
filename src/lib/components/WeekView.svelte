<script lang="ts">
	import { onMount } from 'svelte';
	import { WEEKDAYS, toKey, isSameDay, addDays, startOfWeek, hourLabel } from '$lib/calendar';

	import { type CalendarEvent } from '$lib/mock/data';

	let {
		viewDate,
		events,
		windowHours = 24,
		followCurrentTime = false,
		onSelectEvent
	}: {
		viewDate: Date;
		events: CalendarEvent[];
		windowHours?: number;
		followCurrentTime?: boolean;
		onSelectEvent?: (ev: CalendarEvent) => void;
	} = $props();

	const HOURS = Array.from({ length: 24 }, (_, h) => h);
	const MS_PER_MINUTE = 60_000;
	const MINUTES_PER_DAY = 1_440;

	const weekStart = $derived(startOfWeek(viewDate));
	const days = $derived(Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)));
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

	let nowMs = $state(Date.now());
	let hourPx = $state(52);

	const visibleHours = $derived(Math.min(Math.max(windowHours, 1), 24));
	const useCompactWindow = $derived(followCurrentTime && visibleHours < 24);
	const bodyViewportHeight = $derived(visibleHours * hourPx);
	const centerLineTopPx = $derived(bodyViewportHeight / 2);
	const compactOffsetPx = $derived.by(() => {
		if (!useCompactWindow) return 0;
		const now = new Date(nowMs);
		const minutes =
			now.getHours() * 60 +
			now.getMinutes() +
			now.getSeconds() / 60 +
			now.getMilliseconds() / MS_PER_MINUTE;
		const range = visibleHours * 60;
		const maxStart = MINUTES_PER_DAY - range;
		const startMinutes = Math.min(Math.max(minutes - range / 2, 0), maxStart);
		return -(startMinutes / 60) * hourPx;
	});

	/** Timed events with a vertical position (as a % of the 24-hour column). */
	function timedEvents(key: string) {
		return (eventsByDay.get(key) ?? []).flatMap((ev) => {
			if (ev.all_day) return [];
			const d = new Date(ev.start_at);
			const startMinutes =
				d.getHours() * 60 +
				d.getMinutes() +
				d.getSeconds() / 60 +
				d.getMilliseconds() / MS_PER_MINUTE;
			return [{ ev, top: (startMinutes / MINUTES_PER_DAY) * 100 }];
		});
	}

	/** All-day events, rendered in the all-day strip like Google Calendar. */
	function allDayEvents(key: string) {
		return (eventsByDay.get(key) ?? []).filter((ev) => !!ev.all_day);
	}

	function timeLabel(ev: CalendarEvent): string {
		const d = new Date(ev.start_at);
		return `${d.getHours()}:${`${d.getMinutes()}`.padStart(2, '0')}`;
	}

	let rootEl: HTMLElement;

	onMount(() => {
		hourPx = parseFloat(getComputedStyle(rootEl).getPropertyValue('--hour-h')) || 52;
		if (!followCurrentTime) {
			nowMs = new Date().setHours(7, 0, 0, 0);
		}
		const timer = setInterval(() => {
			nowMs = Date.now();
		}, 50);
		return () => clearInterval(timer);
	});
</script>

<div class="week" bind:this={rootEl}>
	<div class="sticky">
		<!-- Day headers -->
		<div class="band head-row">
			<div class="gutter"></div>
			{#each days as d (toKey(d))}
				<div class="dhead">
					<span class="dow">{WEEKDAYS[d.getDay()]}</span>
					<span class="dnum" class:today={isSameDay(d, new Date())}>{d.getDate()}</span>
				</div>
			{/each}
		</div>

		<!-- All-day strip -->
		<div class="band allday-row">
			<div class="gutter"><span>All day</span></div>
			{#each days as d (toKey(d))}
				<div class="ad-col">
					{#each allDayEvents(toKey(d)) as ev (ev.id)}
						<button
							class="ad-ev"
							style:background={`rgba(${ev.color.r}, ${ev.color.g}, ${ev.color.b}, 0.15)`}
							style:color={`rgb(${ev.color.r}, ${ev.color.g}, ${ev.color.b})`}
							title={ev.task_name}
							onclick={() => onSelectEvent?.(ev)}
						>
							{ev.task_name}
						</button>
					{/each}
				</div>
			{/each}
		</div>
	</div>

	<!-- Hourly grid -->
	<div
		class="body-viewport"
		class:compact={useCompactWindow}
		style={`height: ${useCompactWindow ? bodyViewportHeight : 24 * hourPx}px`}
	>
		{#if useCompactWindow}
			<div class="midline" style={`top: ${centerLineTopPx}px`}></div>
		{/if}
		<div class="body-shift" style:transform={`translateY(${compactOffsetPx}px)`}>
			<div class="band body">
				<div class="gutter labels">
					{#each HOURS as h}
						<div class="l-row"><span>{h === 0 ? '' : hourLabel(h)}</span></div>
					{/each}
				</div>
				{#each days as d (toKey(d))}
					<div class="col" class:todaycol={isSameDay(d, new Date())}>
						{#each HOURS as h}
							<div class="h-row"></div>
						{/each}
						{#each timedEvents(toKey(d)) as t (t.ev.id)}
							<button
								class="ev"
								style:top={`${t.top}%`}
								style:background={`rgba(${t.ev.color.r}, ${t.ev.color.g}, ${t.ev.color.b}, 0.15)`}
								style:color={`rgb(${t.ev.color.r}, ${t.ev.color.g}, ${t.ev.color.b})`}
								title={t.ev.task_name}
								onclick={() => onSelectEvent?.(t.ev)}
							>
								<span class="ev-title">{t.ev.task_name}</span>
								<span class="ev-time">{timeLabel(t.ev)}</span>
							</button>
						{/each}
					</div>
				{/each}
			</div>
		</div>
	</div>
</div>

<style>
	.week {
		--hour-h: 52px;
		--gutter-w: 46px;
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		border-top: 1px solid #e1e3e1;
		background: #fff;
	}
	.sticky {
		position: sticky;
		top: 0;
		z-index: 5;
		background: #fff;
	}
	.band {
		display: grid;
		grid-template-columns: var(--gutter-w) repeat(7, 1fr);
	}
	.head-row {
		border-bottom: 1px solid #e1e3e1;
	}
	.dhead {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 3px;
		padding: 8px 2px 6px;
		border-left: 1px solid #e1e3e1;
	}
	.dow {
		font-size: 11px;
		font-weight: 500;
		color: #444746;
	}
	.dnum {
		height: 30px;
		width: 30px;
		display: grid;
		place-items: center;
		border-radius: 50%;
		font-size: 15px;
		color: #1f1f1f;
	}
	.dnum.today {
		background: #0b57d0;
		color: #fff;
		font-weight: 600;
	}
	.allday-row {
		min-height: 26px;
		border-bottom: 1px solid #e1e3e1;
	}
	.allday-row .gutter {
		display: flex;
		justify-content: flex-end;
		padding: 4px 6px 0 0;
	}
	.allday-row .gutter span {
		font-size: 10px;
		color: #747775;
	}
	.ad-col {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 3px 2px;
		border-left: 1px solid #e1e3e1;
	}
	.ad-ev {
		border: 0;
		border-radius: 4px;
		padding: 2px 5px;
		font-size: 10.5px;
		font-weight: 500;
		text-align: left;
		cursor: pointer;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.labels .l-row {
		height: var(--hour-h);
		box-sizing: border-box;
		display: flex;
		justify-content: flex-end;
		padding-right: 6px;
	}
	.l-row span {
		transform: translateY(-50%);
		font-size: 10.5px;
		color: #70757a;
	}
	.body-viewport {
		position: relative;
		overflow: hidden;
		border-bottom: 1px solid #e1e3e1;
	}
	.body-viewport.compact {
		border-top: 1px solid #e1e3e1;
	}
	.body-shift {
		will-change: transform;
	}
	.midline {
		position: absolute;
		left: var(--gutter-w);
		right: 0;
		height: 0;
		border-top: 2px solid #d93025;
		z-index: 2;
		pointer-events: none;
		opacity: 0.85;
	}
	.col {
		position: relative;
		border-left: 1px solid #e1e3e1;
	}
	.col.todaycol {
		background: #f4f8ff;
	}
	.h-row {
		height: var(--hour-h);
		box-sizing: border-box;
		border-top: 1px solid #eceef1;
	}
	.col .h-row:first-of-type {
		border-top: 0;
	}
	.ev {
		position: absolute;
		left: 2px;
		right: 2px;
		height: calc(100% / 24 - 3px);
		display: flex;
		flex-direction: column;
		gap: 1px;
		border: 0;
		border-radius: 6px;
		padding: 3px 5px;
		text-align: left;
		cursor: pointer;
		overflow: hidden;
	}
	.ev-title {
		font-size: 11px;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.ev-time {
		font-size: 10px;
		opacity: 0.85;
	}

	@media (max-width: 860px) {
		.week {
			--hour-h: 46px;
			--gutter-w: 34px;
		}
		.dhead {
			gap: 2px;
			padding: 6px 1px 4px;
		}
		.dow {
			font-size: 10px;
		}
		.dnum {
			height: 26px;
			width: 26px;
			font-size: 13px;
		}
		.l-row span,
		.allday-row .gutter span {
			font-size: 9.5px;
		}
		.midline {
			border-top-width: 1px;
		}
		.ev {
			left: 1px;
			right: 1px;
			padding: 2px 3px;
			border-radius: 4px;
		}
		.ev-title {
			font-size: 9.5px;
		}
		.ev-time {
			display: none;
		}
	}
</style>
