<script lang="ts">
  import { cloneProgress, loadRepos, repoState, selectRepo, type CloneProgress } from '$lib/stores/repo';
  import { listen } from '@tauri-apps/api/event';
  import { onMount } from 'svelte';
  import { repoList } from '$lib/stores/repo';

  const PAGE_SIZE = 20;

  let filterText = '';
  let currentPage = 0;

  $: lowerFilter = filterText.toLowerCase().trim();
  $: filteredRepos = lowerFilter
    ? $repoList.filter(
        (repo) =>
          repo.name.toLowerCase().includes(lowerFilter) ||
          repo.owner.toLowerCase().includes(lowerFilter) ||
          (repo.description ?? '').toLowerCase().includes(lowerFilter)
      )
    : $repoList;
  $: totalPages = Math.max(1, Math.ceil(filteredRepos.length / PAGE_SIZE));
  // Reset to first page when filter changes
  $: if (lowerFilter !== undefined) currentPage = 0;
  $: pageStart = currentPage * PAGE_SIZE;
  $: pageRepos = filteredRepos.slice(pageStart, pageStart + PAGE_SIZE);

  function autoFocus(node: HTMLElement) {
    node.focus();
    return {};
  }

  onMount(() => {
    void loadRepos();
    const unlisten = listen('clone_progress', (event) => {
      cloneProgress.set(event.payload as CloneProgress);
    });

    return () => {
      void unlisten.then((dispose) => dispose());
    };
  });
</script>

<section class="repo-picker">
  <h2>Select a Repository</h2>
  {#if $repoState.loading}
    <p>Loading repositories…</p>
  {:else}
    {#if $repoList.length > 0}
      <div class="filter-row">
        <input
          class="filter-input"
          type="search"
          placeholder="Filter repositories…"
          bind:value={filterText}
          aria-label="Filter repositories"
          use:autoFocus
        />
        <span class="repo-count">
          {filteredRepos.length} / {$repoList.length}
        </span>
      </div>
    {/if}

    {#if filteredRepos.length === 0}
      {#if $repoList.length === 0}
        <p>No repositories available yet.</p>
      {:else}
        <p>No repositories match <em>{filterText}</em>.</p>
      {/if}
    {:else}
      <ul>
        {#each pageRepos as repo}
          <li>
            <button
              on:click={() => {
                void selectRepo(repo);
              }}
              disabled={$repoState.cloning !== null}
            >
              {repo.owner}/{repo.name}
              {#if repo.description}
                <span class="repo-desc">{repo.description}</span>
              {/if}
              {#if $repoState.cloning === `${repo.owner}/${repo.name}`}
                <span class="cloning-label">(cloning…)</span>
              {/if}
            </button>
            {#if $repoState.cloning === `${repo.owner}/${repo.name}` && $cloneProgress}
              <p class="progress">
                {Math.round($cloneProgress.percent)}%
                ({$cloneProgress.received_objects}/{$cloneProgress.total_objects} objects, {$cloneProgress.received_bytes} bytes)
              </p>
            {/if}
          </li>
        {/each}
      </ul>

      {#if totalPages > 1}
        <div class="pagination">
          <button
            class="page-btn"
            disabled={currentPage === 0}
            on:click={() => (currentPage = 0)}
            aria-label="First page"
          >&laquo;</button>
          <button
            class="page-btn"
            disabled={currentPage === 0}
            on:click={() => (currentPage -= 1)}
            aria-label="Previous page"
          >&lsaquo;</button>
          <span class="page-label">Page {currentPage + 1} of {totalPages}</span>
          <button
            class="page-btn"
            disabled={currentPage >= totalPages - 1}
            on:click={() => (currentPage += 1)}
            aria-label="Next page"
          >&rsaquo;</button>
          <button
            class="page-btn"
            disabled={currentPage >= totalPages - 1}
            on:click={() => (currentPage = totalPages - 1)}
            aria-label="Last page"
          >&raquo;</button>
        </div>
      {/if}
    {/if}
  {/if}

  {#if $repoState.error}
    <p class="error">{$repoState.error}</p>
  {/if}
</section>

<style>
  .repo-picker {
    padding: 1rem;
  }

  .filter-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }

  .filter-input {
    flex: 1;
    padding: 0.4rem 0.6rem;
    font-size: 0.9rem;
    border: 1px solid #444;
    border-radius: 4px;
    background: #1e1e1e;
    color: inherit;
  }

  .filter-input:focus {
    outline: none;
    border-color: #58a6ff;
  }

  .repo-count {
    font-size: 0.8rem;
    opacity: 0.6;
    white-space: nowrap;
  }

  ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 0.5rem;
  }

  button {
    width: 100%;
    text-align: left;
    padding: 0.6rem;
  }

  .repo-desc {
    display: block;
    font-size: 0.78rem;
    opacity: 0.6;
    margin-top: 0.15rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }

  .cloning-label {
    font-size: 0.85rem;
    opacity: 0.75;
  }

  .pagination {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    margin-top: 0.75rem;
    justify-content: center;
  }

  .page-btn {
    width: auto;
    padding: 0.3rem 0.6rem;
    font-size: 1rem;
  }

  .page-label {
    font-size: 0.85rem;
    padding: 0 0.4rem;
    opacity: 0.8;
  }

  .error {
    color: #f85149;
  }

  .progress {
    margin: 0.25rem 0 0;
    font-size: 0.85rem;
    opacity: 0.8;
  }
</style>
