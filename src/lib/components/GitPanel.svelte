<script lang="ts">
  import {
    gitState,
    publishChanges,
    refreshGitStatus,
    revertChanges,
  } from '$lib/stores/repo';
  import { lastSavedAt } from '$lib/stores/editor';
  import { onMount, onDestroy } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';

  let commitMessage = '';
  let showWhitespaceDiffs = false;

  /** Set of file paths the user has marked "do not publish". */
  let excluded = new SvelteSet<string>();

  /** Path of the file currently showing a revert confirmation, or null. */
  let confirmingRevert: string | null = null;

  $: allEntries = $gitState.entries.filter(
    (entry) => !entry.whitespace_only || showWhitespaceDiffs
  );

  $: whitespaceOnlyCount = $gitState.entries.filter(
    (entry) => entry.whitespace_only
  ).length;

  /** Files that will be published (not excluded, not whitespace-only). */
  $: publishable = allEntries.filter(
    (entry) => !excluded.has(entry.path) && !entry.whitespace_only
  );

  $: hasPublishable = publishable.length > 0;

  // Clean up exclusions when files disappear from the list.
  $: {
    const currentPaths = new Set($gitState.entries.map((e) => e.path));
    for (const path of excluded) {
      if (!currentPaths.has(path)) {
        excluded.delete(path);
      }
    }
  }

  function toggleExclude(path: string): void {
    if (excluded.has(path)) {
      excluded.delete(path);
    } else {
      excluded.add(path);
    }
  }

  function requestRevert(path: string): void {
    confirmingRevert = path;
  }

  function cancelRevert(): void {
    confirmingRevert = null;
  }

  async function confirmRevert(): Promise<void> {
    if (!confirmingRevert) return;
    const path = confirmingRevert;
    confirmingRevert = null;
    await revertChanges([path]);
  }

  async function onPublish(): Promise<void> {
    const files = publishable.map((e) => e.path);
    if (files.length === 0) return;

    const now = new Date();
    const defaultMessage = `Changes made using Hyditor on ${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()}`;
    const message = commitMessage.trim() || defaultMessage;

    await publishChanges(files, message);
    if (!$gitState.error) {
      commitMessage = '';
      excluded.clear();
    }
  }

  /** Debounce timer for save-triggered refresh. */
  let saveRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  /** Fallback polling interval (every 5 s) to catch external file changes. */
  let pollInterval: ReturnType<typeof setInterval> | null = null;

  // React to editor saves: debounce 1 s after each save to refresh git status.
  $: if ($lastSavedAt > 0) {
    if (saveRefreshTimer) clearTimeout(saveRefreshTimer);
    saveRefreshTimer = setTimeout(() => void refreshGitStatus(), 1000);
  }

  onMount(() => {
    void refreshGitStatus();
    pollInterval = setInterval(() => void refreshGitStatus(), 5000);
  });

  onDestroy(() => {
    if (saveRefreshTimer) clearTimeout(saveRefreshTimer);
    if (pollInterval) clearInterval(pollInterval);
  });
</script>

<section class="git">
  <header>
    <h3>Publish</h3>
  </header>

  <!-- Changed files list -->
  <section class="files-section">
    <div class="section-head">
      <h4>Changed files ({allEntries.length})</h4>
      {#if whitespaceOnlyCount > 0}
        <button
          class="ws-toggle"
          title="{showWhitespaceDiffs ? 'Hide' : 'Show'} whitespace-only changes ({whitespaceOnlyCount})"
          on:click={() => (showWhitespaceDiffs = !showWhitespaceDiffs)}
        >
          {showWhitespaceDiffs ? 'Hide' : 'Show'} whitespace ({whitespaceOnlyCount})
        </button>
      {/if}
    </div>

    {#if allEntries.length === 0}
      <p class="empty">
        {#if whitespaceOnlyCount > 0}
          No publishable changes ({whitespaceOnlyCount} whitespace-only hidden).
        {:else}
          No changes detected.
        {/if}
      </p>
    {:else}
      <ul class="file-list">
        {#each allEntries as entry (entry.path)}
          <li class="file-row" class:excluded={excluded.has(entry.path)} class:whitespace-only={entry.whitespace_only}>
            <span class="file-path" title={entry.path}>{entry.path}</span>
            <span class="file-tag">{entry.whitespace_only ? 'whitespace' : entry.status}</span>
            <div class="file-actions">
              {#if !entry.whitespace_only}
                <button
                  class="exclude-btn"
                  class:active={excluded.has(entry.path)}
                  title={excluded.has(entry.path) ? 'Include in publish' : 'Do not publish'}
                  on:click={() => toggleExclude(entry.path)}
                  disabled={$gitState.busy}
                >
                  ⛔
                </button>
              {/if}
              <button
                class="revert-btn"
                title="Revert changes"
                on:click={() => requestRevert(entry.path)}
                disabled={$gitState.busy}
              >
                ↩
              </button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <!-- Revert confirmation dialog -->
  {#if confirmingRevert}
    <div class="confirm-overlay">
      <div class="confirm-dialog">
        <p class="confirm-title">Revert file?</p>
        <p class="confirm-path">{confirmingRevert}</p>
        <p>This will discard all local changes to this file. This cannot be undone.</p>
        <div class="confirm-actions">
          <button class="confirm-danger" on:click={() => void confirmRevert()}>Revert</button>
          <button on:click={cancelRevert}>Cancel</button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Publish section -->
  <section class="publish-section">
    <h4>Publish ({publishable.length} file{publishable.length === 1 ? '' : 's'})</h4>
    <textarea
      rows="2"
      bind:value={commitMessage}
      placeholder="Change notes (optional)"
      disabled={$gitState.busy}
    ></textarea>
    <div class="actions">
      <button class="publish-btn" on:click={() => void onPublish()} disabled={$gitState.busy || !hasPublishable}>
        Publish
      </button>
    </div>
  </section>

  {#if $gitState.error}
    <p class="message error">{$gitState.error}</p>
  {:else if $gitState.lastAction}
    <p class="message success">{$gitState.lastAction}</p>
  {/if}
</section>

<style>
  .git {
    height: 100%;
    padding: 0.75rem;
    overflow: auto;
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.75rem;
  }

  h4 {
    margin: 0;
    font-size: 0.9rem;
  }

  .files-section,
  .publish-section {
    margin-bottom: 1rem;
  }

  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.4rem;
  }

  .ws-toggle {
    font-size: 0.75rem;
    opacity: 0.65;
    padding: 0.1rem 0.35rem;
  }

  .ws-toggle:hover {
    opacity: 1;
  }

  .file-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 0.25rem;
    max-height: 20rem;
    overflow: auto;
  }

  .file-row {
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: 0.4rem;
    align-items: center;
    padding: 0.25rem 0.35rem;
    border-radius: 4px;
    min-width: 0;
  }

  .file-row:hover {
    background: #161b22;
  }

  .file-row.excluded .file-path,
  .file-row.excluded .file-tag {
    opacity: 0.45;
  }

  .file-row.whitespace-only {
    opacity: 0.45;
    font-style: italic;
  }

  .file-path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.85rem;
  }

  .file-tag {
    opacity: 0.75;
    font-size: 0.7rem;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .file-actions {
    display: flex;
    gap: 0.2rem;
    align-items: center;
  }

  .exclude-btn,
  .revert-btn {
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
    padding: 0.15rem 0.25rem;
    border-radius: 3px;
    font-size: 0.8rem;
    opacity: 0.5;
    transition: opacity 0.15s, background 0.15s;
  }

  .exclude-btn:hover,
  .revert-btn:hover {
    opacity: 1;
    background: #30363d;
  }

  .exclude-btn.active {
    opacity: 1;
  }

  .exclude-btn:disabled,
  .revert-btn:disabled {
    cursor: default;
    opacity: 0.25;
  }

  /* Revert confirmation overlay */
  .confirm-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .confirm-dialog {
    border: 1px solid #30363d;
    border-radius: 8px;
    background: #0d1117;
    padding: 1rem;
    max-width: 24rem;
    width: 90vw;
  }

  .confirm-title {
    margin: 0 0 0.25rem;
    font-weight: 600;
  }

  .confirm-path {
    margin: 0 0 0.5rem;
    font-family: monospace;
    font-size: 0.85rem;
    opacity: 0.8;
    word-break: break-all;
  }

  .confirm-dialog p {
    margin: 0 0 0.5rem;
    font-size: 0.9rem;
    line-height: 1.3;
  }

  .confirm-actions {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
    margin-top: 0.75rem;
  }

  .confirm-danger {
    background: #da3633;
    color: #fff;
    border: none;
    border-radius: 6px;
    padding: 0.35rem 0.75rem;
    cursor: pointer;
    font-weight: 600;
  }

  .confirm-danger:hover {
    background: #f85149;
  }

  textarea {
    width: 100%;
    resize: vertical;
    margin-top: 0.35rem;
  }

  .actions {
    margin-top: 0.5rem;
    display: flex;
    gap: 0.5rem;
  }

  .publish-btn {
    border: 1px solid #238636;
    background: #238636;
    color: #fff;
    border-radius: 6px;
    padding: 0.4rem 1rem;
    cursor: pointer;
    font-weight: 600;
  }

  .publish-btn:hover:not(:disabled) {
    background: #2ea043;
    border-color: #2ea043;
  }

  .publish-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .empty {
    margin: 0;
    opacity: 0.7;
    font-size: 0.85rem;
  }

  .message {
    margin: 0;
    font-size: 0.85rem;
  }

  .error {
    color: #f85149;
  }

  .success {
    color: #3fb950;
  }
</style>
