<script lang="ts">
	import Button, { Label } from '@smui/button';
	import IconButton from '@smui/icon-button';
	import List, { Item, Graphic, Text as LText } from '@smui/list';
	import Paper from '@smui/paper';
	import { mdiShareVariantOutline, mdiCogOutline, mdiPlus, mdiMinus } from '@mdi/js';
	import MdiIcon from './MdiIcon.svelte';
</script>

<aside class="panel">
	<header class="head">
		<span class="title">PEOPLE ({people.length}) ({capacity})</span>
		<span class="actions">
			<Button variant="unelevated" class="share-btn" onclick={() => alert('TODO: share dialog')}>
				<MdiIcon path={mdiShareVariantOutline} size={15} />
				<Label>Share</Label>
			</Button>
			<IconButton onclick={() => alert('TODO: settings')}>
				<MdiIcon path={mdiCogOutline} size={20} />
			</IconButton>
		</span>
	</header>

	<List dense class="people-list">
		{#each people as p (p.id)}
			<Item nonInteractive>
				<Graphic class="avatar">{p.name.slice(-1)}</Graphic>
				<LText>
					<span class="pname">{p.name}</span>
					<span class="prole">
						{p.role}{p.owner ? ' · Owner' : ''} ·
						<span class="active">{p.status}</span>
					</span>
				</LText>
			</Item>
		{/each}
	</List>

	<div class="waiting-head">
		<span>Waiting ({waiting.length})</span>
		<button class="approve-all" onclick={approveAll}>Approve all</button>
	</div>

	<div class="waiting">
		{#each waiting as p (p.id)}
			<div class="wrow">
				<span class="pname">{p.name}</span>
				<span class="wactions">
					<IconButton size="mini" class="wbtn" onclick={() => reject(p.id)}>
						<MdiIcon path={mdiMinus} size={16} />
					</IconButton>
					<IconButton size="mini" class="wbtn" onclick={() => approve(p.id)}>
						<MdiIcon path={mdiPlus} size={16} />
					</IconButton>
				</span>
			</div>
		{/each}
	</div>

	<Paper class="settings-card">
		<strong>Sharing Settings</strong>
		<p>
			Anyone with the link can view. Only some role and owner can invite people in.
		</p>
	</Paper>
</aside>

<style>
	.panel {
		width: 300px; flex-shrink: 0;
		background: #f8fafd;
		border-left: 1px solid #e1e3e1;
		padding: 12px 16px;
		overflow-y: auto;
		display: flex; flex-direction: column; gap: 8px;
	}
	.panel :global(.wbtn) { width: 26px; height: 26px; padding: 4px; color: #444746; }

	.panel :global(.settings-card) {
		margin-top: 12px; padding: 12px 14px; border-radius: 12px;
		font-size: 12px; color: #444746;
	}
	.panel p :global(.settings-card) { margin: 6px 0 0; line-height: 1.45; }
	.panel strong :global(.settings-card) { font-size: 12.5px; color: #1f1f1f; }

	.head { display: flex; align-items: center; justify-content: space-between; }
	.title { font-size: 12px; font-weight: 700; letter-spacing: 0.3px; color: #1f1f1f; }
	.actions { display: flex; align-items: center; gap: 4px; }
	.actions :global(.share-btn) {
		background: #0b57d0; color: #fff; border-radius: 999px;
		height: 30px; padding: 0 12px; text-transform: none; font-size: 12.5px;
		display: flex; align-items: center; gap: 5px;
	}
	.actions :global(.mdc-icon-button) { width: 32px; height: 32px; padding: 6px; color: #444746; }

	.panel :global(.people-list) { background: transparent; padding: 0; }
	.panel :global(.avatar) {
		width: 32px; height: 32px; border-radius: 50%;
		background: #e1e3e1; color: #444746;
		display: grid; place-items: center;
		font-size: 13px; font-weight: 600; margin-right: 12px;
	}
	.pname { display: block; font-size: 13.5px; font-weight: 600; color: #1f1f1f; }
	.prole { display: block; font-size: 11.5px; color: #444746; }
	.active { color: #188038; font-weight: 600; }

	.waiting-head {
		display: flex; justify-content: space-between; align-items: baseline;
		font-size: 12.5px; font-weight: 600; color: #1f1f1f; margin-top: 8px;
	}
	.approve-all {
		border: 0; background: none; cursor: pointer;
		font-size: 12px; font-weight: 600; color: #1f1f1f;
	}
	.approve-all:hover { text-decoration: underline; }
	.waiting { display: flex; flex-direction: column; }
	.wrow {
		display: flex; align-items: center; justify-content: space-between;
		padding: 2px 0;
	}
	.wactions { display: flex; gap: 2px; }
	
</style>