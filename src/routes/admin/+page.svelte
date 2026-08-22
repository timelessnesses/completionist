<script lang="ts">
	import { resolve } from '$app/paths';
	import Button from '@smui/button';
</script>

<div class="bg-background flex min-h-dvh flex-col">
	<!-- Header -->
	<header class="border-border bg-card border-b">
		<div class="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
			<div class="flex items-center gap-3">
				<div
					class="bg-primary text-primary-foreground flex h-15 w-15 items-center justify-center rounded-lg"
				>
					<svg
						width="100"
						height="100"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
						><rect x="3" y="4" width="18" height="18" rx="2" /><path
							d="M3 10h18M8 2v4m8-4v4"
						/></svg
					>
				</div>
				<div>
					<h1 class="text-card-foreground text-sm leading-tight font-semibold">Completionist</h1>
					<p class="text-muted-foreground text-xs">Track and clear your weekly obligations</p>
				</div>
				<div>
					<Button
						href={resolve('/admin/users')}
						variant="outlined"
						class="border-border text-muted-foreground hover:bg-muted ml-4 rounded-lg border px-3 py-1.5 text-xs font-medium"
					>
						Go to Users
					</Button>
					<Button
						href={resolve('/admin/obligations')}
						variant="outlined"
						class="border-border text-muted-foreground hover:bg-muted ml-4 rounded-lg border px-3 py-1.5 text-xs font-medium"
					>
						Go to events
					</Button>
					<Button
						href={resolve('/admin/transactions')}
						variant="outlined"
						class="border-border text-muted-foreground hover:bg-muted ml-4 rounded-lg border px-3 py-1.5 text-xs font-medium"
					>
						Go to Transactions
					</Button>
					<Button
						href={resolve('/admin/logs')}
						variant="outlined"
						class="border-border text-muted-foreground hover:bg-muted ml-4 rounded-lg border px-3 py-1.5 text-xs font-medium"
					>
						Go to Logs
					</Button>
				</div>
			</div>
		</div>
	</header>
</div>
