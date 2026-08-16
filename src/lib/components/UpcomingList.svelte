<script lang="ts">
	import { upcoming, eventPalette } from '$lib/mock/data';
	import { prettyDate } from '$lib/calendar';
</script>

<div class="upcoming">
	<div class="upcoming-head">
		<span>UPCOMING EVENTS</span>
		<span class="count">{upcoming.length} total</span>
	</div>

	{#each upcoming as ev (ev.id)}
		{@const c = eventPalette[ev.color]}
		<button class="card">
			<span class="bar" style:background={c.bg}></span>
			<span class="body">
				<span class="title">{ev.title}</span>
				<span class="when">{prettyDate(ev.date)}{ev.time ? `, ${ev.time}` : ''}</span>
			</span>
		</button>
	{/each}
</div>

<style>
	.upcoming { padding: 16px 16px 0; display: flex; flex-direction: column; gap: 10px; }
	.upcoming-head {
		display: flex; justify-content: space-between; align-items: baseline;
		font-size: 11px; font-weight: 600; letter-spacing: 0.4px; color: #444746;
	}
	.count { font-weight: 400; color: #747775; }
	.card {
		display: flex; align-items: stretch; gap: 12px;
		border: 1px solid #e1e3e1; border-radius: 12px;
		background: #fff; padding: 10px 12px; cursor: pointer; text-align: left;
	}
	.card:hover { background: #f8fafd; }
	.bar { width: 4px; border-radius: 2px; }
	.body { display: flex; flex-direction: column; gap: 2px; }
	.title { font-size: 13px; font-weight: 600; color: #1f1f1f; }
	.when { font-size: 12px; color: #444746; }
</style>