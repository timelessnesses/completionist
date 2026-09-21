<script lang="ts">
	import { onDestroy, tick, untrack } from 'svelte';
	import { backDismiss, createBackActions } from '$lib/back-dismiss';
	import {
		buildHierarchy,
		compareHierarchyTime,
		CARD_HEIGHT,
		CARD_WIDTH,
		taskStatus
	} from '$lib/features/tasks/hierarchy';
	import { colorToHex } from '$lib/features/tasks/color';
	import type { RichTask, UserSummary } from '$lib/features/tasks/types';
	import MdiIcon from './MdiIcon.svelte';
	import {
		mdiClose,
		mdiMinus,
		mdiPlus,
		mdiFitToScreenOutline,
		mdiFileTreeOutline,
		mdiChevronRight,
		mdiChevronDown
	} from '@mdi/js';

	let {
		tasks,
		users = [],
		initialRoot = '',
		active = true,
		onclose,
		onselect
	}: {
		tasks: RichTask[];
		users?: UserSummary[];
		initialRoot?: string;
		active?: boolean;
		onclose: () => void;
		onselect: (task: RichTask) => void;
	} = $props();
	let root = $state(untrack(() => initialRoot));
	const titleId = $props.id();
	let collapsed = $state(new Set<string>());
	let zoom = $state(1);
	let viewport: HTMLDivElement;
	let dialogElement = $state<HTMLDialogElement>();
	const actions = createBackActions();
	onDestroy(() => actions.clear());
	$effect(() => {
		if (!dialogElement) return;
		if (active && !dialogElement.open) dialogElement.showModal();
		else if (!active && dialogElement.open) dialogElement.close();
	});
	const graph = $derived(buildHierarchy(tasks, root, collapsed));
	const nodeMap = $derived(new Map(graph.nodes.map((node) => [node.task.id, node])));
	const userMap = $derived(new Map(users.map((user) => [user.id, user])));
	const choices = $derived(
		[...tasks].filter((task) => !task.deleted_at).sort(compareHierarchyTime)
	);
	const selected = $derived(tasks.find((task) => task.id === root));
	function mountDialog(dialog: HTMLDialogElement) {
		const previous = document.activeElement;
		dialogElement = dialog;
		void resetView();
		return {
			destroy() {
				dialog.close();
				queueMicrotask(() => {
					if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
				});
			}
		};
	}
	function changeRoot(next: string) {
		if (next === root) return;
		const previous = {
			root,
			collapsed: new Set(collapsed),
			zoom,
			left: viewport.scrollLeft,
			top: viewport.scrollTop
		};
		actions.remember(async () => {
			root = previous.root;
			collapsed = previous.collapsed;
			zoom = previous.zoom;
			await tick();
			viewport?.scrollTo(previous.left, previous.top);
		});
		root = next;
		void resetView();
	}
	function toggle(id: string) {
		const next = new Set(collapsed);
		next.has(id) ? next.delete(id) : next.add(id);
		collapsed = next;
	}
	async function resetView() {
		collapsed = new Set();
		await tick();
		zoom = 1;
		await tick();
		const first = graph.nodes.find((node) => node.task.id === root) ?? graph.nodes[0];
		viewport?.scrollTo(0, Math.max(0, (first?.y ?? 32) - 32));
	}
	function fit() {
		zoom = Math.max(
			0.2,
			Math.min(
				1,
				(viewport.clientWidth - 16) / graph.width,
				(viewport.clientHeight - 16) / graph.height
			)
		);
		viewport.scrollTo(0, 0);
	}
	async function changeZoom(value: number) {
		const old = zoom;
		const centerX = (viewport.scrollLeft + viewport.clientWidth / 2) / old;
		const centerY = (viewport.scrollTop + viewport.clientHeight / 2) / old;
		zoom = Math.max(0.2, Math.min(1.5, value));
		await tick();
		viewport.scrollTo(
			centerX * zoom - viewport.clientWidth / 2,
			centerY * zoom - viewport.clientHeight / 2
		);
	}
</script>

<dialog
	class="hierarchy"
	use:mountDialog
	use:backDismiss={onclose}
	oncancel={(event) => {
		event.preventDefault();
		onclose();
	}}
	aria-labelledby={titleId}
>
	<header>
		<div class="heading">
			<span class="mark"><MdiIcon path={mdiFileTreeOutline} size={24} /></span>
			<div>
				<p class="eyebrow">PROJECT MAP</p>
				<h2 id={titleId}>Hierarchy</h2>
			</div>
		</div>
		<button class="icon" aria-label="Close hierarchy" onclick={onclose}
			><MdiIcon path={mdiClose} size={22} /></button
		>
	</header>
	<div class="toolbar">
		<label class="scope"
			><span>Explore</span><select
				value={root}
				onchange={(event) => changeRoot(event.currentTarget.value)}
				><option value="">All calendar tasks</option>{#each choices as task (task.id)}<option
						value={task.id}>{task.task_name}</option
					>{/each}</select
			></label
		>
		<div class="zoom">
			<button
				class="icon"
				aria-label="Zoom out"
				disabled={zoom <= 0.2}
				onclick={() => changeZoom(zoom - 0.1)}><MdiIcon path={mdiMinus} size={18} /></button
			><output aria-label="Zoom level">{Math.round(zoom * 100)}%</output><button
				class="icon"
				aria-label="Zoom in"
				disabled={zoom >= 1.5}
				onclick={() => changeZoom(zoom + 0.1)}><MdiIcon path={mdiPlus} size={18} /></button
			><button class="fit" onclick={fit}
				><MdiIcon path={mdiFitToScreenOutline} size={18} /> Fit</button
			>
		</div>
	</div>
	<div class="overview">
		<strong>{selected?.task_name ?? 'Your calendar, connected'}</strong><span
			>{graph.nodes.length} of {graph.total} tasks visible</span
		><button onclick={resetView}>Expand all · reset</button>
	</div>
	<!-- svelte-ignore a11y_no_noninteractive_tabindex (The scrollable graph must support keyboard scrolling.) -->
	<div
		class="viewport"
		bind:this={viewport}
		tabindex="0"
		role="region"
		aria-label="Project hierarchy. Scroll to explore; use the zoom controls to resize."
	>
		{#if !graph.nodes.length}<div class="empty">
				<MdiIcon path={mdiFileTreeOutline} size={40} />
				<h3>{root ? 'This task is no longer available' : 'A place for the bigger picture'}</h3>
				<p>
					{root
						? 'Choose another task or view all calendar tasks.'
						: 'Create calendar tasks and link subtasks to see their hierarchy here.'}
				</p>
			</div>{:else}
			<div
				class="extent"
				style:width={`${graph.width * zoom}px`}
				style:height={`${graph.height * zoom}px`}
			>
				<div
					class="canvas"
					style:width={`${graph.width}px`}
					style:height={`${graph.height}px`}
					style:transform={`scale(${zoom})`}
				>
					<svg width={graph.width} height={graph.height} aria-hidden="true">
						{#each graph.edges as edge (`${edge.from}:${edge.to}`)}
							{@const from = nodeMap.get(edge.from)!}{@const to = nodeMap.get(edge.to)!}
							{@const x1 = from.x + CARD_WIDTH}{@const y1 = from.y + CARD_HEIGHT / 2}{@const x2 =
								to.x}{@const y2 = to.y + CARD_HEIGHT / 2}
							<path
								class:dependency={edge.kind === 'dependency'}
								d={`M ${x1} ${y1} C ${x1 + 44} ${y1}, ${x2 - 44} ${y2}, ${x2} ${y2}`}
							/>
							<circle cx={x2} cy={y2} r="3" />
						{/each}
					</svg>
					{#each graph.nodes as node (node.task.id)}
						{@const status = taskStatus(node.task)}{@const progress = graph.progress.get(
							node.task.id
						)!}
						<article
							class="node"
							style:left={`${node.x}px`}
							style:top={`${node.y}px`}
							style:--task-color={colorToHex(node.task.color)}
							style:width={`${CARD_WIDTH}px`}
							style:height={`${CARD_HEIGHT}px`}
							aria-label={node.task.task_name}
						>
							<div class="node-top">
								<span
									class="status"
									class:done={status === 'Completed'}
									class:active={status === 'In progress'}
									class:cancelled={status === 'Cancelled'}><i></i>{status}</span
								>{#if node.children}<button
										class="branch"
										aria-label={`${collapsed.has(node.task.id) ? 'Expand' : 'Collapse'} ${node.task.task_name}`}
										aria-expanded={!collapsed.has(node.task.id)}
										onclick={() => toggle(node.task.id)}
										>{node.children}<MdiIcon
											path={collapsed.has(node.task.id) ? mdiChevronRight : mdiChevronDown}
											size={16}
										/></button
									>{/if}
							</div>
							<div class="node-content">
								<button class="task-name" onclick={() => onselect(node.task)}
									>{node.task.task_name}<span aria-hidden="true"> ↗</span></button
								>
								<div class="assignees">
									{#each node.task.assignees ?? [] as link (link.user_id)}{@const person =
											userMap.get(link.user_id) ?? link.user}<span class="person"
											><span class="avatar" aria-hidden="true"
												>{(person?.name || '?').slice(0, 1).toUpperCase()}</span
											>{person?.name || 'Unknown assignee'}</span
										>{:else}<span class="unassigned">Unassigned</span>{/each}
								</div>
							</div>
							<div class="progress">
								<div>
									<span>{progress.completed}/{progress.total} complete</span><strong
										>{progress.percent}%</strong
									>
								</div>
								<progress
									max="100"
									value={progress.percent}
									aria-label={`${node.task.task_name} completion`}
								></progress>
							</div>
						</article>
					{/each}
				</div>
			</div>
		{/if}
	</div>
	<footer>
		<div class="legend">
			<span><i></i> Subtask</span><span><i class="dashed"></i> Dependency</span>
		</div>
		<p>
			Progress counts completed leaf tasks; cancelled tasks are excluded. Scroll to explore. Select
			a title for details.
		</p>
	</footer>
</dialog>

<style>
	.hierarchy {
		box-sizing: border-box;
		position: fixed;
		inset: 0;
		margin: auto;
		width: min(1280px, calc(100vw - 48px));
		height: min(860px, calc(100dvh - 48px));
		max-width: none;
		max-height: none;
		padding: 0;
		border: 1px solid var(--color-border);
		border-radius: 24px;
		background: var(--color-background);
		color: var(--color-foreground);
		box-shadow: 0 24px 90px #0003;
		overflow: hidden;
	}
	.hierarchy[open] {
		display: flex;
		flex-direction: column;
	}
	.hierarchy::backdrop {
		background: #101b3659;
		backdrop-filter: blur(5px);
	}
	header,
	.toolbar,
	.overview,
	footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 18px 24px;
	}
	header {
		padding-bottom: 14px;
	}
	.heading,
	.zoom,
	.fit,
	.legend,
	.legend span {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.mark {
		display: grid;
		place-items: center;
		width: 46px;
		height: 46px;
		background: color-mix(in srgb, var(--color-primary) 10%, var(--color-background));
		color: var(--color-primary);
		border-radius: 14px;
	}
	.eyebrow {
		margin: 0 0 2px;
		font-size: 10px;
		letter-spacing: 1.8px;
		font-weight: 700;
		color: var(--color-primary);
	}
	h2 {
		margin: 0;
		font-size: 25px;
		letter-spacing: -0.8px;
	}
	button,
	select {
		font: inherit;
		color: inherit;
	}
	button {
		cursor: pointer;
	}
	button:focus-visible,
	select:focus-visible,
	.viewport:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: -2px;
	}
	button:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.icon {
		display: grid;
		place-items: center;
		width: 36px;
		height: 36px;
		border: 0;
		border-radius: 10px;
		background: transparent;
	}
	.icon:hover,
	.branch:hover {
		background: var(--color-muted);
	}
	.toolbar {
		padding-top: 0;
		padding-bottom: 16px;
		border-bottom: 1px solid var(--color-border);
	}
	.scope {
		display: flex;
		align-items: center;
		gap: 12px;
		min-width: 0;
		font-size: 12px;
	}
	select {
		width: min(380px, 40vw);
		min-width: 0;
		padding: 9px 30px 9px 12px;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		background: var(--color-background);
	}
	.zoom {
		gap: 2px;
	}
	output {
		min-width: 46px;
		text-align: center;
		font-size: 12px;
		font-variant-numeric: tabular-nums;
	}
	.fit {
		padding: 7px 10px;
		margin-left: 8px;
		border: 1px solid var(--color-border);
		border-radius: 9px;
		background: var(--color-background);
		font-size: 12px;
	}
	.overview {
		padding-block: 12px;
		font-size: 12px;
		flex-wrap: wrap;
	}
	.overview strong {
		margin-right: auto;
		overflow-wrap: anywhere;
	}
	.overview span {
		color: var(--color-muted-foreground);
	}
	.overview button {
		border: 0;
		padding: 0;
		background: none;
		color: var(--color-primary);
		font-size: 12px;
	}
	.viewport {
		flex: 1;
		min-height: 0;
		overflow: auto;
		overscroll-behavior: contain;
		background-color: color-mix(in srgb, var(--color-muted) 48%, var(--color-background));
		background-image: radial-gradient(var(--color-border) 1px, transparent 1px);
		background-size: 20px 20px;
	}
	.extent,
	.canvas {
		position: relative;
	}
	.extent {
		overflow: hidden;
	}
	.canvas {
		transform-origin: 0 0;
	}
	svg {
		position: absolute;
		inset: 0;
		overflow: visible;
		pointer-events: none;
	}
	path {
		fill: none;
		stroke: color-mix(in srgb, var(--color-primary) 35%, var(--color-border));
		stroke-width: 2;
	}
	path.dependency {
		stroke-dasharray: 6 5;
		stroke: var(--color-muted-foreground);
	}
	circle {
		fill: var(--color-primary);
	}
	.node {
		box-sizing: border-box;
		position: absolute;
		display: flex;
		flex-direction: column;
		padding: 14px 16px;
		border: 1px solid var(--color-border);
		border-left: 4px solid var(--task-color);
		border-radius: 14px;
		background: var(--color-background);
		box-shadow: 0 3px 12px #00000009;
	}
	.node-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-height: 25px;
		margin-bottom: 8px;
	}
	.status {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		color: var(--color-muted-foreground);
	}
	.status i {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: currentColor;
	}
	.status.done {
		color: #20834e;
	}
	.status.active {
		color: var(--color-primary);
	}
	.status.cancelled {
		text-decoration: line-through;
	}
	.branch {
		display: flex;
		align-items: center;
		gap: 5px;
		background: var(--color-muted);
		border: 0;
		border-radius: 6px;
		font-size: 11px;
		padding: 4px 6px;
	}
	.node-content {
		flex: 1;
		min-height: 0;
		overflow: auto;
		scrollbar-width: thin;
	}
	.task-name {
		text-align: left;
		padding: 0;
		background: none;
		border: 0;
		font-size: 15px;
		font-weight: 650;
		line-height: 1.4;
		overflow-wrap: anywhere;
	}
	.task-name:hover {
		color: var(--color-primary);
	}
	.task-name > span {
		color: var(--color-muted-foreground);
	}
	.assignees {
		display: flex;
		flex-direction: column;
		gap: 5px;
		margin-top: 12px;
		font-size: 11px;
	}
	.person {
		display: flex;
		align-items: center;
		gap: 7px;
		overflow-wrap: anywhere;
	}
	.avatar {
		flex-shrink: 0;
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		color: var(--color-primary);
		background: color-mix(in srgb, var(--color-primary) 10%, var(--color-background));
		font-size: 10px;
		font-weight: 700;
	}
	.unassigned {
		color: var(--color-muted-foreground);
	}
	.progress {
		margin-top: 12px;
	}
	.progress > div {
		display: flex;
		justify-content: space-between;
		font-size: 11px;
		color: var(--color-muted-foreground);
	}
	.progress strong {
		color: var(--color-foreground);
		font-variant-numeric: tabular-nums;
	}
	progress {
		display: block;
		width: 100%;
		height: 5px;
		margin-top: 7px;
		border: none;
		border-radius: 5px;
		overflow: hidden;
		background: var(--color-muted);
		accent-color: var(--task-color);
	}
	progress::-webkit-progress-bar {
		background: var(--color-muted);
	}
	progress::-webkit-progress-value {
		background: var(--task-color);
	}
	progress::-moz-progress-bar {
		background: var(--task-color);
	}
	footer {
		padding-block: 12px;
		font-size: 10px;
		color: var(--color-muted-foreground);
	}
	footer p {
		margin: 0;
		max-width: 580px;
		text-align: right;
	}
	.legend {
		flex-shrink: 0;
		gap: 16px;
	}
	.legend i {
		display: block;
		width: 22px;
		border-top: 2px solid var(--color-primary);
	}
	.legend i.dashed {
		border-top-style: dashed;
		border-color: var(--color-muted-foreground);
	}
	.empty {
		height: 100%;
		min-height: 220px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 24px;
		text-align: center;
	}
	.empty h3 {
		margin-bottom: 0;
	}
	.empty p {
		color: var(--color-muted-foreground);
		font-size: 13px;
	}
	@media (max-width: 640px) {
		.hierarchy {
			width: 100vw;
			height: 100dvh;
			border-radius: 0;
		}
		header,
		.toolbar,
		.overview,
		footer {
			padding-inline: 16px;
		}
		.toolbar {
			flex-wrap: wrap;
			gap: 10px;
		}
		.scope {
			width: 100%;
		}
		.scope select {
			flex: 1;
			width: auto;
		}
		.zoom {
			margin-left: auto;
		}
		.overview {
			gap: 8px;
		}
		.overview strong {
			width: 100%;
		}
		footer {
			align-items: flex-start;
			flex-direction: column;
			gap: 8px;
		}
		footer p {
			text-align: left;
		}
	}
</style>
