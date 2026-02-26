<script lang="ts">
  import AuthScreen from '$lib/components/AuthScreen.svelte';
  import RepoSelector from '$lib/components/RepoSelector.svelte';
  import FileTree from '$lib/components/FileTree.svelte';
  import Editor from '$lib/components/Editor.svelte';
  import Preview from '$lib/components/Preview.svelte';
  import BranchSelector from '$lib/components/BranchSelector.svelte';
  import PanelResizeHandle from '$lib/components/PanelResizeHandle.svelte';
  import { writeText as writeClipboardText } from '@tauri-apps/plugin-clipboard-manager';
  import { openUrl } from '@tauri-apps/plugin-opener';
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
  $: changedCount = $gitState.entries.filter((entry) => !entry.whitespace_only).length;

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

  async function openRepoOnGitHub(): Promise<void> {
    const repo = $activeRepo;
    if (!repo) return;
    const url = `https://github.com/${repo.owner}/${repo.name}`;
    try {
      await openUrl(url);
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
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
          {changedCount} changed file{changedCount === 1 ? '' : 's'}
        </button>
      </div>
      <div class="toolbar-actions">
        <div class="repo-group">
          <span class="repo-name">{$activeRepo.owner}/{$activeRepo.name}</span>
          <button
            class="icon-btn"
            title="Open on GitHub"
            on:click={() => void openRepoOnGitHub()}
          >
            <!-- External link icon (GitHub) -->
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M3.75 2A1.75 1.75 0 002 3.75v8.5c0 .966.784 1.75 1.75 1.75h8.5A1.75 1.75 0 0014 12.25v-3.5a.75.75 0 00-1.5 0v3.5a.25.25 0 01-.25.25h-8.5a.25.25 0 01-.25-.25v-8.5a.25.25 0 01.25-.25h3.5a.75.75 0 000-1.5h-3.5z"/>
              <path d="M10 1a.75.75 0 000 1.5h2.44L8.22 6.72a.75.75 0 001.06 1.06L13.5 3.56V6a.75.75 0 001.5 0V1.75a.75.75 0 00-.75-.75H10z"/>
            </svg>
          </button>
          <button
            class="icon-btn"
            title={pathCopied ? 'Copied!' : `Copy local path: ${$activeRepo?.localPath ?? ''}`}
            on:click={() => void copyRepoPath()}
          >
            <!-- Clipboard icon -->
            {#if pathCopied}
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/>
              </svg>
            {:else}
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 010 1.5h-1.5a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-1.5a.75.75 0 011.5 0v1.5A1.75 1.75 0 019.25 16h-7.5A1.75 1.75 0 010 14.25v-7.5z"/>
                <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0114.25 11h-7.5A1.75 1.75 0 015 9.25v-7.5zm1.75-.25a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-7.5a.25.25 0 00-.25-.25h-7.5z"/>
              </svg>
            {/if}
          </button>
          <button
            class="icon-btn"
            title="Close repository"
            on:click={resetRepoSession}
          >
            <!-- X / close icon -->
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z"/>
            </svg>
          </button>
        </div>
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
    align-items: center;
    gap: 0.75rem;
    position: relative;
  }

  .repo-group {
    display: inline;
    align-items: center;
    border: 1px solid #30363d;
    border-radius: 6px;
    padding: 0.2rem 0.5rem;
  }

  .signout-menu {
    position: relative;
  }

  .repo-name {
    font-size: 0.85rem;
    font-weight: 500;
    opacity: 0.9;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 20rem;
    margin: 0;
    padding: 0;
  }

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    color: inherit;
    border-radius: 4px;
    padding: 0.3rem;
    cursor: pointer;
    opacity: 0.7;
    transition: opacity 0.15s, background 0.15s;
  }

  .icon-btn:hover,
  .icon-btn:focus-visible {
    opacity: 1;
    background: #30363d;
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
