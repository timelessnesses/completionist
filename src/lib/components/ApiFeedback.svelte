<script lang="ts">
	import { fly } from 'svelte/transition';
	import { apiPending, apiToasts, dismissApiToast } from '$lib/api-feedback';
</script>

{#if $apiPending > 0}
	<div class="request-progress" role="status" aria-live="polite" aria-label="Loading">
		<span class="spinner"></span>
		<span>{$apiPending > 1 ? `${$apiPending} requests` : 'Loading'}</span>
	</div>
{/if}

<div class="toast-stack" aria-live="polite" aria-atomic="true">
	{#each $apiToasts as toast (toast.id)}
		<button
			class="toast"
			class:error={toast.tone === 'error'}
			type="button"
			onclick={() => dismissApiToast(toast.id)}
			transition:fly={{ y: 14, duration: 220 }}
		>
			<span class="toast-mark">{toast.tone === 'success' ? '✓' : '!'}</span>
			<span>{toast.message}</span>
		</button>
	{/each}
</div>

<style>
	.request-progress {
		position: fixed;
		top: 14px;
		left: 50%;
		z-index: 1000;
		display: flex;
		align-items: center;
		gap: 9px;
		padding: 9px 14px;
		transform: translateX(-50%);
		border: 1px solid color-mix(in oklch, var(--color-border) 78%, transparent);
		border-radius: 999px;
		background: color-mix(in oklch, var(--color-card) 94%, transparent);
		box-shadow: 0 10px 30px rgb(15 23 42 / 16%);
		backdrop-filter: blur(14px);
		font-size: 12px;
		font-weight: 650;
	}
	.spinner {
		width: 15px;
		height: 15px;
		border: 2px solid color-mix(in oklch, var(--color-primary) 22%, transparent);
		border-top-color: var(--color-primary);
		border-radius: 50%;
		animation: spin 700ms linear infinite;
	}
	.toast-stack {
		position: fixed;
		right: 18px;
		bottom: 42px;
		z-index: 1000;
		display: grid;
		gap: 9px;
		width: min(340px, calc(100vw - 36px));
	}
	.toast {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 11px 13px;
		border: 1px solid color-mix(in oklch, #188038 28%, var(--color-border));
		border-radius: 14px;
		background: color-mix(in oklch, var(--color-card) 94%, #e6f4ea 6%);
		color: var(--color-foreground);
		box-shadow: 0 14px 38px rgb(15 23 42 / 18%);
		text-align: left;
		cursor: pointer;
	}
	.toast.error {
		border-color: color-mix(in oklch, #d93025 34%, var(--color-border));
	}
	.toast-mark {
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		flex: 0 0 22px;
		border-radius: 50%;
		background: #188038;
		color: white;
		font-weight: 800;
	}
	.error .toast-mark {
		background: #d93025;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation-duration: 1.4s;
		}
	}
</style>
