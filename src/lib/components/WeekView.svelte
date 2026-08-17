<script lang="ts">
	import { onMount } from 'svelte';
	import {
		WEEKDAYS,
		toKey,
		isSameDay,
		addDays,
		startOfWeek,
		hourLabel,
		parseTimeToMinutes
	} from '$lib/calendar';
	import { type CalendarEvent } from '$lib/mock/data';

	let { viewDate, events }: { viewDate: Date; events: CalendarEvent[] } = $props();

	const HOURS = Array.from({ length: 24 }, (_, h) => h);

	const weekStart = $derived(startOfWeek(viewDate));
	const days = $derived(Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)));
	const eventsByDay = $derived(Map.groupBy(events, (e) => e.date));

	/** Timed events with a vertical position (as a % of the 24-hour column). */
	function timedEvents(key: string) {
		return (eventsByDay.get(key) ?? []).flatMap((ev) => {
			const start = parseTimeToMinutes(ev.time);
			return start === null ? [] : [{ ev, top: (start / 1440) * 100 }];
		});
	}

	/** Untimed events, rendered in the all-day strip like Google Calendar. */
	function allDayEvents(key: string) {
		return (eventsByDay.get(key) ?? []).filter((ev) => parseTimeToMinutes(ev.time) === null);
	}

	let rootEl: HTMLElement;
	let scroller: HTMLDivElement;

	onMount(() => {
		// Open the week around 07:00, like Google Calendar does.
		const hourH = parseFloat(getComputedStyle(rootEl).getPropertyValue('--hour-h')) || 52;
		scroller.scrollTop = 7 * hourH;
	});
</script>

<div class="week" bind:this={rootEl}>
	<div class="scroller" bind:this={scroller}>
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
							<button class="ad-ev" style:background={`rgba(${ev.color.r}, ${ev.color.g}, ${ev.color.b}, 0.15)`} style:color={`rgb(${ev.color.r}, ${ev.color.g}, ${ev.color.b})`} title={ev.title}>
								{ev.title}
							</button>
						{/each}
					</div>
				{/each}
			</div>
		</div>

		<!-- Hourly grid -->
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
							title={t.ev.title}
						>
							<span class="ev-title">{t.ev.title}</span>
							<span class="ev-time">{t.ev.time}</span>
						</button>
					{/each}
				</div>
			{/each}
		</div>
	</div>
</div>

<style>
	.week {
		--hour-h: 52px;
		--gutter-w: 46px;
		flex: 1; min-height: 0;
		display: flex; flex-direction: column;
		border-top: 1px solid #e1e3e1;
		background: #fff;
	}
	.scroller { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
	.sticky { position: sticky; top: 0; z-index: 5; background: #fff; }
	.band {
		display: grid;
		grid-template-columns: var(--gutter-w) repeat(7, 1fr);
	}
	.head-row { border-bottom: 1px solid #e1e3e1; }
	.dhead {
		display: flex; flex-direction: column; align-items: center; gap: 3px;
		padding: 8px 2px 6px;
		border-left: 1px solid #e1e3e1;
	}
	.dow { font-size: 11px; font-weight: 500; color: #444746; }
	.dnum {
		height: 30px; width: 30px;
		display: grid; place-items: center; border-radius: 50%;
		font-size: 15px; color: #1f1f1f;
	}
	.dnum.today { background: #0b57d0; color: #fff; font-weight: 600; }
	.allday-row { min-height: 26px; border-bottom: 1px solid #e1e3e1; }
	.allday-row .gutter { display: flex; justify-content: flex-end; padding: 4px 6px 0 0; }
	.allday-row .gutter span { font-size: 10px; color: #747775; }
	.ad-col {
		display: flex; flex-direction: column; gap: 2px;
		padding: 3px 2px;
		border-left: 1px solid #e1e3e1;
	}
	.ad-ev {
		border: 0; border-radius: 4px; padding: 2px 5px;
		font-size: 10.5px; font-weight: 500; text-align: left; cursor: pointer;
		white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
	}
	.labels .l-row {
		height: var(--hour-h); box-sizing: border-box;
		display: flex; justify-content: flex-end; padding-right: 6px;
	}
	.l-row span { transform: translateY(-50%); font-size: 10.5px; color: #70757a; }
	.col { position: relative; border-left: 1px solid #e1e3e1; }
	.col.todaycol { background: #f4f8ff; }
	.h-row { height: var(--hour-h); box-sizing: border-box; border-top: 1px solid #eceef1; }
	.col .h-row:first-of-type { border-top: 0; }
	.ev {
		position: absolute; left: 2px; right: 2px;
		height: calc(100% / 24 - 3px);
		display: flex; flex-direction: column; gap: 1px;
		border: 0; border-radius: 6px; padding: 3px 5px;
		text-align: left; cursor: pointer; overflow: hidden;
	}
	.ev-title {
		font-size: 11px; font-weight: 600;
		white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
	}
	.ev-time { font-size: 10px; opacity: 0.85; }

	@media (max-width: 860px) {
		.week { --hour-h: 46px; --gutter-w: 34px; }
		.dhead { gap: 2px; padding: 6px 1px 4px; }
		.dow { font-size: 10px; }
		.dnum { height: 26px; width: 26px; font-size: 13px; }
		.l-row span, .allday-row .gutter span { font-size: 9.5px; }
		.ev { left: 1px; right: 1px; padding: 2px 3px; border-radius: 4px; }
		.ev-title { font-size: 9.5px; }
		.ev-time { display: none; }
	}
</style>