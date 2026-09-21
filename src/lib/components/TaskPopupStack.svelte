<script lang="ts">
	import EventDialog from './EventDialog.svelte';
	import ProjectHierarchy from './ProjectHierarchy.svelte';
	import { createTaskPopup, type TaskPopup } from '$lib/features/navigation/task-popup';
	import type { RichTask, UserSummary, FilterTag } from '$lib/features/tasks/types';

	let {
		entries = $bindable([]),
		tasks,
		users,
		tags,
		viewerId,
		isAdmin,
		onupdated,
		ondeleted
	}: {
		entries?: TaskPopup[];
		tasks: RichTask[];
		users: UserSummary[];
		tags: FilterTag[];
		viewerId: string | null;
		isAdmin: boolean;
		onupdated: (task: RichTask) => void;
		ondeleted: (id: string) => void;
	} = $props();
	const taskMap = $derived(new Map(tasks.map((task) => [task.id, task])));

	$effect(() => {
		const available = entries.filter(
			(entry) => entry.kind !== 'event' || taskMap.has(entry.taskId)
		);
		if (available.length !== entries.length) entries = available;
	});

	function close(key: string) {
		const index = entries.findIndex((entry) => entry.key === key);
		if (index >= 0) entries = entries.slice(0, index);
	}

	function open(kind: TaskPopup['kind'], task: RichTask) {
		entries = [...entries, createTaskPopup(kind, task.id)];
	}
</script>

{#each entries as entry, index (entry.key)}
	{@const active = index === entries.length - 1}
	{@const task = taskMap.get(entry.taskId)}
	<!-- Keep earlier views mounted to preserve drafts, scroll position, zoom and branch state. -->
	<div hidden={!active} inert={!active}>
		{#if entry.kind === 'event' && task}
			<EventDialog
				open={true}
				event={task}
				canEdit={isAdmin || (!!viewerId && task.owner === viewerId)}
				canComplete={isAdmin ||
					(!!viewerId &&
						(task.owner === viewerId ||
							(task.assignees ?? []).some((link) => link.user_id === viewerId)))}
				{tasks}
				{users}
				{tags}
				{onupdated}
				{ondeleted}
				onclose={() => close(entry.key)}
				onHierarchy={(task) => open('hierarchy', task)}
			/>
		{:else if entry.kind === 'hierarchy'}
			<ProjectHierarchy
				{tasks}
				{users}
				{active}
				initialRoot={entry.taskId}
				onclose={() => close(entry.key)}
				onselect={(task) => open('event', task)}
			/>
		{/if}
	</div>
{/each}
