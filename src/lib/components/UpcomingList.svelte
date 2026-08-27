<script lang="ts">
	import { prettyDate, toDateKey as toKey } from '$lib/features/calendar/date';
	import type { RichTask } from '$lib/features/tasks/types';

	const { upcoming, late = [] }: { upcoming: RichTask[]; late?: RichTask[] } = $props();

	function timeLabel(d: Date): string {
		return `${d.getHours()}:${`${d.getMinutes()}`.padStart(2, '0')}`;
	}
</script>

<div class="upcoming">
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
		.card {
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
	}
	.title {
		font-size: 13px;
		font-weight: 600;
		color: #1f1f1f;
	}
	.when {
		font-size: 12px;
		color: #444746;
	}
</style>
