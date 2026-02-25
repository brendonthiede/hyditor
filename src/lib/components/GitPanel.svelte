<script lang="ts">
  import {
    commitChanges,
    gitState,
    pushChanges,
    refreshGitStatus,
    stageFiles,
    unstageFiles
  } from '$lib/stores/repo';
  import { layout } from '$lib/stores/layout';

  let selectedForStage: string[] = [];
  let selectedForUnstage: string[] = [];
  let commitMessage = '';
  let showWhitespaceDiffs = false;

  $: whitespaceOnlyCount = $gitState.entries.filter(
    (entry) => (entry.unstaged || entry.untracked) && entry.whitespace_only
  ).length;
  $: unstagedEntries = $gitState.entries.filter(
    (entry) =>
      (entry.unstaged || entry.untracked) && (showWhitespaceDiffs || !entry.whitespace_only)
  );
  $: stagedEntries = $gitState.entries.filter((entry) => entry.staged);
  $: hasStagedChanges = stagedEntries.length > 0;

  $: {
    const unstagedPaths = new Set(unstagedEntries.map((entry) => entry.path));
    selectedForStage = selectedForStage.filter((path) => unstagedPaths.has(path));
  }

  $: {
    const stagedPaths = new Set(stagedEntries.map((entry) => entry.path));
    selectedForUnstage = selectedForUnstage.filter((path) => stagedPaths.has(path));
  }

  function toggleSelection(path: string, selected: string[], checked: boolean): string[] {
    if (checked) {
      if (selected.includes(path)) {
        return selected;
      }
      return [...selected, path];
    }
    return selected.filter((value) => value !== path);
  }

  async function onStageSelected(): Promise<void> {
    await stageFiles(selectedForStage);
    selectedForStage = [];
  }

  async function onUnstageSelected(): Promise<void> {
    await unstageFiles(selectedForUnstage);
    selectedForUnstage = [];
  }

  async function onCommit(): Promise<void> {
    await commitChanges(commitMessage);
    if (!$gitState.error) {
      commitMessage = '';
      selectedForUnstage = [];
    }
  }

  async function onPush(): Promise<void> {
    await pushChanges();
  }
</script>

<section class="git">
  <header>
    <button class="panel-collapse-btn" title="Collapse git panel" on:click={() => layout.toggleGitPanel()}>
      ▶
    </button>
    <h3>Git</h3>
    <button on:click={refreshGitStatus} disabled={$gitState.busy}>Refresh</button>
  </header>

  <section class="status-group">
    <div class="group-head">
      <h4>Unstaged</h4>
      <div class="group-actions">
        {#if whitespaceOnlyCount > 0}
          <button
            class="ws-toggle"
            title="{showWhitespaceDiffs ? 'Hide' : 'Show'} whitespace-only changes ({whitespaceOnlyCount})"
            on:click={() => (showWhitespaceDiffs = !showWhitespaceDiffs)}
          >
            {showWhitespaceDiffs ? 'Hide' : 'Show'} whitespace ({whitespaceOnlyCount})
          </button>
        {/if}
        <button on:click={onStageSelected} disabled={$gitState.busy || selectedForStage.length === 0}>
          Stage selected
        </button>
      </div>
    </div>
    {#if unstagedEntries.length === 0}
      <p class="empty">
        {#if whitespaceOnlyCount > 0 && !showWhitespaceDiffs}
          No stageable changes ({whitespaceOnlyCount} whitespace-only hidden).
        {:else}
          No unstaged changes.
        {/if}
      </p>
    {:else}
      <ul class="files">
        {#each unstagedEntries as entry}
          <li>
            <label class:whitespace-only={entry.whitespace_only}>
              <input
                type="checkbox"
                checked={selectedForStage.includes(entry.path)}
                on:change={(event) => {
                  const checked = (event.currentTarget as HTMLInputElement).checked;
                  selectedForStage = toggleSelection(entry.path, selectedForStage, checked);
                }}
                disabled={$gitState.busy || entry.whitespace_only}
              />
              <span class="path">{entry.path}</span>
              <span class="tag">{entry.whitespace_only ? 'whitespace' : entry.status}</span>
            </label>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="status-group">
    <div class="group-head">
      <h4>Staged</h4>
      <button on:click={onUnstageSelected} disabled={$gitState.busy || selectedForUnstage.length === 0}>
        Unstage selected
      </button>
    </div>
    {#if stagedEntries.length === 0}
      <p class="empty">No staged changes.</p>
    {:else}
      <ul class="files">
        {#each stagedEntries as entry}
          <li>
            <label>
              <input
                type="checkbox"
                checked={selectedForUnstage.includes(entry.path)}
                on:change={(event) => {
                  const checked = (event.currentTarget as HTMLInputElement).checked;
                  selectedForUnstage = toggleSelection(entry.path, selectedForUnstage, checked);
                }}
                disabled={$gitState.busy}
              />
              <span class="path">{entry.path}</span>
              <span class="tag">{entry.status}</span>
            </label>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="commit">
    <h4>Commit</h4>
    <textarea
      rows="3"
      bind:value={commitMessage}
      placeholder="Commit message"
      disabled={$gitState.busy}
    ></textarea>
    <div class="actions">
      <button on:click={onCommit} disabled={$gitState.busy || !hasStagedChanges || !commitMessage.trim()}>
        Commit staged
      </button>
      <button on:click={onPush} disabled={$gitState.busy}>Push</button>
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

  .panel-collapse-btn {
    background: transparent;
    border: 1px solid transparent;
    border-radius: 6px;
    color: inherit;
    cursor: pointer;
    font-size: 0.8rem;
    line-height: 1;
    padding: 0.15rem 0.35rem;
    opacity: 0.6;
    flex-shrink: 0;
  }

  .panel-collapse-btn:hover {
    border-color: #30363d;
    opacity: 1;
  }

  h4 {
    margin: 0;
    font-size: 0.9rem;
  }

  .status-group,
  .commit {
    margin-bottom: 1rem;
  }

  .group-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.4rem;
  }

  .group-actions {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .ws-toggle {
    font-size: 0.75rem;
    opacity: 0.65;
    padding: 0.1rem 0.35rem;
  }

  .ws-toggle:hover {
    opacity: 1;
  }

  label.whitespace-only {
    opacity: 0.5;
    font-style: italic;
  }

  .files {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 0.35rem;
    max-height: 11rem;
    overflow: auto;
  }

  label {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 0.4rem;
    align-items: center;
    min-width: 0;
  }

  .path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tag {
    opacity: 0.75;
    font-size: 0.75rem;
    text-transform: uppercase;
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
