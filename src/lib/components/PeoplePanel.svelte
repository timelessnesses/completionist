<script lang="ts">
	import Button, { Label } from '@smui/button';
	import List, { Item, Graphic, Text as LText } from '@smui/list';
	import {
		mdiShareVariantOutline,
		mdiCogOutline,
		mdiShieldCrownOutline,
		mdiContentCopy,
		mdiClose,
		mdiCheck,
		mdiLogout,
		mdiWeatherNight,
		mdiWhiteBalanceSunny,
		mdiChevronRight
	} from '@mdi/js';
	import MdiIcon from './MdiIcon.svelte';
	import type { Person } from '$lib/mock/data';
	import { getWS } from '$lib/websocket.svelte';
	import { onMount } from 'svelte';

	let { isOwner = false }: { isOwner?: boolean } = $props();

	let people: Person[] = $state([]);
	let shareOpen = $state(false);
	let settingsOpen = $state(false);
	let copied = $state(false);

	// ---- Theme ----
	type Theme = 'system' | 'light' | 'dark';
	let theme: Theme = $state('system');

	function applyTheme(t: Theme) {
		const root = document.documentElement;
		const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
		const dark = t === 'dark' || (t === 'system' && prefersDark);
		root.classList.toggle('dark', dark);
		const light = document.querySelector<HTMLLinkElement>('link[href="/smui.css"]');
		const darkSheet = document.querySelector<HTMLLinkElement>('link[href="/smui-dark.css"]');
		if (light && darkSheet) {
			light.disabled = false;
			darkSheet.disabled = false;
			light.media = dark ? 'not all' : 'all';
			darkSheet.media = dark ? 'all' : 'not all';
		}
	}

	function setTheme(t: Theme) {
		theme = t;
		try {
			localStorage.setItem('theme', t);
		} catch {
			/* ignore */
		}
		applyTheme(t);
	}

	onMount(() => {
		let saved: Theme = 'system';
		try {
			saved = (localStorage.getItem('theme') as Theme) || 'system';
		} catch {
			/* ignore */
		}
		setTheme(saved);
		const mq = window.matchMedia('(prefers-color-scheme: dark)');
		const onSystem = () => theme === 'system' && applyTheme('system');
		mq.addEventListener('change', onSystem);
		return () => mq.removeEventListener('change', onSystem);
	});

	async function logout() {
		try {
			await fetch('/api/auth/logout', { method: 'POST' });
		} finally {
			window.location.href = '/login';
		}
	}

	const shareUrl = $derived(
		typeof window !== 'undefined' ? `${window.location.origin}/preview` : ''
	);

	function dedupe(list: Person[]): Person[] {
		const seen = new Set<string>();
		return list.filter((p) => {
			if (seen.has(p.id)) return false;
			seen.add(p.id);
			return true;
		});
	}

	function upsertPeople(incoming: Person[]) {
		const next = [...people];
		for (const p of incoming) {
			const i = next.findIndex((x) => x.id === p.id);
			if (i === -1) next.push(p);
			else next[i] = { ...next[i], ...p };
		}
		people = dedupe(next);
	}

	onMount(() => {
		const ws = getWS();
		if (!ws) return;

		const onMessage = (e: MessageEvent) => {
			let data: any;
			try {
				data = JSON.parse(e.data);
			} catch {
				return;
			}
			if (data.type === 'people' && Array.isArray(data.people)) {
				upsertPeople(data.people);
			} else if (data.type === 'user_connected' && data.user_id) {
				upsertPeople([{ id: data.user_id, name: 'Someone', status: 'Active' }]);
			} else if (data.type === 'user_disconnected' && data.user_id) {
				people = people.map((p) => (p.id === data.user_id ? { ...p, status: 'Offline' } : p));
			}
		};

		ws.addEventListener('message', onMessage);

		// Ask the server for the current set of people.
		const requestPeople = () => {
			try {
				ws.send(JSON.stringify({ type: 'online_users' }));
			} catch {
				/* ignore */
			}
		};
		if (ws.readyState === WebSocket.OPEN) requestPeople();
		else ws.addEventListener('open', requestPeople, { once: true });

		return () => ws.removeEventListener('message', onMessage);
	});

	async function copyLink() {
		try {
			await navigator.clipboard.writeText(shareUrl);
			copied = true;
			setTimeout(() => (copied = false), 1800);
		} catch {
			/* ignore */
		}
	}
</script>

<aside class="panel">
	<header class="head">
		<span class="title">PEOPLE ({people.length})</span>
		<span class="actions">
			<Button variant="unelevated" class="share-btn" onclick={() => (shareOpen = true)}>
				<MdiIcon path={mdiShareVariantOutline} size={15} />
				<Label>Share</Label>
			</Button>
			<button
				class="icon-btn"
				title="Settings"
				aria-label="Open settings"
				onclick={() => (settingsOpen = true)}
			>
				<MdiIcon path={mdiCogOutline} size={20} />
			</button>
		</span>
	</header>

	<List dense class="people-list">
		{#each people as p (p.id)}
			<Item nonInteractive>
				<Graphic class="avatar">{p.name.slice(-1)}</Graphic>
				<LText>
					<span class="pname">{p.name}</span>
					<span class="prole">
						{p.owner ? ' · Owner' : ''} ·
						<span class:active={p.status === 'Active'}>{p.status}</span>
					</span>
				</LText>
			</Item>
		{/each}
	</List>
</aside>

{#if shareOpen}
	<button class="scrim" aria-label="Close share" onclick={() => (shareOpen = false)}></button>
	<div class="share-dialog" role="dialog" aria-modal="true" aria-label="Share">
		<header class="share-head">
			<h2>Share this calendar</h2>
			<button class="x" aria-label="Close" onclick={() => (shareOpen = false)}>
				<MdiIcon path={mdiClose} size={18} />
			</button>
		</header>
		<p class="share-desc">Anyone with this link can view a live preview of the calendar.</p>
		<div class="link-row">
			<input
				class="link"
				readonly
				value={shareUrl}
				onclick={(e) => (e.target as HTMLInputElement).select()}
			/>
			<button class="copy" onclick={copyLink}>
				<MdiIcon path={copied ? mdiCheck : mdiContentCopy} size={16} />
				{copied ? 'Copied' : 'Copy'}
			</button>
		</div>
	</div>
{/if}

{#if settingsOpen}
	<button class="scrim" aria-label="Close settings" onclick={() => (settingsOpen = false)}></button>
	<div class="share-dialog" role="dialog" aria-modal="true" aria-label="Settings">
		<header class="share-head">
			<h2>Settings</h2>
			<button class="x" aria-label="Close" onclick={() => (settingsOpen = false)}>
				<MdiIcon path={mdiClose} size={18} />
			</button>
		</header>

		<div class="settings-body">
			<!-- Theme -->
			<div class="setting-row">
				<span class="setting-label">Theme</span>
				<div class="seg">
					<button class:active={theme === 'system'} onclick={() => setTheme('system')}>
						<MdiIcon path={mdiCogOutline} size={16} />
						System
					</button>
					<button class:active={theme === 'light'} onclick={() => setTheme('light')}>
						<MdiIcon path={mdiWhiteBalanceSunny} size={16} />
						Light
					</button>
					<button class:active={theme === 'dark'} onclick={() => setTheme('dark')}>
						<MdiIcon path={mdiWeatherNight} size={16} />
						Dark
					</button>
				</div>
			</div>

			<!-- Admin link (owners only) -->
			{#if isOwner}
				<a class="setting-action" href="/admin/">
					<span class="setting-ic"><MdiIcon path={mdiShieldCrownOutline} size={20} /></span>
					<span class="setting-text">
						<span class="setting-title">Admin dashboard</span>
						<span class="setting-sub">Manage the workspace</span>
					</span>
					<MdiIcon path={mdiChevronRight} size={18} />
				</a>
			{/if}

			<!-- Logout -->
			<button class="setting-action danger" onclick={logout}>
				<span class="setting-ic"><MdiIcon path={mdiLogout} size={20} /></span>
				<span class="setting-text">
					<span class="setting-title">Log out</span>
					<span class="setting-sub">End your session</span>
				</span>
				<MdiIcon path={mdiChevronRight} size={18} />
			</button>
		</div>
	</div>
{/if}

<style>
	.panel {
		width: 300px;
		flex-shrink: 0;
		background: var(--color-background);
		border-left: 1px solid #e1e3e1;
		padding: 12px 16px;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.panel :global(.wbtn) {
		width: 26px;
		height: 26px;
		padding: 4px;
		color: #444746;
	}

	.panel :global(.settings-card) {
		margin-top: 12px;
		padding: 12px 14px;
		border-radius: 12px;
		font-size: 12px;
		color: #444746;
	}
	.panel p :global(.settings-card) {
		margin: 6px 0 0;
		line-height: 1.45;
	}
	.panel strong :global(.settings-card) {
		font-size: 12.5px;
		color: #1f1f1f;
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.title {
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.3px;
		color: var(--color-foreground);
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.actions :global(.share-btn) {
		background: #0b57d0;
		color: #fff;
		border-radius: 999px;
		height: 30px;
		padding: 0 12px;
		text-transform: none;
		font-size: 12.5px;
		display: flex;
		align-items: center;
		gap: 5px;
	}
	.actions .icon-btn {
		width: 32px;
		height: 32px;
		padding: 6px;
		color: var(--color-foreground);
		border: 0;
		border-radius: 50%;
		background: none;
		cursor: pointer;
		display: grid;
		place-items: center;
	}
	.actions .icon-btn:hover {
		background: var(--color-foreground);
		color: var(--color-background);
	}

	/* Settings dialog contents */
	.settings-body {
		display: flex;
		flex-direction: column;
		gap: 14px;
		margin-top: 14px;
	}
	.setting-row {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.setting-label {
		font-size: 12px;
		font-weight: 600;
		color: #444746;
	}
	.seg {
		display: flex;
		border: 1px solid #c4c7c5;
		border-radius: 999px;
		overflow: hidden;
	}
	.seg button {
		flex: 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		border: 0;
		background: none;
		padding: 8px 10px;
		cursor: pointer;
		font-size: 12.5px;
		color: #444746;
	}
	.seg button.active {
		background: #c2e7ff;
		color: #001d35;
		font-weight: 600;
	}
	.seg button + button {
		border-left: 1px solid #c4c7c5;
	}

	.setting-action {
		display: flex;
		align-items: center;
		gap: 12px;
		border: 1px solid #e1e3e1;
		border-radius: 12px;
		background: #fff;
		padding: 10px 12px;
		cursor: pointer;
		text-align: left;
		color: #1f1f1f;
		text-decoration: none;
		font: inherit;
	}
	.setting-action:hover {
		background: #f8fafd;
	}
	.setting-ic {
		width: 36px;
		height: 36px;
		border-radius: 8px;
		flex-shrink: 0;
		background: #f0f4f9;
		color: #444746;
		display: grid;
		place-items: center;
	}
	.setting-text {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
	}
	.setting-title {
		font-size: 13.5px;
		font-weight: 600;
	}
	.setting-sub {
		font-size: 11.5px;
		color: #444746;
	}
	.setting-action.danger .setting-title {
		color: #a50e0e;
	}
	.setting-action.danger .setting-ic {
		background: #fce8e6;
		color: #a50e0e;
	}

	.panel :global(.people-list) {
		background: transparent;
		padding: 0;
	}
	.panel :global(.avatar) {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		background: #e1e3e1;
		color: #444746;
		display: grid;
		place-items: center;
		font-size: 13px;
		font-weight: 600;
		margin-right: 12px;
	}
	.pname {
		display: block;
		font-size: 13.5px;
		font-weight: 600;
		color: #1f1f1f;
	}
	.prole {
		display: block;
		font-size: 11.5px;
		color: #444746;
	}
	.active {
		color: #188038;
		font-weight: 600;
	}

	/* Share dialog */
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 70;
		border: 0;
		padding: 0;
		cursor: default;
		background: rgba(15, 23, 42, 0.35);
	}
	.share-dialog {
		position: fixed;
		z-index: 71;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: min(440px, calc(100vw - 32px));
		background: #fff;
		border-radius: 16px;
		padding: 18px 20px;
		box-shadow: 0 8px 30px rgba(0, 0, 0, 0.25);
	}
	.share-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.share-head h2 {
		margin: 0;
		font-size: 16px;
		font-weight: 500;
		color: #1f1f1f;
	}
	.x {
		display: grid;
		place-items: center;
		width: 30px;
		height: 30px;
		border: 0;
		border-radius: 50%;
		background: none;
		color: #444746;
		cursor: pointer;
	}
	.x:hover {
		background: #f0f4f9;
	}
	.share-desc {
		font-size: 12.5px;
		color: #444746;
		margin: 8px 0 14px;
	}
	.link-row {
		display: flex;
		gap: 8px;
	}
	.link {
		flex: 1;
		min-width: 0;
		font: inherit;
		font-size: 12.5px;
		color: #1f1f1f;
		border: 1px solid #c4c7c5;
		border-radius: 8px;
		padding: 9px 12px;
		background: #f8fafd;
	}
	.copy {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		border: 0;
		border-radius: 999px;
		padding: 0 16px;
		cursor: pointer;
		background: #0b57d0;
		color: #fff;
		font-size: 12.5px;
		font-weight: 600;
		white-space: nowrap;
	}

	/* Mobile bottom-sheet share */
	@media (max-width: 860px) {
		.share-dialog {
			top: auto;
			bottom: 0;
			left: 0;
			transform: none;
			width: 100%;
			border-radius: 24px 24px 0 0;
			padding: 18px 20px calc(18px + env(safe-area-inset-bottom));
		}
	}
</style>
