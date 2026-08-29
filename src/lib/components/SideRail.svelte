<script lang="ts">
	import Button, { Label } from '@smui/button';
	import Chip, { Set, Text } from '@smui/chips';
	import { mdiPlus, mdiCalendarMonth } from '@mdi/js';
	import MdiIcon from './MdiIcon.svelte';
	import MiniMonth from './MiniMonth.svelte';
	import UpcomingList from './UpcomingList.svelte';
	import type { RichTask } from '$lib/features/tasks/types';

	const {
		events,
		upcoming,
		running = [],
		assigned = [],
		late = [],
		currentTime = Date.now(),
		onCreate
	}: {
		events: RichTask[];
		upcoming: RichTask[];
		running?: RichTask[];
		assigned?: RichTask[];
		late?: RichTask[];
		currentTime?: number;
		onCreate?: () => void;
	} = $props();
</script>

<aside class="rail">
	<div class="brand">
		<span class="logo"><MdiIcon path={mdiCalendarMonth} size={18} /></span>
		<span class="app">Completionist</span>
		<Set chips={['English Major']} nonInteractive>
			{#snippet chip(chipKey)}
				<Chip chip={chipKey} class="ws-chip">
					<Text>{chipKey}</Text>
				</Chip>
			{/snippet}
		</Set>
	</div>

	<div class="create">
		<Button variant="raised" class="create-btn" onclick={() => onCreate?.()}>
			<MdiIcon path={mdiPlus} size={18} />
			<Label>Create Event</Label>
		</Button>
	</div>

	<MiniMonth {events} />
	<UpcomingList {upcoming} {running} {assigned} {late} {currentTime} />
</aside>

<style>
	.rail {
		width: 264px;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding: 12px 0;
		overflow-y: auto;
		background: var(--color-background);
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 0 16px;
	}
	.logo {
		width: 32px;
		height: 32px;
		border-radius: 8px;
		background: var(--color-primary);
		color: var(--color-primary-foreground);
		display: grid;
		place-items: center;
	}
	.app {
		font-size: 15px;
		font-weight: 600;
		color: var(--color-foreground);
	}
	.brand :global(.ws-chip) {
		background: var(--color-muted);
		height: 24px;
		border-radius: 8px;
		font-size: 12px;
		color: var(--color-foreground);
	}
	.create {
		padding: 0 16px;
	}
	.create :global(.create-btn) {
		width: 100%;
		border-radius: 12px;
		height: 44px;
		background: var(--color-primary);
		color: var(--color-primary-foreground);
		display: flex;
		align-items: center;
		gap: 8px;
		text-transform: none;
		font-size: 14px;
	}

	/* On phones the floating "+" button replaces this. */
	@media (max-width: 860px) {
		.create {
			display: none;
		}
	}
</style>
