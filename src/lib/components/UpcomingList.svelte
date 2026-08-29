<script lang="ts">
	import { prettyDate, toDateKey as toKey } from '$lib/features/calendar/date';
	import type { RichTask } from '$lib/features/tasks/types';
	import MdiIcon from './MdiIcon.svelte';
	import { mdiAccountCheckOutline, mdiPlayCircleOutline } from '@mdi/js';

	const {
		upcoming,
		running = [],
		assigned = [],
		late = [],
		currentTime = Date.now()
	}: {
		upcoming: RichTask[];
		running?: RichTask[];
		assigned?: RichTask[];
		late?: RichTask[];
		currentTime?: number;
	} = $props();

	function timeLabel(d: Date): string {
		return `${d.getHours()}:${`${d.getMinutes()}`.padStart(2, '0')}`;
	}

	function timeRemaining(end: Date): string {
		const minutes = Math.max(1, Math.ceil((end.getTime() - currentTime) / 60_000));
		if (minutes < 60) return `${minutes}m left`;
		const hours = Math.floor(minutes / 60);
		const remainder = minutes % 60;
		if (hours < 24) return `${hours}h${remainder ? ` ${remainder}m` : ''} left`;
		return `${Math.ceil(hours / 24)}d left`;
	}
</script>

<div class="upcoming">
	{#if running.length}
		<div class="upcoming-head running-head">
			<span class="section-label"
				><MdiIcon path={mdiPlayCircleOutline} size={15} /> RUNNING NOW</span
			>
			<span class="count">{running.length}</span>
		</div>
		{#each running.slice(0, 5) as ev, index (ev.id)}
			{@const end = new Date(ev.end_at)}
			<button
				class="card running-card"
				style:--item-index={index}
				aria-label={`Running task: ${ev.task_name}`}
			>
				<span class="bar" style:background={`rgb(${ev.color.r}, ${ev.color.g}, ${ev.color.b})`}
				></span>
				<span class="body">
					<span class="title-row">
						<span class="title">{ev.task_name}</span>
						<span class="live-dot" aria-hidden="true"></span>
					</span>
					<span class="when running-time">{timeRemaining(end)} · ends {timeLabel(end)}</span>
				</span>
			</button>
		{/each}
	{/if}

	{#if assigned.length}
		<div class="upcoming-head assigned-head">
			<span class="section-label"
				><MdiIcon path={mdiAccountCheckOutline} size={15} /> ASSIGNED TO YOU</span
			>
			<span class="count">{assigned.length}</span>
		</div>
		{#each assigned.slice(0, 5) as ev, index (ev.id)}
			{@const start = new Date(ev.start_at)}
			{@const hasStarted = start.getTime() <= currentTime}
			<button
				class="card assigned-card"
				style:--item-index={index}
				aria-label={`Assigned task: ${ev.task_name}`}
			>
				<span class="bar" style:background={`rgb(${ev.color.r}, ${ev.color.g}, ${ev.color.b})`}
				></span>
				<span class="body">
					<span class="title">{ev.task_name}</span>
					<span class="when">
						{hasStarted
							? 'In progress'
							: `${prettyDate(toKey(start))}${ev.all_day ? '' : `, ${timeLabel(start)}`}`}
					</span>
				</span>
			</button>
		{/each}
	{/if}

	{#if late.length}
		<div class="upcoming-head late-head">
			<span>LATE / UNCOMPLETED</span>
			<span class="count">{late.length}</span>
		</div>
		{#each late.slice(0, 5) as ev, index (ev.id)}
			{@const due = new Date(ev.end_at)}
			<button class="card late-card" style:--item-index={index}>
				<span class="bar"></span>
				<span class="body">
					<span class="title">{ev.task_name}</span>
					<span class="when"
						>Due {prettyDate(toKey(due))}{ev.all_day ? '' : `, ${timeLabel(due)}`}</span
					>
				</span>
			</button>
		{/each}
	{/if}

	<div class="upcoming-head">
		<span>UPCOMING EVENTS</span>
		<span class="count">{upcoming.length} total</span>
	</div>

	{#each upcoming as ev, index (ev.id)}
		{@const start = new Date(ev.start_at)}
		<button class="card" style:--item-index={index}>
			<span class="bar" style:background={`rgba(${ev.color.r}, ${ev.color.g}, ${ev.color.b}, 0.15)`}
			></span>
			<span class="body">
				<span class="title">{ev.task_name}</span>
				<span class="when">
					{prettyDate(toKey(start))}{ev.all_day ? '' : `, ${timeLabel(start)}`}
				</span>
			</span>
		</button>
	{/each}
</div>

<style>
	.upcoming {
		padding: 16px 16px 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.upcoming-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.4px;
		/* color: #444746; */
	}
	.section-label {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}
	.running-head {
		color: #137333;
	}
	.assigned-head {
		color: #0b57d0;
		margin-top: 2px;
	}
	.count {
		font-weight: 400;
		/* color: #747775; */
	}
	.card {
		display: flex;
		align-items: stretch;
		gap: 12px;
		border: 1px solid #e1e3e1;
		border-radius: 12px;
		background: #fff;
		padding: 10px 12px;
		cursor: pointer;
		text-align: left;
		animation: list-rise 320ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
		animation-delay: calc(var(--item-index) * 34ms);
	}
	.late-head {
		color: #b3261e;
		margin-top: 2px;
	}
	.late-card {
		border-color: color-mix(in srgb, #d93025 28%, #e1e3e1);
	}
	.late-card .bar {
		background: #d93025;
	}
	.late-card .when {
		color: #b3261e;
	}
	.running-card {
		border-color: color-mix(in srgb, #137333 28%, #e1e3e1);
		background: color-mix(in srgb, #e6f4ea 42%, #fff);
	}
	.assigned-card {
		border-color: color-mix(in srgb, #0b57d0 22%, #e1e3e1);
	}
	.title-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}
	.live-dot {
		width: 7px;
		height: 7px;
		flex: 0 0 auto;
		border-radius: 50%;
		background: #1e8e3e;
		box-shadow: 0 0 0 0 rgba(30, 142, 62, 0.35);
		animation: live-pulse 1.8s ease-out infinite;
	}
	.running-time {
		color: #137333;
		font-weight: 500;
	}
	@keyframes live-pulse {
		70% {
			box-shadow: 0 0 0 6px rgba(30, 142, 62, 0);
		}
		100% {
			box-shadow: 0 0 0 0 rgba(30, 142, 62, 0);
		}
	}
	@keyframes list-rise {
		from {
			opacity: 0;
			transform: translateY(7px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.card,
		.live-dot {
			animation: none;
		}
	}
	.card:hover {
		background: #f8fafd;
	}
	.bar {
		width: 4px;
		border-radius: 2px;
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		flex: 1;
	}
	.title {
		font-size: 13px;
		font-weight: 600;
		color: #1f1f1f;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.when {
		font-size: 12px;
		color: #444746;
	}
</style>
