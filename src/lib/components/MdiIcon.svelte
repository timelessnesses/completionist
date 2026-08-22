<script lang="ts">
	let { path, size = 20 }: { path: string; size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
	<path d={path} />
</svg>
