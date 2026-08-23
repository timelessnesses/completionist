<script lang="ts">
import { onMount } from 'svelte';
import { WEEKDAYS, toKey, isSameDay, addDays, startOfWeek, hourLabel } from '$lib/calendar';
import MdiIcon from './MdiIcon.svelte';
import { mdiCheckboxMarkedCircleOutline, mdiTriangleOutline } from '@mdi/js';

import type { RichTask } from '$lib/mock/data';

	let {
		viewDate,
		events,
		windowHours = 24,
		followCurrentTime,
		onSelectEvent
	}: {
		viewDate: Date;
		events: RichTask[];
		windowHours?: number;
		followCurrentTime?: boolean;
		onSelectEvent?: (ev: RichTask) => void;
	} = $props();

	let colWidthPx = $state<number | null>(null);
	let measureRowEl: HTMLElement;

	function measureColumns() {
		if (!measureRowEl) return;
		const cols = measureRowEl.querySelectorAll<HTMLElement>('.dhead');
		if (cols.length > 0) {
			colWidthPx = cols[0].getBoundingClientRect().width;
		}
	}

	const HOURS = Array.from({ length: 24 }, (_, h) => h);
	const MS_PER_MINUTE = 60_000;
	const MINUTES_PER_DAY = 1_440;

	const followEnabled = $derived(followCurrentTime ?? true);

	const weekStart = $derived(startOfWeek(viewDate));
	const days = $derived(Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)));
	const eventsByDay = $derived.by(() => {
		const map = new Map<string, RichTask[]>();
		for (const ev of events) {
			if (ev.completed) continue;
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
	const useCompactWindow = $derived(followEnabled && visibleHours < 24);
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
			if (ev.completed) return [];
			if (ev.all_day) return [];
			const d = new Date(ev.start_at);
			const startMinutes =
				d.getHours() * 60 +
				d.getMinutes() +
				d.getSeconds() / 60 +
				d.getMilliseconds() / MS_PER_MINUTE;
			return [{ ev, top: (startMinutes / 60) * hourPx }];
		});
	}

	/** All-day events, rendered in the all-day strip like Google Calendar. */
	function allDayEvents(key: string) {
		return (eventsByDay.get(key) ?? []).filter((ev) => !!ev.all_day && !ev.completed);
	}

	function timeLabel(ev: RichTask): string {
		const d = new Date(ev.start_at);
		return `${d.getHours()}:${`${d.getMinutes()}`.padStart(2, '0')}`;
	}

	function hasDependents(ev: RichTask): boolean {
		return (ev.dependents?.length ?? 0) > 0;
	}

	/** Current-time "now" line vertical position (px) within the 24-hour grid. */
	const nowLineTopPx = $derived.by(() => {
		const now = new Date(nowMs);
		const minutes =
			now.getHours() * 60 +
			now.getMinutes() +
			now.getSeconds() / 60 +
			now.getMilliseconds() / MS_PER_MINUTE;
		return (minutes / MINUTES_PER_DAY) * 24 * hourPx;
	});

	let rootEl: HTMLElement;

	// ---- Auto-follow scroll ----
	/** Track whether the user has manually scrolled away (interrupted the follow). */
	let userInterrupted = $state(false);
	/** Re-arm follow after this much inactivity (ms). */
	const FOLLOW_REARM_MS = 5_000;
	let rearmTimer: ReturnType<typeof setTimeout> | null = null;
	/** Guard so programmatic scrolls don't count as user interruption. */
	let suppressScrollEvent = false;

	/** Find the closest scrollable ancestor of an element. */
	function scrollParentOf(el: HTMLElement | null): HTMLElement | null {
		let node = el?.parentElement ?? null;
		while (node) {
			const style = getComputedStyle(node);
			const oy = style.overflowY;
			if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight) {
				return node;
			}
			node = node.parentElement;
		}
		return null;
	}

	function handleUserScroll() {
		if (suppressScrollEvent) return;
		userInterrupted = true;
		if (rearmTimer) clearTimeout(rearmTimer);
		rearmTimer = setTimeout(() => {
			userInterrupted = false;
		}, FOLLOW_REARM_MS);
	}

	let scroller: HTMLElement | null = null;
	let bodyViewportEl: HTMLElement | null = null;
	/** True when we fall back to scrolling our own viewport (no outer scroller). */
	let selfScroll = $state(false);

	function scrollToLine(behavior: ScrollBehavior = 'auto') {
		if (!followEnabled || userInterrupted || !rootEl || !scroller) return;
		// Position the now-line ~40% from the top of the visible area.
		const target =
			rootEl.offsetTop - scroller.offsetTop + nowLineTopPx - scroller.clientHeight * 0.4;
		const clamped = Math.max(0, Math.min(target, scroller.scrollHeight - scroller.clientHeight));
		suppressScrollEvent = true;
		scroller.scrollTo({ top: clamped, behavior });
		// Release suppression after the (possibly smooth) scroll settles.
		requestAnimationFrame(() => {
			suppressScrollEvent = false;
		});
	}

	onMount(() => {
		hourPx = parseFloat(getComputedStyle(rootEl).getPropertyValue('--hour-h')) || 52;

		// Prefer scrolling a scrollable ancestor (e.g. the main page). If none
		// exists (e.g. the preview page), fall back to scrolling our own body
		// viewport so the week stays usable and follows the time line.
		scroller = scrollParentOf(rootEl);
		if (!scroller && bodyViewportEl) {
			selfScroll = true;
			scroller = bodyViewportEl;
		}
		if (scroller && followEnabled) {
			scroller.addEventListener('scroll', handleUserScroll, { passive: true });
			// Initial snap to the current-time line.
			scrollToLine('auto');
		}

		const timer = setInterval(() => {
			nowMs = Date.now();
		}, 50);

		measureColumns();
		const ro = new ResizeObserver(() => measureColumns());
		ro.observe(measureRowEl);

		return () => {
			clearInterval(timer);
			if (rearmTimer) clearTimeout(rearmTimer);
			scroller?.removeEventListener('scroll', handleUserScroll);
			ro.disconnect();
		};
	});

	// Keep following the line as time advances (unless the user interrupted).
	$effect(() => {
		// Re-run on nowLineTopPx changes.
		void nowLineTopPx;
		if (!followEnabled || userInterrupted) return;
		scrollToLine('auto');
	});
</script>

<div class="week" bind:this={rootEl} style:--col-w={colWidthPx ? `${colWidthPx}px` : null}>
	<div class="sticky">
		<!-- Day headers -->
		<div class="band head-row" bind:this={measureRowEl}>
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
		class:scrollable={selfScroll}
		bind:this={bodyViewportEl}
		style={`height: ${useCompactWindow ? bodyViewportHeight : selfScroll ? '100%' : 24 * hourPx + 'px'}`}
	>
		{#if useCompactWindow}
			<div class="midline" style={`top: ${centerLineTopPx}px`}></div>
		{/if}
		<div
			class="body-shift"
			class:selfscroll={selfScroll}
			style:transform={`translateY(${compactOffsetPx}px)`}
			style:height={selfScroll ? `${24 * hourPx}px` : undefined}
		>
			{#if followEnabled && !useCompactWindow}
				<div class="nowline" style={`top: ${nowLineTopPx}px`}></div>
			{/if}
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
								style:top={`${t.top}px`}
								style:background={`rgba(${t.ev.color.r}, ${t.ev.color.g}, ${t.ev.color.b}, 1)`}
								style:color={`rgb(${t.ev.color.r}, ${t.ev.color.g}, ${t.ev.color.b})`}
								title={t.ev.task_name}
								onclick={() => onSelectEvent?.(t.ev)}
							>
								<span class="ev-title">{t.ev.task_name}</span>
								<span class="ev-indicators">
									{#if t.ev.completed}
										<span class="event-status done" aria-hidden="true">
											<MdiIcon path={mdiCheckboxMarkedCircleOutline} size={14} />
										</span>
									{:else if hasDependents(t.ev)}
										<span class="event-status blocked" aria-hidden="true">
											<MdiIcon path={mdiTriangleOutline} size={14} />
										</span>
									{/if}
									<span class="ev-time">{timeLabel(t.ev)}</span>
								</span>
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
		min-width: 0;
		display: flex;
		flex-direction: column;
		border-top: 1px solid #e1e3e1;
		background: var(--color-background);
	}
	.sticky {
		position: sticky;
		top: 0;
		z-index: 5;
		background: var(--color-background);
		scrollbar-gutter: stable;
	}
	.band {
		display: grid;
		grid-template-columns: var(--gutter-w) repeat(7, var(--col-w, 1fr));
		width: 100%;
		box-sizing: border-box;
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
		color: var(--color-foreground);
	}
	.dnum {
		height: 30px;
		width: 30px;
		flex-shrink: 0;
		box-sizing: border-box;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		font-size: 15px;
		color: var(--color-foreground);
		aspect-ratio: 1 / 1;
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
		color: var(--color-foreground);
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
		color: var(--color-foreground);
	}
	.body-viewport {
		position: relative;
		overflow: hidden;
		border-bottom: 1px solid #e1e3e1;
	}
	.body-viewport.scrollable {
		overflow-y: auto;
		overscroll-behavior: contain;
		scrollbar-gutter: stable;
	}
	.body-viewport.compact {
		border-top: 1px solid #e1e3e1;
	}
	.body-shift {
		will-change: transform;
	}
	.body-shift.selfscroll {
		position: relative;
	}
	.body-shift.selfscroll .body {
		height: 100%;
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
	.nowline {
		position: absolute;
		left: var(--gutter-w);
		right: 0;
		height: 0;
		border-top: 2px solid #d93025;
		z-index: 3;
		pointer-events: none;
		opacity: 0.9;
	}
	.nowline::before {
		content: '';
		position: absolute;
		left: -5px;
		top: -5px;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: #d93025;
	}
	.col {
		position: relative;
		border-left: 1px solid #e1e3e1;
	}
	.col.todaycol {
		background: var(--color-muted);
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
		height: calc(var(--hour-h) + 1px);
		display: flex;
		align-items: center;
		gap: 8px;
		border: 0;
		border-radius: 6px;
		padding: 3px 5px;
		text-align: left;
		cursor: pointer;
		overflow: hidden;
	}
	.ev-title {
		flex: 1;
		min-width: 0;
		font-size: 11px;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--color-foreground);
	}
	.ev-indicators {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		flex-shrink: 0;
	}
	.ev-time {
		font-size: 10px;
		opacity: 0.85;
		color: var(--color-foreground);
	}
	.event-status.done {
		color: #188038;
	}
	.event-status.blocked {
		color: #d93025;
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
			gap: 4px;
		}
		.ev-title {
			font-size: 9.5px;
		}
		.ev-indicators {
			gap: 4px;
		}
		.ev-time {
			display: none;
		}
	}
</style>
