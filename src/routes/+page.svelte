<script lang="ts">
  import AuthScreen from '$lib/components/AuthScreen.svelte';
  import RepoSelector from '$lib/components/RepoSelector.svelte';
  import FileTree from '$lib/components/FileTree.svelte';
  import Editor from '$lib/components/Editor.svelte';
  import Preview from '$lib/components/Preview.svelte';
  import BranchSelector from '$lib/components/BranchSelector.svelte';
  import PanelResizeHandle from '$lib/components/PanelResizeHandle.svelte';
  import { writeText as writeClipboardText } from '@tauri-apps/plugin-clipboard-manager';
  import { authState, loadAuthState, logOut } from '$lib/stores/auth';
  import { activeRepo, gitState, resetRepoSession, restoreLastSession } from '$lib/stores/repo';
  import { layout } from '$lib/stores/layout';
  import { onMount } from 'svelte';

  let centerEl: HTMLElement | null = null;
  let showSignOutPanel = false;
  let signOutBusy = false;
  let signOutError: string | null = null;
  let pathCopied = false;
  let restoringSession = false;

  $: authenticated = $authState.status === 'authenticated';
  $: stagedCount = $gitState.entries.filter((entry) => entry.staged).length;
  $: unstagedCount = $gitState.entries.filter((entry) => entry.unstaged || entry.untracked).length;

  // Reactive flex-grow style for the editor pane inside the center area
  $: editorPaneStyle = $layout.previewCollapsed
    ? 'flex: 1; min-width: 0; min-height: 0; overflow: hidden;'
    : $layout.previewPosition === 'side'
      ? `flex: ${$layout.centerSplit}; min-width: 0; overflow: hidden;`
      : `flex: ${$layout.editorHeightSplit}; min-width: 0; overflow: hidden;`;

  $: previewPaneStyle =
    $layout.previewPosition === 'side'
      ? `flex: ${1 - $layout.centerSplit}; min-width: 0; overflow: hidden;`
      : `flex: ${1 - $layout.editorHeightSplit}; min-width: 0; overflow: hidden;`;

  function handleCenterDrag(delta: number): void {
    if (!centerEl) return;
    if ($layout.previewPosition === 'side') {
      const totalWidth = centerEl.offsetWidth;
      layout.setCenterSplit(($layout.centerSplit * totalWidth + delta) / totalWidth);
    } else {
      const totalHeight = centerEl.offsetHeight;
      layout.setEditorHeightSplit(($layout.editorHeightSplit * totalHeight + delta) / totalHeight);
    }
  }

  function focusGitPanel(): void {
    // Expand the left panel first if it is collapsed
    if ($layout.fileTreeCollapsed) layout.toggleFileTree();
    // Switch to the git blade
    layout.setLeftPanelBlade('git');
  }

  async function copyRepoPath(): Promise<void> {
    const path = $activeRepo?.localPath;
    if (!path) return;
    try {
      await writeClipboardText(path);
      pathCopied = true;
      setTimeout(() => {
        pathCopied = false;
      }, 2000);
    } catch {
      // Silently ignore clipboard errors
    }
  }

  async function handleLocalSignOut(): Promise<void> {
    signOutBusy = true;
    signOutError = null;

    try {
      await logOut();
      resetRepoSession();
      showSignOutPanel = false;
    } catch (error) {
      signOutError = error instanceof Error ? error.message : 'Failed to sign out locally.';
    } finally {
      signOutBusy = false;
    }
  }

  onMount(async () => {
    await loadAuthState();

    // After auth succeeds, try to restore the last session
    const unsubscribe = authState.subscribe(async (state) => {
      if (state.status === 'authenticated' && !$activeRepo && !restoringSession) {
        restoringSession = true;
        try {
          await restoreLastSession();
        } finally {
          restoringSession = false;
        }
        unsubscribe();
      }
    });
  });
</script>

{#if !authenticated}
  <AuthScreen />
{:else if restoringSession}
  <div class="restoring">Restoring last session…</div>
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
        <button class="open-repo-btn" on:click={resetRepoSession}>
          Open a different repository
        </button>
        <button
          class="copy-path-btn"
          title={$activeRepo?.localPath ?? ''}
          on:click={() => void copyRepoPath()}
        >
          {pathCopied ? 'Path copied!' : 'Copy repo path'}
        </button>
        <BranchSelector />
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
      <!-- File tree: collapsed tab or expanded panel -->
      {#if $layout.fileTreeCollapsed}
        <div
          class="panel-tab"
          role="button"
          tabindex="0"
          title="Expand file panel"
          on:click={() => layout.toggleFileTree()}
          on:keydown={(e) => e.key === 'Enter' && layout.toggleFileTree()}
        >
          <span>Files</span>
        </div>
      {:else}
        <aside class="panel file-panel" style="width: {$layout.fileTreeWidth}px">
          <FileTree />
        </aside>
        <PanelResizeHandle
          orientation="horizontal"
          onDrag={(delta) => layout.setFileTreeWidth($layout.fileTreeWidth + delta)}
        />
      {/if}

      <!-- Center area: editor + preview (side-by-side or stacked) -->
      <div
        class="center-area"
        class:preview-below={$layout.previewPosition === 'below'}
        bind:this={centerEl}
      >
        <!-- Editor pane -->
        <div class="editor-pane" style={editorPaneStyle}>
          <Editor />
        </div>

        {#if $layout.previewCollapsed}
          <!-- Collapsed preview strip -->
          <div
            class="panel-tab preview-tab"
            class:preview-tab--vertical={$layout.previewPosition === 'side'}
            class:preview-tab--horizontal={$layout.previewPosition === 'below'}
            role="button"
            tabindex="0"
            title="Expand preview panel"
            on:click={() => layout.togglePreview()}
            on:keydown={(e) => e.key === 'Enter' && layout.togglePreview()}
          >
            <span>Preview</span>
          </div>
        {:else}
          <PanelResizeHandle
            orientation={$layout.previewPosition === 'side' ? 'horizontal' : 'vertical'}
            onDrag={handleCenterDrag}
          />
          <!-- Preview pane -->
          <div class="preview-pane" style={previewPaneStyle}>
            <Preview />
          </div>
        {/if}
      </div>
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
    display: flex;
    flex-direction: row;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  /* File tree / git panel expanded */
  .panel {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    flex-shrink: 0;
  }

  .file-panel {
    border-right: 1px solid #30363d;
  }

  /* Collapsed panel tabs (vertical strips) */
  .panel-tab {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    flex-shrink: 0;
    cursor: pointer;
    border-right: 1px solid #30363d;
    user-select: none;
    font-size: 0.75rem;
    opacity: 0.65;
    transition: opacity 0.15s, background 0.15s;
    overflow: hidden;
  }

  .panel-tab span {
    writing-mode: vertical-rl;
    text-orientation: mixed;
    white-space: nowrap;
  }

  .panel-tab:hover {
    opacity: 1;
    background: #161b22;
  }

  /* Preview collapsed tab inside the center area */
  .preview-tab--vertical {
    width: 28px;
    height: 100%;
    border-left: 1px solid #30363d;
    border-right: none;
  }

  .preview-tab--horizontal {
    width: 100%;
    height: 28px;
    writing-mode: horizontal-tb;
    border-top: 1px solid #30363d;
  }

  .preview-tab--horizontal span {
    writing-mode: horizontal-tb;
  }

  /* Center area holds editor + preview */
  .center-area {
    flex: 1;
    display: flex;
    flex-direction: row;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .center-area.preview-below {
    flex-direction: column;
  }

  .editor-pane,
  .preview-pane {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
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

  .open-repo-btn {
    border: 1px solid #30363d;
    background: transparent;
    color: inherit;
    border-radius: 6px;
    padding: 0.35rem 0.6rem;
    cursor: pointer;
    white-space: nowrap;
  }

  .open-repo-btn:hover,
  .open-repo-btn:focus-visible {
    border-color: #8b949e;
  }

  .copy-path-btn {
    border: 1px solid #30363d;
    background: transparent;
    color: inherit;
    border-radius: 6px;
    padding: 0.35rem 0.6rem;
    cursor: pointer;
    white-space: nowrap;
    font-size: 0.85rem;
  }

  .copy-path-btn:hover,
  .copy-path-btn:focus-visible {
    border-color: #8b949e;
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

  .restoring {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
    font-size: 1.1rem;
    opacity: 0.7;
  }


</style>
