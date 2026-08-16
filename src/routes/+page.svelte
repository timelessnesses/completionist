<script lang="ts">
	import SideRail from '$lib/components/SideRail.svelte';
	import MonthView from '$lib/components/MonthView.svelte';
	import PeoplePanel from '$lib/components/PeoplePanel.svelte';
	import MdiIcon from '$lib/components/MdiIcon.svelte';
	import { mdiPlus, mdiClose } from '@mdi/js';

	let railOpen = $state(false);
	let peopleOpen = $state(false);

	function closeAll() {
		railOpen = false;
		peopleOpen = false;
	}
</script>

<svelte:head>
	<title>Co-Calendar</title>
</svelte:head>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape') closeAll();
	}}
/>

<div class="shell">
	<!-- Off-canvas drawer on mobile, plain flex child on desktop -->
	<div class="dock left" class:open={railOpen}>
		<button class="close" aria-label="Close menu" onclick={closeAll}>
			<MdiIcon path={mdiClose} size={20} />
		</button>
		<SideRail />
	</div>

	<MonthView onMenu={() => (railOpen = true)} onPeople={() => (peopleOpen = true)} />

	<div class="dock right" class:open={peopleOpen}>
		<button class="close" aria-label="Close people panel" onclick={closeAll}>
			<MdiIcon path={mdiClose} size={20} />
		</button>
		<PeoplePanel />
	</div>

	{#if railOpen || peopleOpen}
		<button class="scrim" aria-label="Close panels" onclick={closeAll}></button>
	{/if}

	<button
		class="fab"
		aria-label="Create event"
		onclick={() => alert('TODO: open create-event dialog')}
	>
		<MdiIcon path={mdiPlus} size={26} />
	</button>
</div>

<style>
	.shell {
		display: flex;
		height: 100%;
		min-height: 0;
		overflow: hidden;
		background: #f8fafd;
	}

	/* Global base styles (component-scoped selectors never match html/body). */
	:global(html), :global(body) {
		margin: 0; height: 100%; background: #f8fafd; color: #1f1f1f;
		font-family: 'Google Sans', 'Roboto', 'Segoe UI', Arial, sans-serif;
		--mdc-theme-primary: #0b57d0;
		--mdc-theme-secondary: #0b57d0;
		--mdc-theme-on-primary: #ffffff;
	}
	:global(*), :global(*::before), :global(*::after) { box-sizing: border-box; }
	:global(button) { font-family: inherit; }

	/* Desktop: wrappers vanish so the panels are plain flex children. */
	.dock { display: contents; }
	.close, .scrim, .fab { display: none; }

	/* ---- Mobile (Google Calendar phone style) ---- */
	@media (max-width: 860px) {
		.dock {
			display: block;
			position: fixed;
			top: 0; bottom: 0;
			z-index: 40;
			background: #f8fafd;
			transition: transform 0.24s ease;
		}
		.dock.left { left: 0; transform: translateX(-105%); box-shadow: 2px 0 12px rgba(0, 0, 0, 0.18); }
		.dock.right { right: 0; transform: translateX(105%); box-shadow: -2px 0 12px rgba(0, 0, 0, 0.18); }
		.dock.open { transform: translateX(0); }
		.dock :global(.rail), .dock :global(.panel) { height: 100%; border-left: 0; }

		.close {
			display: grid; place-items: center;
			position: absolute; top: 10px; right: 10px; z-index: 1;
			width: 32px; height: 32px; border-radius: 50%;
			border: 0; background: none; color: #444746; cursor: pointer;
		}
		.close:hover { background: #eef2f7; }

		.scrim {
			display: block;
			position: fixed; inset: 0; z-index: 30;
			border: 0; padding: 0; cursor: default;
			background: rgba(15, 23, 42, 0.35);
		}

		/* Google Calendar style squircle FAB */
		.fab {
			display: grid; place-items: center;
			position: fixed; right: 16px; bottom: 80px; z-index: 20;
			width: 56px; height: 56px; border-radius: 16px;
			border: 0; cursor: pointer;
			background: #c2e7ff; color: #001d35;
			box-shadow: 0 4px 10px rgba(0, 0, 0, 0.22);
		}
		.fab:active { filter: brightness(0.95); }
	}
</style>