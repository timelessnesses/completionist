<script lang="ts">
	import '$lib/assets/index.css';
	import { onMount } from 'svelte';
	import { subscribeWS } from '$lib/websocket.svelte';
	import ApiFeedback from '$lib/components/ApiFeedback.svelte';
	import { installApiFeedback } from '$lib/api-feedback';
	import favicon from '$lib/assets/favicon.svg';

	const builtAt = new Date(__BUILD_DATE).toLocaleString('en-TH', {
		dateStyle: 'medium',
		timeStyle: 'short',
		timeZone: 'Asia/Bangkok'
	});
	let { children, data } = $props();

	let server_timing_number: number | null = $state(null);
	let latency: number | null = $state(null);
	onMount(() => {
		const uninstallApiFeedback = installApiFeedback();
		const server_timing = document.querySelector('div[data-server-timing]');
		if (server_timing) {
			// @ts-expect-error - dataset is there
			server_timing_number = parseInt(server_timing.dataset.serverTiming!);
		}
		let ws: WebSocket | undefined;
		let interval: ReturnType<typeof setInterval> | undefined;
		let disposed = false;

		const onMessage = (event: MessageEvent) => {
			let data: any;
			try {
				data = JSON.parse(event.data);
			} catch {
				return;
			}
			if (data.type === 'pong') {
				latency = data.calledArrived - data.calledWhen;
			}
		};

		const unsubscribeWS = subscribeWS({
			open: (connectedWS) => {
				if (!disposed) ws = connectedWS;
			},
			close: () => {
				ws = undefined;
				latency = null;
			},
			message: onMessage
		});
		interval = setInterval(() => {
			if (ws?.readyState === WebSocket.OPEN) {
				ws.send(JSON.stringify({ type: 'ping', calledWhen: Date.now() }));
			}
		}, 1000);

		return () => {
			uninstallApiFeedback();
			disposed = true;
			if (interval) clearInterval(interval);
			unsubscribeWS();
		};
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="bg-background text-foreground grid h-dvh grid-rows-[minmax(0,1fr)_auto]">
	<div class="min-h-0 overflow-hidden">{@render children()}</div>
	<footer class="border-border bg-card border-t">
		<div
			class="text-muted-foreground mx-auto grid w-full max-w-7xl auto-cols-fr grid-flow-col items-center gap-3 px-4 py-1.5 text-[10px] leading-tight sm:px-6 sm:py-2 sm:text-[11px]"
		>
			<p>Built {builtAt}</p>

			<p class="text-center">
				<span>Edge location </span>
				<span class="text-foreground font-medium">{data.edgeLocation}</span>
				<span> | </span>
				<span>CF ray </span>
				<span class="text-foreground font-medium">{data.cfRay ?? 'unknown'}</span>
				<span> | </span>
				<span>Server time </span>
				<span class="text-foreground font-medium">{server_timing_number}ms</span>
				<span> | </span>
				<span>Latency </span>
				<span class="text-foreground font-medium">{latency}ms</span>
			</p>

			<p class="text-right">
				<span>Git commit </span>
				<a
					href={`https://github.com/timelessnesses/completionist/commit/${__GIT_COMMIT}`}
					target="_blank"
					rel="noreferrer"
					class="text-foreground decoration-border hover:text-primary font-medium underline underline-offset-2"
				>
					{__GIT_COMMIT}
				</a>
			</p>
		</div>
	</footer>
</div>

<ApiFeedback />
