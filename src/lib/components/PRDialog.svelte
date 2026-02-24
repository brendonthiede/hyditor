<script lang="ts">
  import { activeRepo, branchState, createRepoPullRequest, pullRequestState, refreshPullRequests } from '$lib/stores/repo';

  let open = false;
  let title = '';
  let body = '';
  let base = '';
  let head = '';
  let autoAdjustedHead = false;

  $: if ($activeRepo) {
    if (!base) {
      base = $activeRepo.default_branch;
    }
    if (!head) {
      head = $branchState.current;
    }
  }

  $: if ($branchState.current && !open) {
    head = $branchState.current;
  }

  async function openDialog(): Promise<void> {
    open = true;
    autoAdjustedHead = false;
    if ($activeRepo) {
      base = $activeRepo.default_branch;
      head = $branchState.current;
      if (head === base) {
        const fallbackHead = $branchState.branches.find((branch) => branch !== base);
        if (fallbackHead) {
          head = fallbackHead;
          autoAdjustedHead = true;
        }
      }
    }
    await refreshPullRequests();
  }

  function closeDialog(): void {
    open = false;
  }

  function onBaseChange(): void {
    autoAdjustedHead = false;
  }

  function onHeadChange(): void {
    autoAdjustedHead = false;
  }

  async function onCreatePR(): Promise<void> {
    await createRepoPullRequest({ head, base, title, body });
    if (!$pullRequestState.error) {
      title = '';
      body = '';
      open = false;
    }
  }
</script>

<div class="pr-root">
  <button on:click={openDialog}>Pull requests</button>

  {#if open}
    <section class="dialog">
      <header>
        <h3>Pull requests</h3>
        <button on:click={closeDialog}>Close</button>
      </header>

      <section class="create">
        <h4>Create</h4>
        <input type="text" bind:value={title} placeholder="Title" disabled={$pullRequestState.busy} />
        <textarea rows="4" bind:value={body} placeholder="Description (optional)" disabled={$pullRequestState.busy}></textarea>
        <div class="branches">
          <label>
            Base
            <select bind:value={base} on:change={onBaseChange} disabled={$pullRequestState.busy}>
              {#each $branchState.branches as branch}
                <option value={branch}>{branch}</option>
              {/each}
            </select>
          </label>
          <label>
            Head
            <select bind:value={head} on:change={onHeadChange} disabled={$pullRequestState.busy}>
              {#each $branchState.branches as branch}
                <option value={branch}>{branch}</option>
              {/each}
            </select>
          </label>
        </div>
        {#if autoAdjustedHead}
          <p class="hint">Head was auto-set to <strong>{head}</strong> because it matched base.</p>
        {/if}
        {#if base && head && base === head}
          <p class="message error">Base and head branches must be different.</p>
        {/if}
        <button
          on:click={onCreatePR}
          disabled={$pullRequestState.busy || !title.trim() || !base || !head || base === head}
        >
          Create PR
        </button>
      </section>

      <section class="list">
        <div class="list-head">
          <h4>Open pull requests</h4>
          <button on:click={refreshPullRequests} disabled={$pullRequestState.busy}>Refresh</button>
        </div>
        {#if $pullRequestState.entries.length === 0}
          <p class="empty">No open pull requests.</p>
        {:else}
          <ul>
            {#each $pullRequestState.entries as pr}
              <li>
                <a href={pr.url} target="_blank" rel="noreferrer">#{pr.number} {pr.title}</a>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      {#if $pullRequestState.error}
        <p class="message error">{$pullRequestState.error}</p>
      {:else if $pullRequestState.lastAction}
        <p class="message success">{$pullRequestState.lastAction}</p>
      {/if}
    </section>
  {/if}
</div>

<style>
  .pr-root {
    position: relative;
  }

  .dialog {
    position: absolute;
    right: 0;
    top: calc(100% + 0.35rem);
    width: 28rem;
    max-height: 75vh;
    overflow: auto;
    z-index: 20;
    padding: 0.75rem;
    border: 1px solid #30363d;
    border-radius: 0.4rem;
    background: #0d1117;
    display: grid;
    gap: 0.75rem;
  }

  header,
  .list-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  h3,
  h4 {
    margin: 0;
  }

  .create,
  .list {
    display: grid;
    gap: 0.5rem;
  }

  .branches {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }

  label {
    display: grid;
    gap: 0.25rem;
    font-size: 0.85rem;
  }

  input,
  textarea,
  select {
    width: 100%;
  }

  ul {
    margin: 0;
    padding-left: 1.1rem;
    display: grid;
    gap: 0.35rem;
  }

  .empty,
  .message {
    margin: 0;
    font-size: 0.85rem;
  }

  .hint {
    margin: 0;
    font-size: 0.8rem;
    opacity: 0.8;
  }

  .error {
    color: #f85149;
  }

  .success {
    color: #3fb950;
  }
</style>
