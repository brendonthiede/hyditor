<script lang="ts">
  import AuthScreen from '$lib/components/AuthScreen.svelte';
  import RepoSelector from '$lib/components/RepoSelector.svelte';
  import FileTree from '$lib/components/FileTree.svelte';
  import Editor from '$lib/components/Editor.svelte';
  import Preview from '$lib/components/Preview.svelte';
  import GitPanel from '$lib/components/GitPanel.svelte';
  import BranchSelector from '$lib/components/BranchSelector.svelte';
  import PRDialog from '$lib/components/PRDialog.svelte';
  import { authState, loadAuthState, logOut } from '$lib/stores/auth';
  import { activeRepo, gitState } from '$lib/stores/repo';
  import { onMount } from 'svelte';

  let gitPanelEl: HTMLElement | null = null;
  let showSignOutPanel = false;
  let signOutBusy = false;
  let signOutError: string | null = null;

  $: authenticated = $authState.status === 'authenticated';
  $: stagedCount = $gitState.entries.filter((entry) => entry.staged).length;
  $: unstagedCount = $gitState.entries.filter((entry) => entry.unstaged || entry.untracked).length;

  function focusGitPanel(): void {
    if (!gitPanelEl) {
      return;
    }

    gitPanelEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    const firstControl = gitPanelEl.querySelector<HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement>(
      'button, input, textarea'
    );
    firstControl?.focus();
  }

  async function handleLocalSignOut(): Promise<void> {
    signOutBusy = true;
    signOutError = null;

    try {
      await logOut();
      showSignOutPanel = false;
    } catch (error) {
      signOutError = error instanceof Error ? error.message : 'Failed to sign out locally.';
    } finally {
      signOutBusy = false;
    }
  }

  onMount(loadAuthState);
</script>

{#if !authenticated}
  <AuthScreen />
{:else if !$activeRepo}
  <RepoSelector />
{:else}
  <main class="workspace">
    <header class="toolbar">
      <div class="title-group">
        <h1>Hyditor</h1>
        <button class="git-badge" on:click={focusGitPanel}>
          Git: {stagedCount} staged / {unstagedCount} unstaged
        </button>
      </div>
      <div class="toolbar-actions">
        <BranchSelector />
        <PRDialog />
        <div class="signout-menu">
          <button class="signout-trigger" on:click={() => (showSignOutPanel = !showSignOutPanel)}>
            Sign out
          </button>
          {#if showSignOutPanel}
            <div class="signout-panel">
              <p class="signout-title">Local sign-out (recommended for token issues)</p>
              <p>
                This clears encrypted auth tokens from this device. If your refresh token was invalidated, sign out here,
                then re-authenticate.
              </p>
              <p>
                Optional remote revocation: remove Hyditor from
                <a href="https://github.com/settings/applications" target="_blank" rel="noreferrer"
                  >GitHub application settings</a
                >.
              </p>
              {#if signOutError}<p class="signout-error">{signOutError}</p>{/if}
              <div class="signout-actions">
                <button on:click={handleLocalSignOut} disabled={signOutBusy}>
                  {signOutBusy ? 'Signing out…' : 'Sign out locally'}
                </button>
                <button on:click={() => (showSignOutPanel = false)} disabled={signOutBusy}>Cancel</button>
              </div>
            </div>
          {/if}
        </div>
      </div>
    </header>
    <section class="panels">
      <aside class="file-tree"><FileTree /></aside>
      <div class="editor"><Editor /></div>
      <div class="preview"><Preview /></div>
      <aside class="git" bind:this={gitPanelEl}><GitPanel /></aside>
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

  .title-group {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-width: 0;
  }

  .git-badge {
    border: 1px solid #30363d;
    background: transparent;
    color: inherit;
    border-radius: 999px;
    padding: 0.15rem 0.5rem;
    cursor: pointer;
    font-size: 0.8rem;
    opacity: 0.85;
    white-space: nowrap;
  }

  .git-badge:hover,
  .git-badge:focus-visible {
    opacity: 1;
    border-color: #8b949e;
  }

  .panels {
    display: grid;
    grid-template-columns: 260px 1fr 1fr 320px;
    gap: 0;
    flex: 1;
    min-height: 0;
  }

  .toolbar-actions {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    position: relative;
  }

  .signout-menu {
    position: relative;
  }

  .signout-trigger {
    border: 1px solid #30363d;
    background: transparent;
    color: inherit;
    border-radius: 6px;
    padding: 0.35rem 0.6rem;
    cursor: pointer;
  }

  .signout-panel {
    position: absolute;
    right: 0;
    top: calc(100% + 0.35rem);
    width: 24rem;
    max-width: min(24rem, 90vw);
    border: 1px solid #30363d;
    border-radius: 8px;
    background: #0d1117;
    padding: 0.75rem;
    z-index: 10;
    display: grid;
    gap: 0.5rem;
  }

  .signout-title {
    margin: 0;
    font-weight: 600;
  }

  .signout-panel p {
    margin: 0;
    font-size: 0.9rem;
    line-height: 1.3;
  }

  .signout-actions {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
  }

  .signout-error {
    color: #f85149;
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
