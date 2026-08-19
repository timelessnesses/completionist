<script lang="ts">
	import '$lib/assets/index.css';
	import { onMount } from 'svelte';
	import { connectWS, getWS } from '$lib/websocket.svelte.js';

	const builtAt = new Date(__BUILD_DATE).toLocaleString('en-TH', {
		dateStyle: 'medium',
		timeStyle: 'short',
		timeZone: 'Asia/Bangkok'
	});
	let { children, data } = $props();

	let server_timing_number: number | null = $state(null);
	let latency: number | null = $state(null);
	onMount(() => {
		const server_timing = document.querySelector("div[data-server-timing]");
		if (server_timing) {
			// @ts-expect-error - dataset is there
			server_timing_number = parseInt(server_timing.dataset.serverTiming!);
		}
		connectWS();
		setInterval(() => {
			getWS().send(JSON.stringify({ type: 'ping' , calledWhen: Date.now() }));
		}, 1000)

		getWS().addEventListener('message', event => {
			const data = JSON.parse(event.data);
			if (data.type === 'pong') {
				latency = data.calledArrived - data.calledWhen;
			}
		});
	})

	
</script>

<div class="grid h-dvh grid-rows-[minmax(0,1fr)_auto] bg-background text-foreground">
	<div class="min-h-0 overflow-hidden">{@render children()}</div>
	<footer class="border-t border-border bg-card">
		<div
			class="mx-auto grid w-full max-w-7xl grid-flow-col auto-cols-fr items-center gap-3 px-4 py-1.5 text-[10px] leading-tight text-muted-foreground sm:px-6 sm:py-2 sm:text-[11px]"
		>
			<p>Built {builtAt}</p>

			<p class="text-center">
				<span>Edge location </span>
				<span class="font-medium text-foreground">{data.edgeLocation}</span>
				<span> | </span>
				<span>CF ray </span>
				<span class="font-medium text-foreground">{data.cfRay ?? 'unknown'}</span>
				<span> | </span>
				<span>Server time </span>
				<span class="font-medium text-foreground">{server_timing_number}ms</span>
				<span> | </span>
				<span>Latency </span>
				<span class="font-medium text-foreground">{latency}ms</span>
			</p>

			<p class="text-right">
				<span>Git commit </span>
				<a
					href={`https://github.com/timelessnesses/completionist/commit/${__GIT_COMMIT}`}
					target="_blank"
					rel="noreferrer"
					class="font-medium text-foreground underline decoration-border underline-offset-2 hover:text-primary"
				>
					{__GIT_COMMIT}
				</a>
			</p>
		</div>
	</footer>
</div>