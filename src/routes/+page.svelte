<script lang="ts">
  import AuthScreen from '$lib/components/AuthScreen.svelte';
  import RepoSelector from '$lib/components/RepoSelector.svelte';
  import FileTree from '$lib/components/FileTree.svelte';
  import Editor from '$lib/components/Editor.svelte';
  import Preview from '$lib/components/Preview.svelte';
  import GitPanel from '$lib/components/GitPanel.svelte';
  import BranchSelector from '$lib/components/BranchSelector.svelte';
  import { authState, loadAuthState } from '$lib/stores/auth';
  import { activeRepo } from '$lib/stores/repo';
  import { onMount } from 'svelte';

  $: authenticated = $authState.status === 'authenticated';

  onMount(loadAuthState);
</script>

{#if !authenticated}
  <AuthScreen />
{:else if !$activeRepo}
  <RepoSelector />
{:else}
  <main class="workspace">
    <header class="toolbar">
      <h1>Hyditor</h1>
      <BranchSelector />
    </header>
    <section class="panels">
      <aside class="file-tree"><FileTree /></aside>
      <div class="editor"><Editor /></div>
      <div class="preview"><Preview /></div>
      <aside class="git"><GitPanel /></aside>
    </section>
  </main>
{/if}

<style>
  .workspace {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }

  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid #30363d;
  }

  .toolbar h1 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
  }

  .panels {
    display: grid;
    grid-template-columns: 260px 1fr 1fr 320px;
    gap: 0;
    flex: 1;
    min-height: 0;
  }

  .file-tree,
  .editor,
  .preview,
  .git {
    border-right: 1px solid #30363d;
    min-width: 0;
    overflow: hidden;
  }

  .git {
    border-right: 0;
  }
</style>
