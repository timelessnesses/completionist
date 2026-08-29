<script lang="ts">
	import Button, { Label } from '@smui/button';
	import { env } from '$env/dynamic/public';
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
		mdiChevronRight,
		mdiSend,
		mdiPaperclip,
		mdiDownloadOutline,
		mdiMessageTextOutline,
		mdiAlarm
	} from '@mdi/js';
	import MdiIcon from './MdiIcon.svelte';
	import type { Person } from '$lib/features/tasks/types';
	import { subscribeWS } from '$lib/websocket.svelte';
	import { onMount } from 'svelte';
	import { Capacitor, registerPlugin } from '@capacitor/core';
	import { LocalNotifications } from '@capacitor/local-notifications';
	import {
		registerServiceWorker,
		requestForNotificationPermission,
		unregisterPushNotifications,
		unregisterServiceWorker
	} from '$lib/notificationStuff';
	import { notificationPath } from '$lib/notification-links';
	import favicon from '$lib/assets/favicon.svg';
	import { setIcon } from '$lib/nativePlugin';
	import { openNativeAlarmSettings, openNativeUnusedAppSettings } from '$lib/task-alarms';

	let {
		isOwner = false,
		viewerId = null,
		openUserId = null,
		openMessageId = null
	}: {
		isOwner?: boolean;
		viewerId?: string | null;
		openUserId?: string | null;
		openMessageId?: string | null;
	} = $props();

	type ChatAttachment = {
		id?: string;
		file_name: string;
		file_url: string;
		file_key: string;
		content_type?: string | null;
		size?: number | null;
		created_at?: number | string | Date;
	};

	type DirectMessage = {
		id: string;
		from_user_id: string;
		to_user_id: string;
		message: string | null;
		created_at: number | string | Date;
		from_user?: { id: string; name: string; profile_picture_url?: string | null };
		to_user?: { id: string; name: string; profile_picture_url?: string | null };
		attachments: ChatAttachment[];
	};

	let people: Person[] = $state([]);
	let shareOpen = $state(false);
	let settingsOpen = $state(false);
	let copied = $state(false);
	let chatOpen = $state(false);
	let selectedPerson = $state<Person | null>(null);
	let chatMessages = $state<Record<string, DirectMessage[]>>({});
	let unreadByUser = $state<Record<string, number>>({});
	let chatDraft = $state('');
	let chatFiles = $state<File[]>([]);
	let chatBusy = $state(false);
	let chatLoading = $state(false);
	let chatError = $state('');
	let chatLoaded = $state<Record<string, boolean>>({});
	let openedNotificationKey = '';
	const activeMessages = $derived(selectedPerson ? (chatMessages[selectedPerson.id] ?? []) : []);

	// ---- Theme ----
	type Theme = 'system' | 'light' | 'dark';
	let theme: Theme = $state('system');

	function isDarkTheme(t: Theme) {
		const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
		return t === 'dark' || (t === 'system' && prefersDark);
	}

	function applyTheme(t: Theme) {
		const root = document.documentElement;
		const dark = isDarkTheme(t);
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

	function applyNativeIcon(t: Theme) {
		void setIcon(isDarkTheme(t) ? 'IconDark' : 'IconLight').catch((error) => {
			console.error('Failed to update the native app icon:', error);
		});
	}

	function setTheme(t: Theme) {
		theme = t;
		try {
			localStorage.setItem('theme', t);
		} catch {
			/* ignore */
		}
		applyTheme(t);
		applyNativeIcon(t);
	}

	onMount(() => {
		let saved: Theme = 'system';
		try {
			saved = (localStorage.getItem('theme') as Theme) || 'system';
		} catch {
			/* ignore */
		}
		theme = saved;
		applyTheme(saved);
		const mq = window.matchMedia('(prefers-color-scheme: dark)');
		const onSystem = () => {
			if (theme !== 'system') return;
			applyTheme('system');
			applyNativeIcon('system');
		};
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

	function messagePeerId(message: DirectMessage): string | null {
		if (!viewerId) return null;
		if (message.from_user_id === viewerId) return message.to_user_id;
		if (message.to_user_id === viewerId) return message.from_user_id;
		return null;
	}

	function upsertMessage(message: DirectMessage) {
		const peerId = messagePeerId(message);
		if (!peerId) return;
		const existing = chatMessages[peerId] ?? [];
		const next = existing.some((item) => item.id === message.id)
			? existing.map((item) => (item.id === message.id ? message : item))
			: [...existing, message];
		chatMessages = {
			...chatMessages,
			[peerId]: next.sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at))
		};
		if (message.from_user_id !== viewerId && (!chatOpen || selectedPerson?.id !== peerId)) {
			unreadByUser = { ...unreadByUser, [peerId]: (unreadByUser[peerId] ?? 0) + 1 };
		}
	}

	async function openChat(person: Person) {
		if (person.id === viewerId) return;
		selectedPerson = person;
		chatOpen = true;
		unreadByUser = { ...unreadByUser, [person.id]: 0 };
		if (chatLoaded[person.id]) return;

		chatLoading = true;
		chatError = '';
		try {
			const res = await fetch(`/api/direct-messages?user_id=${encodeURIComponent(person.id)}`);
			if (!res.ok) {
				const text = await res.text().catch(() => '');
				throw new Error(text || `Request failed (${res.status})`);
			}
			const messages = (await res.json()) as DirectMessage[];
			chatMessages = { ...chatMessages, [person.id]: messages };
			chatLoaded = { ...chatLoaded, [person.id]: true };
		} catch (error) {
			chatError = error instanceof Error ? error.message : 'Failed to load messages.';
		} finally {
			chatLoading = false;
		}
	}

	$effect(() => {
		const userId = openUserId?.trim();
		if (!userId) return;
		const key = `${userId}:${openMessageId ?? ''}`;
		const person = people.find((candidate) => candidate.id === userId);
		if (!person || openedNotificationKey === key) return;
		openedNotificationKey = key;
		void openChat(person);
	});

	function closeChat() {
		chatOpen = false;
		selectedPerson = null;
		chatDraft = '';
		chatFiles = [];
		chatError = '';
	}

	function onPickFiles(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		chatFiles = [...chatFiles, ...Array.from(input.files ?? [])].slice(0, 6);
		input.value = '';
	}

	function removePickedFile(index: number) {
		chatFiles = chatFiles.filter((_, i) => i !== index);
	}

	async function uploadChatFile(file: File): Promise<ChatAttachment> {
		const key = `direct-messages/${viewerId ?? 'anonymous'}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
		const presignRes = await fetch('/api/files', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				key,
				contentType: file.type || 'application/octet-stream'
			})
		});
		if (!presignRes.ok) {
			const text = await presignRes.text().catch(() => '');
			throw new Error(text || `Could not prepare upload (${presignRes.status})`);
		}
		const presign = (await presignRes.json()) as { url: string };
		const uploadRes = await fetch(presign.url, {
			method: 'PUT',
			headers: { 'Content-Type': file.type || 'application/octet-stream' },
			body: file
		});
		if (!uploadRes.ok) {
			throw new Error(`Upload failed (${uploadRes.status})`);
		}
		return {
			file_name: file.name,
			file_key: key,
			file_url: `/api/files?key=${encodeURIComponent(key)}`,
			content_type: file.type || null,
			size: file.size
		};
	}

	async function sendChatMessage() {
		if (!selectedPerson || chatBusy) return;
		const text = chatDraft.trim();
		if (!text && chatFiles.length === 0) return;

		chatBusy = true;
		chatError = '';
		try {
			const attachments = [];
			for (const file of chatFiles) {
				attachments.push(await uploadChatFile(file));
			}
			const res = await fetch('/api/direct-messages', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					to_user_id: selectedPerson.id,
					message: text || null,
					attachments
				})
			});
			if (!res.ok) {
				const responseText = await res.text().catch(() => '');
				throw new Error(responseText || `Request failed (${res.status})`);
			}
			const saved = (await res.json()) as DirectMessage;
			upsertMessage(saved);
			chatDraft = '';
			chatFiles = [];
		} catch (error) {
			chatError = error instanceof Error ? error.message : 'Failed to send message.';
		} finally {
			chatBusy = false;
		}
	}

	async function openAttachment(attachment: ChatAttachment) {
		try {
			const key = attachment.file_key || attachment.file_url.split('key=')[1] || '';
			const res = await fetch(`/api/files?key=${encodeURIComponent(decodeURIComponent(key))}`);
			if (!res.ok) return;
			const body = (await res.json()) as { url?: string };
			if (body.url) window.open(body.url, '_blank', 'noreferrer');
		} catch {
			/* ignore */
		}
	}

	function safeFileName(name: string) {
		return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 96) || 'attachment';
	}

	function prettyBytes(size?: number | null) {
		if (!size) return '';
		if (size < 1024) return `${size} B`;
		if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
		return `${(size / 1024 / 1024).toFixed(1)} MB`;
	}

	async function showIncomingMessageNotification(message: DirectMessage) {
		if (message.from_user_id === viewerId) return;
		const sender =
			message.from_user?.name ??
			people.find((p) => p.id === message.from_user_id)?.name ??
			'Someone';
		const body =
			message.message?.trim() ||
			(message.attachments.length ? 'Sent you an attachment' : 'New direct message');
		if (Capacitor.isNativePlatform()) {
			const permission = await LocalNotifications.checkPermissions();
			if (permission.display !== 'granted') return;
			await LocalNotifications.schedule({
				notifications: [
					{
						id: Math.abs(hashNotificationId(message.id)),
						title: `New message from ${sender}`,
						body,
						schedule: { at: new Date(Date.now() + 100) },
						extra: {
							type: 'direct_message',
							message_id: message.id,
							from_user_id: message.from_user_id
						}
					}
				]
			});
			return;
		}
		if ('Notification' in window && Notification.permission === 'granted') {
			const notification = new Notification(`New message from ${sender}`, {
				body,
				tag: `direct-message-${message.id}`,
				icon: message.from_user?.profile_picture_url ?? favicon
			});
			notification.onclick = () => {
				notification.close();
				window.focus();
				window.location.assign(
					notificationPath({
						type: 'direct_message',
						message_id: message.id,
						from_user_id: message.from_user_id
					})
				);
			};
		}
	}

	function hashNotificationId(value: string): number {
		let hash = 0;
		for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) | 0;
		return hash || 1;
	}

	onMount(() => {
		let disposed = false;

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
			} else if (data.type === 'direct_message' && data.message) {
				const message = data.message as DirectMessage;
				upsertMessage(message);
				void showIncomingMessageNotification(message);
			}
		};

		// Ask the server for the current set of people.
		const requestPeople = (ws: WebSocket) => {
			try {
				ws.send(JSON.stringify({ type: 'online_users' }));
			} catch {
				/* ignore */
			}
		};
		const unsubscribeWS = subscribeWS({
			open: (ws) => {
				if (!disposed) requestPeople(ws);
			},
			message: onMessage
		});

		return () => {
			disposed = true;
			unsubscribeWS();
		};
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

	async function notificationPermission(): Promise<boolean> {
		if (Capacitor.isNativePlatform()) {
			const permission = await LocalNotifications.checkPermissions();
			return permission.display === 'granted';
		} else {
			return Notification.permission === 'granted';
		}
	}

	let notificationEnabled = $state(false);

	onMount(() => {
		setInterval(async () => {
			notificationEnabled = await notificationPermission();
		}, 1000);
	});

	function isNativePlatform(): boolean {
		return Capacitor.isNativePlatform();
	}

	function showModal(node: HTMLDialogElement) {
		node.showModal();
		const onClose = () => (settingsOpen = false);
		node.addEventListener('close', onClose);

		return {
			destroy() {
				node.removeEventListener('close', onClose);
				if (node.open) node.close();
			}
		};
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

	<div class="people-list">
		{#each people as p (p.id)}
			<button
				type="button"
				class="person-row"
				class:self={p.id === viewerId}
				disabled={p.id === viewerId}
				onclick={() => void openChat(p)}
			>
				<span class="avatar">
					{#if p.avatar}
						<img src={p.avatar} alt="" />
					{:else}
						{p.name.slice(0, 1)}
					{/if}
				</span>
				<span class="person-text">
					<span class="pname">{p.name}</span>
					<span class="prole">
						{p.owner ? ' · Owner' : ''} ·
						<span class:active={p.status === 'Active'}>{p.status}</span>
					</span>
				</span>
				{#if unreadByUser[p.id]}
					<span class="unread">{unreadByUser[p.id]}</span>
				{:else if p.id !== viewerId}
					<MdiIcon path={mdiMessageTextOutline} size={16} />
				{/if}
			</button>
		{/each}
	</div>
</aside>

{#if chatOpen && selectedPerson}
	<button class="scrim" aria-label="Close chat" onclick={closeChat}></button>
	<div
		class="chat-dialog"
		role="dialog"
		aria-modal="true"
		aria-label={`Chat with ${selectedPerson.name}`}
	>
		<header class="chat-head">
			<div class="chat-title">
				<span class="avatar large">
					{#if selectedPerson.avatar}
						<img src={selectedPerson.avatar} alt="" />
					{:else}
						{selectedPerson.name.slice(0, 1)}
					{/if}
				</span>
				<div>
					<h2>{selectedPerson.name}</h2>
					<p>{selectedPerson.status ?? 'Offline'}</p>
				</div>
			</div>
			<button class="x" aria-label="Close chat" onclick={closeChat}>
				<MdiIcon path={mdiClose} size={18} />
			</button>
		</header>

		<div class="chat-body">
			{#if chatLoading}
				<p class="empty-chat">Loading messages...</p>
			{:else if activeMessages.length === 0}
				<p class="empty-chat">No messages yet.</p>
			{:else}
				{#each activeMessages as message (message.id)}
					<article class="bubble" class:mine={message.from_user_id === viewerId}>
						{#if message.message}
							<p>{message.message}</p>
						{/if}
						{#if message.attachments?.length}
							<div class="attachment-list">
								{#each message.attachments as attachment (attachment.id ?? attachment.file_key)}
									<button
										type="button"
										class="attachment"
										onclick={() => void openAttachment(attachment)}
									>
										<MdiIcon path={mdiDownloadOutline} size={14} />
										<span>{attachment.file_name}</span>
										<small>{prettyBytes(attachment.size)}</small>
									</button>
								{/each}
							</div>
						{/if}
						<time>{new Date(message.created_at).toLocaleString()}</time>
					</article>
				{/each}
			{/if}
		</div>

		{#if chatFiles.length}
			<div class="picked-files">
				{#each chatFiles as file, index (`${file.name}-${file.size}-${index}`)}
					<button type="button" onclick={() => removePickedFile(index)}>
						<MdiIcon path={mdiClose} size={12} />
						{file.name}
					</button>
				{/each}
			</div>
		{/if}

		{#if chatError}
			<p class="chat-error">{chatError}</p>
		{/if}

		<form
			class="chat-form"
			onsubmit={(event) => {
				event.preventDefault();
				void sendChatMessage();
			}}
		>
			<label class="attach-btn" aria-label="Attach files">
				<MdiIcon path={mdiPaperclip} size={18} />
				<input type="file" multiple disabled={chatBusy} onchange={onPickFiles} />
			</label>
			<textarea
				rows="2"
				placeholder="Message"
				bind:value={chatDraft}
				disabled={chatBusy}
				onkeydown={(event) => {
					if (event.key === 'Enter' && !event.shiftKey) {
						event.preventDefault();
						void sendChatMessage();
					}
				}}></textarea>
			<button
				class="send-btn"
				type="submit"
				disabled={chatBusy || (!chatDraft.trim() && chatFiles.length === 0)}
				aria-label="Send message"
			>
				<MdiIcon path={mdiSend} size={18} />
			</button>
		</form>
	</div>
{/if}

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
	<dialog
		class="share-dialog settings-dialog"
		aria-label="Settings"
		use:showModal
		onclick={(event) => {
			if (event.target === event.currentTarget) settingsOpen = false;
		}}
	>
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

			<button
				class="setting-action"
				onclick={async () => {
					if (await notificationPermission()) {
						if (isNativePlatform()) {
							await LocalNotifications.cancelAll();
							notificationEnabled = false;
							await unregisterPushNotifications();
						} else {
							const sw = await navigator.serviceWorker.ready;
							await unregisterServiceWorker();
						}
					} else {
						if (isNativePlatform()) {
							await requestForNotificationPermission();
							notificationEnabled = await notificationPermission();
						} else {
							await registerServiceWorker(env.PUBLIC_VAPID_PUBLIC);
							notificationEnabled = await notificationPermission();
						}
					}
				}}
			>
				<span class="setting-ic"><MdiIcon path={mdiMessageTextOutline} size={20} /></span>
				<span class="setting-text">
					<span class="setting-title"
						>{notificationEnabled ? 'Disable' : 'Enable'} Notification on {isNativePlatform()
							? 'Mobile'
							: 'Web'}</span
					>
					<span class="setting-sub">Subscribe or unsubscribe from notifications</span>
				</span>
				<MdiIcon path={mdiChevronRight} size={18} />
			</button>

			{#if isNativePlatform()}
				<button class="setting-action" onclick={openNativeAlarmSettings}>
					<span class="setting-ic"><MdiIcon path={mdiAlarm} size={20} /></span>
					<span class="setting-text">
						<span class="setting-title">Task alarm access</span>
						<span class="setting-sub">Allow exact timing and full-screen alarm alerts</span>
					</span>
					<MdiIcon path={mdiChevronRight} size={18} />
				</button>

				<button class="setting-action" onclick={openNativeUnusedAppSettings}>
					<span class="setting-ic"><MdiIcon path={mdiAlarm} size={20} /></span>
					<span class="setting-text">
						<span class="setting-title">Keep app active</span>
						<span class="setting-sub">Turn off “Pause app activity if unused” for reliable alarms</span>
					</span>
					<MdiIcon path={mdiChevronRight} size={18} />
				</button>
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
	</dialog>
{/if}

<style>
	.panel {
		width: 300px;
		flex-shrink: 0;
		background: var(--color-background);
		border-left: 1px solid var(--color-border);
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
		color: var(--color-muted-foreground);
	}

	.panel :global(.settings-card) {
		margin-top: 12px;
		padding: 12px 14px;
		border-radius: 12px;
		font-size: 12px;
		color: var(--color-muted-foreground);
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
		color: var(--color-muted-foreground);
	}
	.seg {
		display: flex;
		border: 1px solid var(--color-border);
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
		color: var(--color-muted-foreground);
	}
	.seg button.active {
		background: color-mix(in oklch, var(--color-primary) 22%, var(--color-card));
		color: var(--color-foreground);
		font-weight: 600;
	}
	.seg button + button {
		border-left: 1px solid var(--color-border);
	}

	.setting-action {
		display: flex;
		align-items: center;
		gap: 12px;
		border: 1px solid var(--color-border);
		border-radius: 12px;
		background: var(--color-card);
		padding: 10px 12px;
		cursor: pointer;
		text-align: left;
		color: var(--color-foreground);
		text-decoration: none;
		font: inherit;
	}
	.setting-action:hover {
		background: var(--color-muted);
	}
	.setting-ic {
		width: 36px;
		height: 36px;
		border-radius: 8px;
		flex-shrink: 0;
		background: var(--color-muted);
		color: var(--color-muted-foreground);
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
		color: var(--color-muted-foreground);
	}
	.setting-action.danger .setting-title {
		color: var(--color-danger);
	}
	.setting-action.danger .setting-ic {
		background: var(--color-danger-muted);
		color: var(--color-danger);
	}

	.people-list {
		background: transparent;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.person-row {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		border: 0;
		border-radius: 10px;
		padding: 8px 10px;
		background: transparent;
		color: var(--color-foreground);
		text-align: left;
		cursor: pointer;
	}
	.person-row:hover {
		background: var(--color-muted);
	}
	.person-row.self {
		cursor: default;
		opacity: 0.72;
	}
	.person-row:disabled {
		pointer-events: none;
	}
	.person-row :global(svg) {
		color: var(--color-muted-foreground);
	}
	.person-text {
		flex: 1;
		min-width: 0;
	}
	.unread {
		min-width: 20px;
		height: 20px;
		border-radius: 999px;
		display: inline-grid;
		place-items: center;
		background: var(--color-primary);
		color: var(--color-primary-foreground);
		font-size: 11px;
		font-weight: 700;
	}
	.avatar {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		background: var(--color-muted);
		color: var(--color-muted-foreground);
		display: grid;
		place-items: center;
		font-size: 13px;
		font-weight: 600;
		flex-shrink: 0;
		overflow: hidden;
	}
	.avatar.large {
		width: 38px;
		height: 38px;
	}
	.avatar img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.pname {
		display: block;
		font-size: 13.5px;
		font-weight: 600;
		color: var(--color-foreground);
	}
	.prole {
		display: block;
		font-size: 11.5px;
		color: var(--color-muted-foreground);
	}
	.active {
		color: var(--color-success);
		font-weight: 600;
	}

	.chat-dialog {
		position: fixed;
		z-index: 71;
		right: 18px;
		bottom: 18px;
		width: min(420px, calc(100vw - 32px));
		max-height: min(680px, calc(100dvh - 36px));
		display: grid;
		grid-template-rows: auto minmax(180px, 1fr) auto auto auto;
		background: var(--color-card);
		color: var(--color-foreground);
		border: 1px solid var(--color-border);
		border-radius: 16px;
		box-shadow: 0 18px 60px rgba(0, 0, 0, 0.28);
		overflow: hidden;
	}
	.chat-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 12px 14px;
		border-bottom: 1px solid var(--color-border);
	}
	.chat-title {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}
	.chat-title h2 {
		margin: 0;
		font-size: 15px;
		font-weight: 700;
	}
	.chat-title p {
		margin: 2px 0 0;
		font-size: 11.5px;
		color: var(--color-muted-foreground);
	}
	.chat-body {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px;
		overflow-y: auto;
		background: color-mix(in oklch, var(--color-background) 88%, var(--color-card));
	}
	.empty-chat {
		margin: auto;
		color: var(--color-muted-foreground);
		font-size: 13px;
	}
	.bubble {
		width: fit-content;
		max-width: 86%;
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 9px 11px;
		border-radius: 14px;
		background: var(--color-card);
		border: 1px solid var(--color-border);
		align-self: flex-start;
	}
	.bubble.mine {
		align-self: flex-end;
		background: color-mix(in oklch, var(--color-primary) 18%, var(--color-card));
		border-color: color-mix(in oklch, var(--color-primary) 36%, var(--color-border));
	}
	.bubble p {
		margin: 0;
		font-size: 13px;
		line-height: 1.35;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.bubble time {
		color: var(--color-muted-foreground);
		font-size: 10.5px;
	}
	.attachment-list,
	.picked-files {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.attachment,
	.picked-files button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		background: var(--color-background);
		color: var(--color-foreground);
		padding: 6px 8px;
		font: inherit;
		font-size: 11.5px;
		cursor: pointer;
	}
	.attachment span,
	.picked-files button {
		max-width: 210px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.attachment small {
		color: var(--color-muted-foreground);
	}
	.picked-files {
		padding: 8px 12px 0;
		background: var(--color-card);
	}
	.chat-error {
		margin: 8px 12px 0;
		color: var(--color-danger);
		font-size: 12px;
	}
	.chat-form {
		display: grid;
		grid-template-columns: 34px 1fr 38px;
		gap: 8px;
		align-items: end;
		padding: 12px;
		background: var(--color-card);
	}
	.chat-form textarea {
		min-height: 42px;
		max-height: 120px;
		resize: vertical;
		border: 1px solid var(--color-border);
		border-radius: 12px;
		padding: 10px 12px;
		background: var(--color-background);
		color: var(--color-foreground);
		font: inherit;
		font-size: 13px;
	}
	.attach-btn,
	.send-btn {
		width: 34px;
		height: 34px;
		display: grid;
		place-items: center;
		border: 0;
		border-radius: 999px;
		background: var(--color-muted);
		color: var(--color-foreground);
		cursor: pointer;
	}
	.attach-btn {
		position: relative;
		overflow: hidden;
	}
	.attach-btn input {
		position: absolute;
		inset: 0;
		opacity: 0;
		cursor: pointer;
	}
	.send-btn {
		width: 38px;
		height: 38px;
		background: var(--color-primary);
		color: var(--color-primary-foreground);
	}
	.send-btn:disabled {
		opacity: 0.5;
		cursor: default;
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
		background: var(--color-card);
		border-radius: 16px;
		padding: 18px 20px;
		box-shadow: 0 8px 30px rgba(0, 0, 0, 0.25);
	}
	.settings-dialog {
		inset: 0;
		margin: auto;
		transform: none;
		border: 0;
		color: var(--color-foreground);
		max-height: calc(100dvh - 32px);
		overflow-y: auto;
	}
	.settings-dialog::backdrop {
		background: rgba(15, 23, 42, 0.35);
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
		color: var(--color-foreground);
	}
	.x {
		display: grid;
		place-items: center;
		width: 30px;
		height: 30px;
		border: 0;
		border-radius: 50%;
		background: none;
		color: var(--color-muted-foreground);
		cursor: pointer;
	}
	.x:hover {
		background: var(--color-muted);
	}
	.share-desc {
		font-size: 12.5px;
		color: var(--color-muted-foreground);
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
		color: var(--color-foreground);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		padding: 9px 12px;
		background: var(--color-background);
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
		.head {
			padding-right: 36px;
		}
		.share-dialog:not(.settings-dialog) {
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
