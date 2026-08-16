<script lang="ts">
	import SideRail from '$lib/components/SideRail.svelte';
	import MonthView from '$lib/components/MonthView.svelte';
	import PeoplePanel from '$lib/components/PeoplePanel.svelte';
</script>

<svelte:head>
	<title>Co-Calendar</title>
</svelte:head>

<div class="shell">
	<SideRail />
	<MonthView />
	<PeoplePanel />
</div>

<style>
	.shell {
		display: flex;
		height: 100vh;
		overflow: hidden;
		background: #f8fafd;
	}
	:root {
		font-family: 'Google Sans', 'Roboto', 'Segoe UI', Arial, sans-serif;
		--mdc-theme-primary: #0b57d0;
		--mdc-theme-secondary: #0b57d0;
		--mdc-theme-on-primary: #ffffff;
	}

	* { box-sizing: border-box; }
	html, body { margin: 0; height: 100%; background: #f8fafd; color: #1f1f1f; }
	button { font-family: inherit; }
</style>