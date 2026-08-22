<script lang="ts">
	import { prettyDate, toKey } from '$lib/calendar';
	import type { CalendarEvent } from '$lib/mock/data';

	const { upcoming }: { upcoming: CalendarEvent[] } = $props();

	function timeLabel(d: Date): string {
		return `${d.getHours()}:${`${d.getMinutes()}`.padStart(2, '0')}`;
	}
</script>

<div class="upcoming">
	<div class="upcoming-head">
		<span>UPCOMING EVENTS</span>
		<span class="count">{upcoming.length} total</span>
	</div>

	{#each upcoming as ev (ev.id)}
		{@const start = new Date(ev.start_at)}
		<button class="card">
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
		color: #444746;
	}
	.count {
		font-weight: 400;
		color: #747775;
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
