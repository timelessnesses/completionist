<script lang="ts">
	import { prettyDate, toDateKey as toKey } from '$lib/features/calendar/date';
	import type { RichTask } from '$lib/features/tasks/types';
	import MdiIcon from './MdiIcon.svelte';
	import {
		mdiAccountCheckOutline,
		mdiChevronDown,
		mdiChevronRight,
		mdiFolderOutline,
		mdiPlayCircleOutline
	} from '@mdi/js';

	const {
		events,
		upcoming,
		running = [],
		assigned = [],
		late = [],
		currentTime = Date.now(),
		onSelectEvent
	}: {
		events: RichTask[];
		upcoming: RichTask[];
		running?: RichTask[];
		assigned?: RichTask[];
		late?: RichTask[];
		currentTime?: number;
		onSelectEvent?: (event: RichTask) => void;
	} = $props();

	type ListKind = 'running' | 'late' | 'upcoming';
	type ListEntry =
		| { key: string; project: RichTask; tasks: RichTask[] }
		| { key: string; project: null; tasks: [RichTask] };
	const eventMap = $derived.by(() => new Map(events.map((event) => [event.id, event])));
	let foldedProjects = $state(new Set<string>());

	function parentProject(event: RichTask): RichTask | null {
		let parentId = event.parent;
		const visited = new Set<string>();
		while (parentId && !visited.has(parentId)) {
			visited.add(parentId);
			const parent = eventMap.get(parentId);
			if (!parent) return null;
			return parent;
		}
		return null;
	}

	function listEntries(tasks: RichTask[], limit?: number): ListEntry[] {
		const visible = limit ? tasks.slice(0, limit) : tasks;
		const groupedProjectIds = new Set(
			visible
				.map(parentProject)
				.filter((project): project is RichTask => !!project)
				.map((project) => project.id)
		);
		const entries: ListEntry[] = [];
		const groups = new Map<string, Extract<ListEntry, { project: RichTask }>>();

		for (const task of visible) {
			const project = parentProject(task);
			const groupProject = project ?? (groupedProjectIds.has(task.id) ? task : null);
			if (!groupProject) {
				entries.push({ key: `task:${task.id}`, project: null, tasks: [task] });
				continue;
			}

			let group = groups.get(groupProject.id);
			if (!group) {
				group = { key: `project:${groupProject.id}`, project: groupProject, tasks: [] };
				groups.set(groupProject.id, group);
				entries.push(group);
			}
			if (task.id !== groupProject.id) group.tasks.push(task);
		}
		return entries;
	}

	function foldKey(kind: ListKind, projectId: string): string {
		return `${kind}:${projectId}`;
	}

	function toggleProject(kind: ListKind, projectId: string) {
		const key = foldKey(kind, projectId);
		const next = new Set(foldedProjects);
		next.has(key) ? next.delete(key) : next.add(key);
		foldedProjects = next;
	}

	function timeLabel(d: Date): string {
		return `${d.getHours()}:${`${d.getMinutes()}`.padStart(2, '0')}`;
	}

	function timeRemaining(end: Date): string {
		const minutes = Math.max(1, Math.ceil((end.getTime() - currentTime) / 60_000));
		if (minutes < 60) return `${minutes}m left`;
		const hours = Math.floor(minutes / 60);
		const remainder = minutes % 60;
		if (hours < 24) return `${hours}h${remainder ? ` ${remainder}m` : ''} left`;
		return `${Math.ceil(hours / 24)}d left`;
	}

	function itemWhen(event: RichTask, kind: ListKind): string {
		if (kind === 'running') {
			const end = new Date(event.end_at);
			return `${timeRemaining(end)} · ends ${timeLabel(end)}`;
		}
		const date = new Date(kind === 'late' ? event.end_at : event.start_at);
		return `${kind === 'late' ? 'Due ' : ''}${prettyDate(toKey(date))}${event.all_day ? '' : `, ${timeLabel(date)}`}`;
	}
</script>

{#snippet taskCard(event: RichTask, index: number, kind: ListKind)}
	<button
		class="card"
		class:running-card={kind === 'running'}
		class:late-card={kind === 'late'}
		style:--item-index={index}
		aria-label={`${kind} task: ${event.task_name}`}
		onclick={() => onSelectEvent?.(event)}
	>
		<span
			class="bar"
			style:background={kind === 'late'
				? '#d93025'
				: kind === 'running'
					? `rgb(${event.color.r}, ${event.color.g}, ${event.color.b})`
					: `rgba(${event.color.r}, ${event.color.g}, ${event.color.b}, 0.15)`}
		></span>
		<span class="body">
			<span class="title-row">
				<span class="title">{event.task_name}</span>
				{#if kind === 'running'}<span class="live-dot" aria-hidden="true"></span>{/if}
			</span>
			<span class="when" class:running-time={kind === 'running'}>{itemWhen(event, kind)}</span>
		</span>
	</button>
{/snippet}

{#snippet groupedTasks(tasks: RichTask[], kind: ListKind, limit?: number)}
	{#each listEntries(tasks, limit) as entry, index (entry.key)}
		{#if entry.project}
			{@const key = foldKey(kind, entry.project.id)}
			<div class="project-group">
				<div class="project-header">
					<button
						class="fold"
						type="button"
						aria-label={foldedProjects.has(key) ? 'Expand project tasks' : 'Collapse project tasks'}
						aria-expanded={!foldedProjects.has(key)}
						onclick={() => toggleProject(kind, entry.project.id)}
					>
						<MdiIcon path={foldedProjects.has(key) ? mdiChevronRight : mdiChevronDown} size={16} />
					</button>
					<button
						class="project-title"
						type="button"
						onclick={() => onSelectEvent?.(entry.project)}
					>
						<MdiIcon path={mdiFolderOutline} size={14} />
						<span>{entry.project.task_name}</span>
						<small>{entry.tasks.length}</small>
					</button>
				</div>
				{#if !foldedProjects.has(key)}
					<div class="project-children">
						{#each entry.tasks as event, childIndex (event.id)}
							{@render taskCard(event, index + childIndex, kind)}
						{/each}
					</div>
				{/if}
			</div>
		{:else}
			{@render taskCard(entry.tasks[0], index, kind)}
		{/if}
	{/each}
{/snippet}

<div class="upcoming">
	{#if running.length}
		<div class="upcoming-head running-head">
			<span class="section-label"
				><MdiIcon path={mdiPlayCircleOutline} size={15} /> RUNNING NOW</span
			>
			<span class="count">{running.length}</span>
		</div>
		{@render groupedTasks(running, 'running', 5)}
	{/if}

	{#if assigned.length}
		<div class="upcoming-head assigned-head">
			<span class="section-label"
				><MdiIcon path={mdiAccountCheckOutline} size={15} /> ASSIGNED TO YOU</span
			>
			<span class="count">{assigned.length}</span>
		</div>
		{#each assigned.slice(0, 5) as ev, index (ev.id)}
			{@const start = new Date(ev.start_at)}
			{@const hasStarted = start.getTime() <= currentTime}
			<button
				class="card assigned-card"
				style:--item-index={index}
				aria-label={`Assigned task: ${ev.task_name}`}
				onclick={() => onSelectEvent?.(ev)}
			>
				<span class="bar" style:background={`rgb(${ev.color.r}, ${ev.color.g}, ${ev.color.b})`}
				></span>
				<span class="body">
					<span class="title">{ev.task_name}</span>
					<span class="when">
						{hasStarted
							? 'In progress'
							: `${prettyDate(toKey(start))}${ev.all_day ? '' : `, ${timeLabel(start)}`}`}
					</span>
				</span>
			</button>
		{/each}
	{/if}

	{#if late.length}
		<div class="upcoming-head late-head">
			<span>LATE / UNCOMPLETED</span>
			<span class="count">{late.length}</span>
		</div>
		{@render groupedTasks(late, 'late', 5)}
	{/if}

	<div class="upcoming-head">
		<span>UPCOMING EVENTS</span>
		<span class="count">{upcoming.length} total</span>
	</div>

	{@render groupedTasks(upcoming, 'upcoming')}
</div>

<style>
	.upcoming {
		padding: 16px 16px 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.upcoming-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.4px;
		/* color: #444746; */
	}
	.section-label {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}
	.running-head {
		color: #137333;
	}
	.assigned-head {
		color: #0b57d0;
		margin-top: 2px;
	}
	.count {
		font-weight: 400;
		/* color: #747775; */
	}
	.project-group {
		display: grid;
		gap: 6px;
	}
	.project-header {
		display: grid;
		grid-template-columns: 28px minmax(0, 1fr);
		align-items: center;
		min-width: 0;
	}
	.fold,
	.project-title {
		border: 0;
		background: transparent;
		color: var(--color-foreground);
		cursor: pointer;
	}
	.fold {
		display: grid;
		width: 28px;
		height: 28px;
		place-items: center;
		border-radius: 50%;
	}
	.fold:hover {
		background: var(--color-muted);
	}
	.project-title {
		display: grid;
		grid-template-columns: 16px minmax(0, 1fr) auto;
		align-items: center;
		gap: 6px;
		padding: 5px 7px;
		border-radius: 8px;
		text-align: left;
		font-size: 12px;
		font-weight: 700;
	}
	.project-title:hover {
		background: var(--color-muted);
	}
	.project-title span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.project-title small {
		min-width: 19px;
		padding: 2px 5px;
		border-radius: 999px;
		background: var(--color-muted);
		text-align: center;
		font-size: 9px;
		font-weight: 600;
	}
	.project-children {
		display: grid;
		gap: 8px;
		margin-left: 14px;
		padding-left: 12px;
		border-left: 1px solid #d7dce2;
	}
	.card {
		display: flex;
		align-items: stretch;
		gap: 12px;
		border: 1px solid #e1e3e1;
		border-radius: 12px;
		background: #fff;
		padding: 10px 12px;
		cursor: pointer;
		text-align: left;
		animation: list-rise 320ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
		animation-delay: calc(var(--item-index) * 34ms);
	}
	.late-head {
		color: #b3261e;
		margin-top: 2px;
	}
	.late-card {
		border-color: color-mix(in srgb, #d93025 28%, #e1e3e1);
	}
	.late-card .bar {
		background: #d93025;
	}
	.late-card .when {
		color: #b3261e;
	}
	.running-card {
		border-color: color-mix(in srgb, #137333 28%, #e1e3e1);
		background: color-mix(in srgb, #e6f4ea 42%, #fff);
	}
	.assigned-card {
		border-color: color-mix(in srgb, #0b57d0 22%, #e1e3e1);
	}
	.title-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}
	.live-dot {
		width: 7px;
		height: 7px;
		flex: 0 0 auto;
		border-radius: 50%;
		background: #1e8e3e;
		box-shadow: 0 0 0 0 rgba(30, 142, 62, 0.35);
		animation: live-pulse 1.8s ease-out infinite;
	}
	.running-time {
		color: #137333;
		font-weight: 500;
	}
	@keyframes live-pulse {
		70% {
			box-shadow: 0 0 0 6px rgba(30, 142, 62, 0);
		}
		100% {
			box-shadow: 0 0 0 0 rgba(30, 142, 62, 0);
		}
	}
	@keyframes list-rise {
		from {
			opacity: 0;
			transform: translateY(7px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.card,
		.live-dot {
			animation: none;
		}
	}
	.card:hover {
		background: #f8fafd;
	}
	.bar {
		width: 4px;
		border-radius: 2px;
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		flex: 1;
	}
	.title {
		font-size: 13px;
		font-weight: 600;
		color: #1f1f1f;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.when {
		font-size: 12px;
		color: #444746;
	}
</style>
