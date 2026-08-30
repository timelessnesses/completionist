<script lang="ts">
	import { fly } from 'svelte/transition';
	import {
		mdiAccountMultipleOutline,
		mdiAccountPlusOutline,
		mdiAccountStarOutline,
		mdiArrowLeft,
		mdiCalendarCheckOutline,
		mdiClose,
		mdiDeleteOutline,
		mdiFlagOutline,
		mdiFlagRemoveOutline,
		mdiHistory,
		mdiMagnify,
		mdiPencilOutline,
		mdiPlus,
		mdiRestore,
		mdiShieldAccountOutline,
		mdiUploadOutline
	} from '@mdi/js';
	import * as XLSX from 'xlsx';
	import MdiIcon from '$lib/components/MdiIcon.svelte';
	import type { PageProps } from './$types';
	import type { RichTask } from '$lib/features/tasks/types';
	import { colorToHex, hexToColor } from '$lib/features/tasks/color';

	type AuditAction = 'create' | 'update' | 'delete' | 'restore';
	type AuditEntry = {
		id: string;
		actor_id: string;
		action: AuditAction;
		entity_type: 'event';
		entity_id: string;
		entity_name: string;
		details: string | null;
		created_at: Date | number | string;
	};
	type AccountEntry = {
		id: string;
		email: string;
		display_name: string | null;
		whitelisted: boolean;
		owner: boolean;
		deleted_at: Date | number | string | null;
		logged_in_when: Date | number | string | null;
	};

	let { data }: PageProps = $props();
	let events = $state<RichTask[]>(data.events as RichTask[]);
	let auditLogs = $state<AuditEntry[]>(data.auditLogs as AuditEntry[]);
	let query = $state('');
	let scope = $state<'active' | 'deleted' | 'all'>('active');
	let editorOpen = $state(false);
	let editingId = $state<string | null>(null);
	let busyId = $state<string | null>(null);
	let formError = $state('');
	let draft = $state(emptyDraft());
	let accounts = $state<AccountEntry[]>(data.accounts as AccountEntry[]);
	let allowOrgMembers = $state(data.accessPolicy.allowOrgMembers);
	let accessBusy = $state(false);
	let accessError = $state('');
	let accountDraft = $state({
		id: '',
		email: '',
		display_name: '',
		whitelisted: true,
		owner: false
	});
	let fileInput: HTMLInputElement;
	let importerOpen = $state(false);
	let importing = $state(false);
	let sheetRows = $state<unknown[][]>([]);
	let sheetNames = $state<string[]>([]);
	let sheetNumber = $state(1);
	let emailColumn = $state('');
	let nameColumn = $state('');
	let workbook: XLSX.WorkBook | null = null;

	const importPreview = $derived.by(() => {
		const emailIndex = columnToIndex(emailColumn);
		const nameIndex = columnToIndex(nameColumn);
		if (emailIndex < 0) return [];
		const domain = String(data.organizationDomain).toLowerCase();
		return sheetRows
			.map((row) => ({
				email: String(row[emailIndex] ?? '')
					.trim()
					.toLowerCase(),
				display_name: nameIndex >= 0 ? String(row[nameIndex] ?? '').trim() : ''
			}))
			.filter(
				(entry, index, entries) =>
					entry.email.endsWith(`@${domain}`) &&
					entry.email.length > domain.length + 1 &&
					entries.findIndex((candidate) => candidate.email === entry.email) === index
			);
	});

	async function responseError(response: Response) {
		const body = (await response.json().catch(() => null)) as { message?: string } | null;
		return body?.message || response.statusText || 'Request failed';
	}

	async function setAccessMode(checked: boolean) {
		const previous = allowOrgMembers;
		allowOrgMembers = checked;
		accessBusy = true;
		accessError = '';
		try {
			const response = await fetch('/admin/access', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ allow_org_members: checked })
			});
			if (!response.ok) throw new Error(await responseError(response));
		} catch (error) {
			allowOrgMembers = previous;
			accessError = error instanceof Error ? error.message : 'Could not update access mode.';
		} finally {
			accessBusy = false;
		}
	}

	function editAccount(entry: AccountEntry) {
		accountDraft = {
			id: entry.id,
			email: entry.email,
			display_name: entry.display_name ?? '',
			whitelisted: entry.whitelisted,
			owner: entry.owner
		};
		accessError = '';
	}

	function clearAccountDraft() {
		accountDraft = { id: '', email: '', display_name: '', whitelisted: true, owner: false };
	}

	async function saveAccount() {
		accessBusy = true;
		accessError = '';
		try {
			const response = await fetch('/admin/access', {
				method: accountDraft.id ? 'PUT' : 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(accountDraft)
			});
			if (!response.ok) throw new Error(await responseError(response));
			const saved = (await response.json()) as AccountEntry;
			accounts = accountDraft.id
				? accounts.map((entry) => (entry.id === saved.id ? saved : entry))
				: [...accounts, saved];
			accounts.sort((a, b) => a.email.localeCompare(b.email));
			clearAccountDraft();
		} catch (error) {
			accessError = error instanceof Error ? error.message : 'Could not save account.';
		} finally {
			accessBusy = false;
		}
	}

	async function deleteAccount(entry: AccountEntry) {
		if (!confirm(`Soft-delete ${entry.email}? Their history and event references will be kept.`))
			return;
		accessBusy = true;
		accessError = '';
		try {
			const response = await fetch(`/admin/access?id=${encodeURIComponent(entry.id)}`, {
				method: 'DELETE'
			});
			if (!response.ok) throw new Error(await responseError(response));
			const result = (await response.json()) as { deleted_at: Date | number | string };
			accounts = accounts.map((item) =>
				item.id === entry.id
					? { ...item, deleted_at: result.deleted_at, whitelisted: false, owner: false }
					: item
			);
			if (accountDraft.id === entry.id) clearAccountDraft();
		} catch (error) {
			accessError = error instanceof Error ? error.message : 'Could not delete account.';
		} finally {
			accessBusy = false;
		}
	}

	async function setWhitelisted(entry: AccountEntry, whitelisted: boolean) {
		accessBusy = true;
		accessError = '';
		try {
			const response = await fetch('/admin/access', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: entry.id, whitelisted })
			});
			if (!response.ok) throw new Error(await responseError(response));
			accounts = accounts.map((item) => (item.id === entry.id ? { ...item, whitelisted } : item));
		} catch (error) {
			accessError = error instanceof Error ? error.message : 'Could not update account access.';
		} finally {
			accessBusy = false;
		}
	}

	async function setOwner(entry: AccountEntry, owner: boolean) {
		accessBusy = true;
		accessError = '';
		try {
			const response = await fetch('/admin/access', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: entry.id, owner })
			});
			if (!response.ok) throw new Error(await responseError(response));
			accounts = accounts.map((item) => (item.id === entry.id ? { ...item, owner } : item));
		} catch (error) {
			accessError = error instanceof Error ? error.message : 'Could not update owner role.';
		} finally {
			accessBusy = false;
		}
	}

	async function restoreAccount(entry: AccountEntry) {
		accessBusy = true;
		accessError = '';
		try {
			const response = await fetch('/admin/access', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: entry.id, restore: true })
			});
			if (!response.ok) throw new Error(await responseError(response));
			accounts = accounts.map((item) =>
				item.id === entry.id ? { ...item, deleted_at: null } : item
			);
		} catch (error) {
			accessError = error instanceof Error ? error.message : 'Could not restore account.';
		} finally {
			accessBusy = false;
		}
	}

	function columnToIndex(value: string) {
		const trimmed = value.trim();
		if (!trimmed) return -1;
		if (/^\d+$/.test(trimmed)) return Number(trimmed) - 1;
		let index = 0;
		for (const character of trimmed.toUpperCase()) {
			if (character < 'A' || character > 'Z') return -1;
			index = index * 26 + character.charCodeAt(0) - 64;
		}
		return index - 1;
	}

	function loadSheet() {
		if (!workbook) return;
		const sheetName = workbook.SheetNames[sheetNumber - 1] ?? workbook.SheetNames[0];
		sheetRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
			header: 1,
			blankrows: false
		}) as unknown[][];
	}

	function fileChange(event: Event) {
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = () => {
			if (!(reader.result instanceof ArrayBuffer)) return;
			workbook = XLSX.read(reader.result, { type: 'array' });
			sheetNames = workbook.SheetNames;
			sheetNumber = 1;
			emailColumn = '';
			nameColumn = '';
			loadSheet();
			importerOpen = true;
		};
		reader.readAsArrayBuffer(file);
	}

	function closeImporter() {
		if (importing) return;
		importerOpen = false;
		workbook = null;
		sheetRows = [];
		if (fileInput) fileInput.value = '';
	}

	async function importWhitelist() {
		if (!importPreview.length) return;
		importing = true;
		accessError = '';
		try {
			const response = await fetch('/admin/access', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ entries: importPreview })
			});
			if (!response.ok) throw new Error(await responseError(response));
			const result = (await response.json()) as {
				entries: AccountEntry[];
				imported: number;
				skipped: number;
			};
			const byId = new Map([...accounts, ...result.entries].map((entry) => [entry.id, entry]));
			accounts = [...byId.values()].sort((a, b) => a.email.localeCompare(b.email));
			importing = false;
			closeImporter();
			alert(
				`Imported ${result.imported} account${result.imported === 1 ? '' : 's'}; skipped ${result.skipped}.`
			);
		} catch (error) {
			accessError = error instanceof Error ? error.message : 'Could not import the spreadsheet.';
		} finally {
			importing = false;
		}
	}

	const filteredEvents = $derived.by(() => {
		const needle = query.trim().toLowerCase();
		return events.filter((event) => {
			if (scope === 'active' && event.deleted_at) return false;
			if (scope === 'deleted' && !event.deleted_at) return false;
			return (
				!needle ||
				event.task_name.toLowerCase().includes(needle) ||
				(event.description ?? '').toLowerCase().includes(needle) ||
				(data.users.find((user) => user.id === event.owner)?.name ?? '')
					.toLowerCase()
					.includes(needle)
			);
		});
	});
	const activeCount = $derived(events.filter((event) => !event.deleted_at).length);
	const deletedCount = $derived(events.filter((event) => !!event.deleted_at).length);

	function emptyDraft() {
		const start = new Date();
		start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0);
		const end = new Date(start.getTime() + 60 * 60_000);
		return {
			task_name: '',
			description: '',
			owner_id: data.users[0]?.id ?? '',
			start_at: toLocalInput(start),
			end_at: toLocalInput(end),
			status: 'todo' as RichTask['status'],
			importance_value: 0,
			all_day: false,
			color: '#0b57d0'
		};
	}

	function toLocalInput(value: Date | number | string) {
		const date = new Date(value);
		const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
		return local.toISOString().slice(0, 16);
	}

	function openCreate() {
		editingId = null;
		draft = emptyDraft();
		formError = '';
		editorOpen = true;
	}

	function openEdit(event: RichTask) {
		editingId = event.id;
		draft = {
			task_name: event.task_name,
			description: event.description ?? '',
			owner_id: event.owner,
			start_at: toLocalInput(event.start_at),
			end_at: toLocalInput(event.end_at),
			status: event.status,
			importance_value: event.importance_value,
			all_day: !!event.all_day,
			color: colorToHex(event.color)
		};
		formError = '';
		editorOpen = true;
	}

	function closeEditor() {
		if (busyId === 'editor') return;
		editorOpen = false;
		formError = '';
	}

	async function saveEvent() {
		const start = new Date(draft.start_at);
		const end = new Date(draft.end_at);
		if (!draft.task_name.trim()) return (formError = 'Event name is required.');
		if (!draft.owner_id) return (formError = 'Select an owner.');
		if (!Number.isFinite(+start) || !Number.isFinite(+end) || end < start) {
			return (formError = 'End time must be after the start time.');
		}

		const action: AuditAction = editingId ? 'update' : 'create';
		busyId = 'editor';
		formError = '';
		try {
			const response = await fetch(
				editingId ? `/api/events?id=${encodeURIComponent(editingId)}` : '/api/events',
				{
					method: editingId ? 'PUT' : 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						task_name: draft.task_name.trim(),
						description: draft.description.trim() || null,
						owner_id: draft.owner_id,
						start_at: +start,
						end_at: +end,
						status: draft.status,
						completed: draft.status === 'completed' ? Date.now() : null,
						importance_value: Number(draft.importance_value) || 0,
						all_day: draft.all_day ? 1 : 0,
						color: hexToColor(draft.color)
					})
				}
			);
			if (!response.ok) throw new Error(await response.text());
			const saved = (await response.json()) as RichTask;
			events = editingId
				? events.map((event) => (event.id === saved.id ? saved : event))
				: [saved, ...events];
			prependAuditLog(action, saved);
			editorOpen = false;
		} catch (error) {
			formError = error instanceof Error ? error.message : 'Could not save the event.';
		} finally {
			busyId = null;
		}
	}

	async function softDelete(event: RichTask) {
		if (!confirm(`Move “${event.task_name}” to deleted events?`)) return;
		busyId = event.id;
		try {
			const response = await fetch(`/api/events?id=${encodeURIComponent(event.id)}`, {
				method: 'DELETE'
			});
			if (!response.ok) throw new Error(await response.text());
			const result = (await response.json()) as { deleted_at: number };
			events = events.map((item) =>
				item.id === event.id ? { ...item, deleted_at: new Date(result.deleted_at) } : item
			);
			prependAuditLog('delete', event);
		} finally {
			busyId = null;
		}
	}

	async function restoreEvent(event: RichTask) {
		busyId = event.id;
		try {
			const response = await fetch(
				`/api/events?id=${encodeURIComponent(event.id)}&action=restore`,
				{ method: 'PATCH' }
			);
			if (!response.ok) throw new Error(await response.text());
			const restored = (await response.json()) as RichTask;
			events = events.map((item) => (item.id === restored.id ? restored : item));
			prependAuditLog('restore', restored);
		} finally {
			busyId = null;
		}
	}

	function ownerName(event: RichTask) {
		return data.users.find((user) => user.id === event.owner)?.name ?? 'Unknown owner';
	}

	function dateLabel(value: Date | number | string) {
		return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
	}

	function prependAuditLog(action: AuditAction, event: RichTask) {
		const optimisticEntry: AuditEntry = {
			id: crypto.randomUUID(),
			actor_id: data.currentAdmin.id,
			action,
			entity_type: 'event',
			entity_id: event.id,
			entity_name: event.task_name,
			details: null,
			created_at: new Date()
		};
		auditLogs = [optimisticEntry, ...auditLogs].slice(0, 100);
	}

	function auditActor(entry: AuditEntry) {
		return (
			data.users.find((user) => user.id === entry.actor_id)?.name ??
			(entry.actor_id === data.currentAdmin.id ? data.currentAdmin.name : 'Unknown administrator')
		);
	}

	function auditDescription(entry: AuditEntry) {
		if (entry.action === 'create') return 'created this event';
		if (entry.action === 'update') {
			if (!entry.details) return 'updated this event';
			try {
				const details = JSON.parse(entry.details) as {
					before?: Record<string, unknown>;
					after?: Record<string, unknown>;
				};
				const changed = Object.keys(details.after ?? {}).filter(
					(key) => JSON.stringify(details.before?.[key]) !== JSON.stringify(details.after?.[key])
				);
				return changed.length
					? `updated ${changed.slice(0, 3).join(', ')}${changed.length > 3 ? ` and ${changed.length - 3} more` : ''}`
					: 'updated this event';
			} catch {
				return 'updated this event';
			}
		}
		if (entry.action === 'delete') return 'moved this event to recoverable records';
		return 'restored this event';
	}

	function auditIcon(action: AuditAction) {
		if (action === 'create') return mdiPlus;
		if (action === 'update') return mdiPencilOutline;
		if (action === 'delete') return mdiDeleteOutline;
		return mdiRestore;
	}
</script>

<svelte:head><title>Event administration · Completionist</title></svelte:head>

<main class="admin-shell">
	<header class="masthead">
		<a class="back" href="/" aria-label="Back to calendar"
			><MdiIcon path={mdiArrowLeft} size={19} /></a
		>
		<div class="mark"><MdiIcon path={mdiCalendarCheckOutline} size={22} /></div>
		<div>
			<p class="kicker">Admin workspace</p>
			<h1>Administration</h1>
		</div>
		<button class="create" onclick={openCreate}
			><MdiIcon path={mdiPlus} size={18} /> New event</button
		>
	</header>

	<section class="metrics" aria-label="Event totals">
		<div><strong>{events.length}</strong><span>Total records</span></div>
		<div><strong>{activeCount}</strong><span>Active events</span></div>
		<div class="danger"><strong>{deletedCount}</strong><span>Recoverable</span></div>
	</section>

	<section class="access-panel" aria-labelledby="access-heading">
		<header class="access-head">
			<div class="audit-title">
				<span class="audit-mark"><MdiIcon path={mdiShieldAccountOutline} size={20} /></span>
				<div>
					<p class="kicker">Sign-in policy</p>
					<h2 id="access-heading">Organization access</h2>
				</div>
			</div>
			<label class="access-toggle">
				<input
					type="checkbox"
					checked={allowOrgMembers}
					disabled={accessBusy}
					onchange={(event) => setAccessMode(event.currentTarget.checked)}
				/>
				<span>Allow everyone in @{data.organizationDomain}</span>
			</label>
		</header>
		<div class="access-copy">
			{#if allowOrgMembers}
				<strong>Organization mode:</strong> any verified @{data.organizationDomain} account may sign in.
			{:else}
				<strong>Whitelist mode:</strong> only active accounts flagged <em>True</em> below may sign in.
				The configured bootstrap administrator always retains access.
			{/if}
		</div>
		<form
			class="whitelist-form"
			onsubmit={(event) => {
				event.preventDefault();
				saveAccount();
			}}
		>
			<label>
				<span>Email</span>
				<input
					type="email"
					placeholder={`student@${data.organizationDomain}`}
					bind:value={accountDraft.email}
					required
				/>
			</label>
			<label>
				<span>Name (optional)</span>
				<input placeholder="Display name" bind:value={accountDraft.display_name} />
			</label>
			<button class="save access-save" disabled={accessBusy}>
				<MdiIcon path={accountDraft.id ? mdiPencilOutline : mdiAccountPlusOutline} size={17} />
				{accountDraft.id ? 'Save account' : 'Add account'}
			</button>
			{#if accountDraft.id}
				<button class="cancel access-cancel" type="button" onclick={clearAccountDraft}
					>Cancel</button
				>
			{/if}
			<button class="import-button" type="button" onclick={() => fileInput.click()}>
				<MdiIcon path={mdiUploadOutline} size={17} /> Import spreadsheet
			</button>
		</form>
		<input
			class="sr-only"
			type="file"
			accept=".csv,.xls,.xlsx"
			bind:this={fileInput}
			onchange={fileChange}
		/>
		{#if accessError}<p class="access-error">{accessError}</p>{/if}
		<div class="table-wrap whitelist-table">
			<table>
				<thead>
					<tr
						><th>Account</th><th>Name</th><th>Whitelisted</th><th>Owner</th><th>State</th><th
							>Last sign-in</th
						><th><span class="sr-only">Actions</span></th></tr
					>
				</thead>
				<tbody>
					{#each accounts as entry (entry.id)}
						<tr class:deleted={!!entry.deleted_at}>
							<td
								><span class="account"
									><MdiIcon path={mdiAccountMultipleOutline} size={18} />{entry.email}</span
								></td
							>
							<td>{entry.display_name || '—'}</td>
							<td>
								<span class="boolean" class:on={entry.whitelisted}
									>{entry.whitelisted ? 'True' : 'False'}</span
								>
							</td>
							<td>
								<span class="boolean" class:on={entry.owner}>{entry.owner ? 'True' : 'False'}</span>
							</td>
							<td
								><span class="status" data-status={entry.deleted_at ? 'cancelled' : 'completed'}
									>{entry.deleted_at ? 'Deleted' : 'Active'}</span
								></td
							>
							<td>{entry.logged_in_when ? dateLabel(entry.logged_in_when) : 'Never'}</td>
							<td class="actions">
								{#if entry.deleted_at}
									<button
										title="Restore account"
										disabled={accessBusy}
										onclick={() => restoreAccount(entry)}
										><MdiIcon path={mdiRestore} size={18} /></button
									>
								{:else}
									<button
										title={entry.whitelisted ? 'Remove whitelist flag' : 'Whitelist account'}
										disabled={accessBusy}
										onclick={() => setWhitelisted(entry, !entry.whitelisted)}
										><MdiIcon
											path={entry.whitelisted ? mdiFlagRemoveOutline : mdiFlagOutline}
											size={18}
										/></button
									>
									<button
										title={entry.owner ? 'Remove owner role' : 'Grant owner role'}
										disabled={accessBusy}
										onclick={() => setOwner(entry, !entry.owner)}
										><MdiIcon path={mdiAccountStarOutline} size={18} /></button
									>
									<button title="Edit account" onclick={() => editAccount(entry)}
										><MdiIcon path={mdiPencilOutline} size={17} /></button
									>
									<button
										class="delete"
										title="Soft-delete account"
										disabled={accessBusy || entry.id === data.currentAdmin.id}
										onclick={() => deleteAccount(entry)}
										><MdiIcon path={mdiDeleteOutline} size={18} /></button
									>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
			{#if accounts.length === 0}<div class="empty">No accounts have been created yet.</div>{/if}
		</div>
	</section>

	<section class="workspace">
		<div class="controls">
			<label class="search"
				><MdiIcon path={mdiMagnify} size={18} /><input
					type="search"
					placeholder="Search name, notes, or owner"
					bind:value={query}
				/></label
			>
			<div class="scope" aria-label="Record filter">
				{#each ['active', 'deleted', 'all'] as option}
					<button class:active={scope === option} onclick={() => (scope = option as typeof scope)}
						>{option}</button
					>
				{/each}
			</div>
		</div>

		<div class="table-wrap">
			<table>
				<thead
					><tr
						><th>Event</th><th>Owner</th><th>Window</th><th>Status</th><th>Priority</th><th
							><span class="sr-only">Actions</span></th
						></tr
					></thead
				>
				<tbody>
					{#each filteredEvents as event, index (event.id)}
						<tr
							class:deleted={!!event.deleted_at}
							style:animation-delay={`${Math.min(index, 12) * 25}ms`}
						>
							<td
								><span class="event-name"
									><i style:background={colorToHex(event.color)}></i>{event.task_name}</span
								><small>{event.description || 'No description'}</small></td
							>
							<td>{ownerName(event)}</td>
							<td
								><time>{dateLabel(event.start_at)}</time><small>to {dateLabel(event.end_at)}</small
								></td
							>
							<td
								><span class="status" data-status={event.status}
									>{event.deleted_at ? 'deleted' : event.status}</span
								></td
							>
							<td>{event.importance_value}</td>
							<td class="actions">
								{#if event.deleted_at}
									<button
										title="Restore"
										disabled={busyId === event.id}
										onclick={() => restoreEvent(event)}
										><MdiIcon path={mdiRestore} size={18} /></button
									>
								{:else}
									<button title="Edit" onclick={() => openEdit(event)}
										><MdiIcon path={mdiPencilOutline} size={17} /></button
									>
									<button
										class="delete"
										title="Delete"
										disabled={busyId === event.id}
										onclick={() => softDelete(event)}
										><MdiIcon path={mdiDeleteOutline} size={18} /></button
									>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
			{#if filteredEvents.length === 0}<div class="empty">No records match this view.</div>{/if}
		</div>
	</section>

	<section class="audit-log" aria-labelledby="audit-heading">
		<header class="audit-head">
			<div class="audit-title">
				<span class="audit-mark"><MdiIcon path={mdiHistory} size={19} /></span>
				<div>
					<p class="kicker">Accountability</p>
					<h2 id="audit-heading">Recent admin activity</h2>
				</div>
			</div>
			<span class="audit-count">Latest {auditLogs.length} actions</span>
		</header>

		{#if auditLogs.length}
			<ol class="audit-list">
				{#each auditLogs as entry, index (entry.id)}
					<li style:animation-delay={`${Math.min(index, 12) * 25}ms`}>
						<span class="audit-icon" data-action={entry.action}>
							<MdiIcon path={auditIcon(entry.action)} size={16} />
						</span>
						<span class="audit-copy">
							<span><strong>{auditActor(entry)}</strong> {auditDescription(entry)}</span>
							<small>{entry.entity_name}</small>
						</span>
						<span class="audit-meta">
							<span class="audit-action" data-action={entry.action}>{entry.action}</span>
							<time datetime={new Date(entry.created_at).toISOString()}
								>{dateLabel(entry.created_at)}</time
							>
						</span>
					</li>
				{/each}
			</ol>
		{:else}
			<div class="audit-empty">Admin CRUD activity will appear here.</div>
		{/if}
	</section>
</main>

{#if importerOpen}
	<button class="scrim" aria-label="Close spreadsheet importer" onclick={closeImporter}></button>
	<aside
		class="editor importer"
		aria-label="Import account spreadsheet"
		transition:fly={{ x: 30, duration: 260 }}
	>
		<header>
			<div>
				<p class="kicker">CSV / Excel</p>
				<h2>Import accounts</h2>
			</div>
			<button class="close" type="button" onclick={closeImporter}
				><MdiIcon path={mdiClose} size={20} /></button
			>
		</header>
		<div class="import-grid">
			{#if sheetNames.length > 1}
				<label class="wide"
					><span>Sheet</span><select bind:value={sheetNumber} onchange={loadSheet}>
						{#each sheetNames as sheet, index}<option value={index + 1}>{index + 1}. {sheet}</option
							>{/each}
					</select></label
				>
			{/if}
			<label><span>Email column</span><input placeholder="A or 1" bind:value={emailColumn} /></label
			>
			<label
				><span>Name column (optional)</span><input
					placeholder="B or 2"
					bind:value={nameColumn}
				/></label
			>
		</div>
		<p class="import-help">
			Columns accept spreadsheet letters or one-based numbers. Invalid domains, blank rows, and
			duplicate emails are excluded.
		</p>
		<div class="preview-table">
			<table>
				<thead><tr><th>Email</th><th>Name</th></tr></thead>
				<tbody>
					{#each importPreview.slice(0, 100) as entry}
						<tr><td>{entry.email}</td><td>{entry.display_name || '—'}</td></tr>
					{/each}
				</tbody>
			</table>
			{#if importPreview.length === 0}<div class="empty">
					Select the email column to preview valid rows.
				</div>{/if}
		</div>
		{#if importPreview.length > 100}<p class="import-help">
				Showing the first 100 of {importPreview.length} valid rows.
			</p>{/if}
		<footer>
			<button type="button" class="cancel" onclick={closeImporter}>Cancel</button>
			<button
				class="save"
				disabled={importing || importPreview.length === 0}
				onclick={importWhitelist}
			>
				{importing
					? 'Importing…'
					: `Import ${importPreview.length} account${importPreview.length === 1 ? '' : 's'}`}
			</button>
		</footer>
	</aside>
{/if}

{#if editorOpen}
	<button class="scrim" aria-label="Close editor" onclick={closeEditor}></button>
	<aside
		class="editor"
		aria-label={editingId ? 'Edit event' : 'Create event'}
		transition:fly={{ x: 30, duration: 260 }}
	>
		<header>
			<div>
				<p class="kicker">{editingId ? 'Update record' : 'Create record'}</p>
				<h2>{editingId ? 'Edit event' : 'New event'}</h2>
			</div>
			<button class="close" type="button" onclick={closeEditor}
				><MdiIcon path={mdiClose} size={20} /></button
			>
		</header>
		<form
			onsubmit={(event) => {
				event.preventDefault();
				saveEvent();
			}}
		>
			<label class="wide"><span>Name</span><input bind:value={draft.task_name} required /></label>
			<label class="wide"
				><span>Description</span><textarea rows="4" bind:value={draft.description}
				></textarea></label
			>
			<label
				><span>Owner</span><select bind:value={draft.owner_id}
					>{#each data.users as user}<option value={user.id}>{user.name}</option>{/each}</select
				></label
			>
			<label
				><span>Status</span><select bind:value={draft.status}
					><option value="todo">To do</option><option value="progress">In progress</option><option
						value="completed">Completed</option
					><option value="cancelled">Cancelled</option></select
				></label
			>
			<label
				><span>Starts</span><input
					type="datetime-local"
					bind:value={draft.start_at}
					required
				/></label
			>
			<label
				><span>Ends</span><input type="datetime-local" bind:value={draft.end_at} required /></label
			>
			<label><span>Priority</span><input type="number" bind:value={draft.importance_value} /></label
			>
			<label><span>Color</span><input class="color" type="color" bind:value={draft.color} /></label>
			<label class="check wide"
				><input type="checkbox" bind:checked={draft.all_day} /><span>All-day event</span></label
			>
			{#if formError}<p class="form-error wide">{formError}</p>{/if}
			<footer class="wide">
				<button type="button" class="cancel" onclick={closeEditor}>Cancel</button><button
					class="save"
					disabled={busyId === 'editor'}
					>{busyId === 'editor' ? 'Saving…' : editingId ? 'Save changes' : 'Create event'}</button
				>
			</footer>
		</form>
	</aside>
{/if}

<style>
	:global(body) {
		background: #f8fafd;
	}
	.admin-shell {
		height: 100%;
		min-height: 100%;
		overflow-y: auto;
		padding: 24px clamp(18px, 4vw, 64px) 52px;
		color: #1f1f1f;
		background: #f8fafd;
		font-family: 'Google Sans', Roboto, 'Segoe UI', sans-serif;
	}
	.masthead {
		display: flex;
		align-items: center;
		gap: 14px;
		max-width: 1440px;
		margin: auto;
	}
	.back,
	.mark,
	.close {
		display: grid;
		place-items: center;
		border: 0;
		border-radius: 50%;
	}
	.back {
		width: 40px;
		height: 40px;
		color: #444746;
		background: transparent;
		transition: background 160ms ease;
	}
	.back:hover,
	.close:hover {
		background: #e9eef6;
	}
	.mark {
		width: 44px;
		height: 44px;
		color: #0b57d0;
		background: #c2e7ff;
	}
	.kicker {
		margin: 0 0 3px;
		color: #5f6368;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.16em;
		text-transform: uppercase;
	}
	h1,
	h2 {
		margin: 0;
		font-family: 'Google Sans', Roboto, 'Segoe UI', sans-serif;
		font-weight: 400;
		letter-spacing: -0.01em;
	}
	h1 {
		font-size: clamp(24px, 3vw, 32px);
	}
	.create {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 40px;
		padding: 0 18px;
		border: 0;
		border-radius: 999px;
		color: white;
		background: #0b57d0;
		box-shadow: 0 1px 2px rgb(60 64 67 / 30%);
		font-weight: 500;
		cursor: pointer;
		transition:
			background 160ms ease,
			box-shadow 160ms ease;
	}
	.create:hover {
		background: #0842a0;
		box-shadow: 0 2px 6px rgb(60 64 67 / 32%);
	}
	.metrics {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 12px;
		max-width: 1440px;
		margin: 24px auto 14px;
	}
	.metrics div {
		display: flex;
		align-items: baseline;
		gap: 10px;
		padding: 17px 20px;
		border: 1px solid #e1e3e1;
		border-radius: 16px;
		background: #fff;
	}
	.metrics strong {
		color: #1f1f1f;
		font-size: 28px;
		font-weight: 400;
		font-variant-numeric: tabular-nums;
	}
	.metrics span {
		color: #5f6368;
		font-size: 12px;
	}
	.metrics .danger strong {
		color: #b3261e;
	}
	.access-panel {
		max-width: 1440px;
		margin: 0 auto 16px;
		border: 1px solid #e1e3e1;
		border-radius: 16px;
		overflow: hidden;
		background: #fff;
		box-shadow: 0 1px 2px rgb(60 64 67 / 8%);
	}
	.access-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 20px;
		padding: 16px 18px;
		border-bottom: 1px solid #e8eaed;
	}
	.access-head h2 {
		font-size: 19px;
	}
	.access-toggle {
		display: flex;
		align-items: center;
		gap: 9px;
		color: #1f1f1f;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
	}
	.access-toggle input {
		width: 18px;
		height: 18px;
		accent-color: #0b57d0;
	}
	.access-copy {
		padding: 12px 18px;
		color: #444746;
		background: #f8fafd;
		font-size: 12px;
	}
	.whitelist-form {
		display: grid;
		grid-template-columns: minmax(220px, 1fr) minmax(180px, 0.8fr) auto auto auto;
		align-items: end;
		gap: 10px;
		padding: 14px 18px;
		border-top: 1px solid #eef0f1;
		border-bottom: 1px solid #e8eaed;
	}
	.whitelist-form label,
	.import-grid label {
		display: grid;
		gap: 5px;
	}
	.whitelist-form label > span,
	.import-grid label > span {
		color: #444746;
		font-size: 10px;
		font-weight: 600;
	}
	.whitelist-form input,
	.import-grid input,
	.import-grid select {
		width: 100%;
		min-height: 40px;
		border: 1px solid #c4c7c5;
		border-radius: 8px;
		background: #fff;
		color: #1f1f1f;
		font: inherit;
	}
	.whitelist-form input:focus,
	.import-grid input:focus,
	.import-grid select:focus {
		border-color: #0b57d0;
		box-shadow: 0 0 0 1px #0b57d0;
		outline: 0;
	}
	.access-save,
	.import-button,
	.access-cancel {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 7px;
		min-height: 40px;
		padding: 0 14px;
		border: 0;
		border-radius: 999px;
		font-weight: 500;
		white-space: nowrap;
		cursor: pointer;
	}
	.import-button {
		color: #0b57d0;
		background: #e8f0fe;
	}
	.access-cancel {
		background: transparent;
	}
	.access-error {
		margin: 12px 18px;
		padding: 10px 12px;
		border-radius: 8px;
		color: #b3261e;
		background: #fce8e6;
		font-size: 12px;
	}
	.whitelist-table {
		max-height: 350px;
		overflow-y: auto;
	}
	.account {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-weight: 500;
	}
	.workspace {
		max-width: 1440px;
		margin: auto;
		border: 1px solid #e1e3e1;
		border-radius: 16px;
		overflow: hidden;
		background: #fff;
		box-shadow: 0 1px 2px rgb(60 64 67 / 8%);
	}
	.controls {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 14px;
		border-bottom: 1px solid #e1e3e1;
	}
	.search {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1;
		max-width: 520px;
		min-height: 44px;
		padding: 0 14px;
		border: 1px solid transparent;
		border-radius: 999px;
		color: #444746;
		background: #f0f4f9;
		transition:
			background 160ms ease,
			border-color 160ms ease;
	}
	.search:focus-within {
		border-color: #0b57d0;
		background: #fff;
	}
	.search input {
		width: 100%;
		border: 0;
		background: transparent;
		box-shadow: none;
		color: #1f1f1f;
		font-size: 13px;
		outline: 0;
	}
	.scope {
		display: flex;
		gap: 0;
		margin-left: auto;
		padding: 0;
		border: 1px solid #c4c7c5;
		border-radius: 999px;
		overflow: hidden;
		background: #fff;
	}
	.scope button {
		border: 0;
		border-right: 1px solid #c4c7c5;
		padding: 9px 15px;
		border-radius: 0;
		background: transparent;
		color: #444746;
		text-transform: capitalize;
		cursor: pointer;
		transition: background 160ms ease;
	}
	.scope button:last-child {
		border-right: 0;
	}
	.scope button:hover:not(.active) {
		background: #f0f4f9;
	}
	.scope button.active {
		background: #c2e7ff;
		color: #001d35;
		box-shadow: none;
		font-weight: 500;
	}
	.table-wrap {
		overflow-x: auto;
	}
	table {
		width: 100%;
		border-collapse: collapse;
	}
	th {
		padding: 12px 16px;
		color: #5f6368;
		background: #f8fafd;
		font-size: 10px;
		letter-spacing: 0.1em;
		text-align: left;
		text-transform: uppercase;
	}
	td {
		padding: 14px 16px;
		border-top: 1px solid #e8eaed;
		font-size: 13px;
		vertical-align: middle;
	}
	tr {
		animation: row-in 300ms ease both;
	}
	tr.deleted {
		opacity: 0.62;
		background: #fce8e6;
	}
	tbody tr:not(.deleted):hover {
		background: #f8fafd;
	}
	td small,
	td time {
		display: block;
	}
	td small {
		max-width: 340px;
		margin-top: 3px;
		overflow: hidden;
		color: #5f6368;
		font-size: 11px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.event-name {
		display: flex;
		align-items: center;
		gap: 9px;
		font-weight: 500;
	}
	.event-name i {
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}
	.status {
		display: inline-flex;
		padding: 4px 8px;
		border-radius: 999px;
		background: #f0f4f9;
		color: #444746;
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
	}
	.status[data-status='completed'] {
		color: #0d652d;
		background: #e6f4ea;
	}
	.status[data-status='cancelled'] {
		color: #b3261e;
		background: #fce8e6;
	}
	.boolean {
		display: inline-flex;
		min-width: 42px;
		justify-content: center;
		padding: 4px 8px;
		border-radius: 999px;
		color: #5f6368;
		background: #f0f4f9;
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
	}
	.boolean.on {
		color: #0d652d;
		background: #e6f4ea;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 5px;
	}
	.actions button,
	.close {
		width: 36px;
		height: 36px;
		border: 0;
		border-radius: 50%;
		color: #444746;
		background: transparent;
		cursor: pointer;
		transition: background 160ms ease;
	}
	.actions button:hover {
		background: #f0f4f9;
	}
	.actions .delete {
		color: #b3261e;
		background: transparent;
	}
	.actions .delete:hover {
		background: #fce8e6;
	}
	.actions button:disabled {
		opacity: 0.45;
	}
	.empty {
		padding: 56px;
		color: #5f6368;
		text-align: center;
	}
	.audit-log {
		max-width: 1440px;
		margin: 16px auto 0;
		border: 1px solid #e1e3e1;
		border-radius: 16px;
		overflow: hidden;
		background: #fff;
	}
	.audit-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 16px 18px;
		border-bottom: 1px solid #e8eaed;
	}
	.audit-title {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.audit-title h2 {
		font-size: 19px;
	}
	.audit-mark {
		display: grid;
		place-items: center;
		width: 38px;
		height: 38px;
		border-radius: 50%;
		color: #0b57d0;
		background: #e8f0fe;
	}
	.audit-count {
		padding: 6px 10px;
		border-radius: 999px;
		color: #444746;
		background: #f0f4f9;
		font-size: 11px;
	}
	.audit-list {
		max-height: 430px;
		margin: 0;
		padding: 0;
		overflow-y: auto;
		list-style: none;
	}
	.audit-list li {
		display: grid;
		grid-template-columns: 36px minmax(0, 1fr) auto;
		align-items: center;
		gap: 12px;
		padding: 13px 18px;
		border-top: 1px solid #f0f1f2;
		animation: row-in 300ms ease both;
	}
	.audit-list li:first-child {
		border-top: 0;
	}
	.audit-list li:hover {
		background: #f8fafd;
	}
	.audit-icon {
		display: grid;
		place-items: center;
		width: 34px;
		height: 34px;
		border-radius: 50%;
		color: #0b57d0;
		background: #e8f0fe;
	}
	.audit-icon[data-action='delete'] {
		color: #b3261e;
		background: #fce8e6;
	}
	.audit-icon[data-action='restore'] {
		color: #0d652d;
		background: #e6f4ea;
	}
	.audit-copy,
	.audit-meta {
		display: grid;
		gap: 3px;
	}
	.audit-copy {
		min-width: 0;
		font-size: 13px;
	}
	.audit-copy strong {
		font-weight: 600;
	}
	.audit-copy small {
		overflow: hidden;
		color: #5f6368;
		font-size: 11px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.audit-meta {
		justify-items: end;
	}
	.audit-meta time {
		color: #5f6368;
		font-size: 10px;
		white-space: nowrap;
	}
	.audit-action {
		padding: 3px 8px;
		border-radius: 999px;
		color: #0842a0;
		background: #e8f0fe;
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	.audit-action[data-action='delete'] {
		color: #b3261e;
		background: #fce8e6;
	}
	.audit-action[data-action='restore'] {
		color: #0d652d;
		background: #e6f4ea;
	}
	.audit-empty {
		padding: 42px 18px;
		color: #5f6368;
		font-size: 13px;
		text-align: center;
	}
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 80;
		border: 0;
		background: rgb(32 33 36 / 42%);
		backdrop-filter: blur(2px);
	}
	.editor {
		position: fixed;
		z-index: 90;
		inset: 12px 12px 12px auto;
		width: min(540px, calc(100vw - 24px));
		padding: 26px;
		overflow-y: auto;
		border: 1px solid #e1e3e1;
		border-radius: 24px;
		background: #fff;
		box-shadow: 0 8px 30px rgb(60 64 67 / 28%);
	}
	.editor header {
		display: flex;
		justify-content: space-between;
		align-items: start;
		margin-bottom: 24px;
	}
	.editor h2 {
		font-size: 26px;
	}
	.editor form {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 15px;
	}
	.editor label {
		display: grid;
		gap: 6px;
	}
	.editor label > span {
		color: #444746;
		font-size: 11px;
		font-weight: 500;
	}
	.editor input,
	.editor textarea,
	.editor select {
		width: 100%;
		border: 1px solid #c4c7c5;
		border-radius: 8px;
		background: white;
		color: #1f1f1f;
		font: inherit;
		transition:
			border-color 160ms ease,
			box-shadow 160ms ease;
	}
	.editor input:focus,
	.editor textarea:focus,
	.editor select:focus {
		border-color: #0b57d0;
		box-shadow: 0 0 0 1px #0b57d0;
		outline: 0;
	}
	.editor .wide {
		grid-column: 1 / -1;
	}
	.editor .color {
		min-height: 42px;
		padding: 5px;
	}
	.editor .check {
		display: flex;
		align-items: center;
		grid-template-columns: auto 1fr;
	}
	.editor .check input {
		width: auto;
	}
	.editor footer {
		display: flex;
		justify-content: flex-end;
		gap: 9px;
		margin-top: 8px;
	}
	.importer {
		width: min(660px, calc(100vw - 24px));
	}
	.import-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 14px;
	}
	.import-grid .wide {
		grid-column: 1 / -1;
	}
	.import-help {
		margin: 14px 0;
		color: #5f6368;
		font-size: 11px;
		line-height: 1.5;
	}
	.preview-table {
		max-height: 420px;
		overflow: auto;
		border: 1px solid #e1e3e1;
		border-radius: 12px;
	}
	.importer footer {
		display: flex;
		justify-content: flex-end;
		gap: 9px;
		margin-top: 18px;
	}
	.editor footer button {
		min-height: 40px;
		padding: 0 18px;
		border: 0;
		border-radius: 999px;
		font-weight: 500;
		cursor: pointer;
	}
	.cancel {
		background: transparent;
		color: #0b57d0;
	}
	.cancel:hover {
		background: #e8f0fe;
	}
	.save {
		background: #0b57d0;
		color: white;
	}
	.save:hover:not(:disabled) {
		background: #0842a0;
	}
	.save:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.form-error {
		margin: 0;
		padding: 10px;
		border-radius: 8px;
		color: #b3261e;
		background: #fce8e6;
		font-size: 12px;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
	}
	@keyframes row-in {
		from {
			opacity: 0;
			transform: translateY(5px);
		}
	}
	@media (max-width: 700px) {
		.admin-shell {
			padding: 16px 10px 40px;
		}
		.masthead .mark {
			display: none;
		}
		.create {
			padding: 10px;
		}
		.metrics {
			grid-template-columns: 1fr 1fr 1fr;
		}
		.metrics div {
			display: grid;
			padding: 12px;
		}
		.controls {
			align-items: stretch;
			flex-direction: column;
		}
		.access-head {
			align-items: flex-start;
			flex-direction: column;
		}
		.whitelist-form {
			grid-template-columns: 1fr;
		}
		.import-grid {
			grid-template-columns: 1fr;
		}
		.import-grid > * {
			grid-column: 1;
		}
		.scope {
			margin: 0;
		}
		.scope button {
			flex: 1;
		}
		.audit-head {
			align-items: flex-start;
		}
		.audit-count {
			display: none;
		}
		.audit-list li {
			grid-template-columns: 34px minmax(0, 1fr);
			padding: 12px;
		}
		.audit-meta {
			grid-column: 2;
			grid-template-columns: auto 1fr;
			justify-items: start;
			align-items: center;
		}
		.editor form {
			grid-template-columns: 1fr;
		}
		.editor form > * {
			grid-column: 1;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		tr {
			animation: none;
		}
	}
</style>
