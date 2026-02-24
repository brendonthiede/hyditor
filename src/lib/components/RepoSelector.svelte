<script lang="ts">
  import { cloneProgress, loadRepos, repoState, selectRepo, type CloneProgress } from '$lib/stores/repo';
  import { listen } from '@tauri-apps/api/event';
  import { onMount } from 'svelte';
  import { repoList } from '$lib/stores/repo';

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
  {:else if $repoList.length === 0}
    <p>No repositories available yet.</p>
  {:else}
    <ul>
      {#each $repoList as repo}
        <li>
          <button
            on:click={() => {
              void selectRepo(repo);
            }}
            disabled={$repoState.cloning !== null}
          >
            {repo.owner}/{repo.name}
            {#if $repoState.cloning === `${repo.owner}/${repo.name}`}
              (cloning…)
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
  {/if}

  {#if $repoState.error}
    <p class="error">{$repoState.error}</p>
  {/if}
</section>

<style>
  .repo-picker {
    padding: 1rem;
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

  .error {
    color: #f85149;
  }

  .progress {
    margin: 0.25rem 0 0;
    font-size: 0.85rem;
    opacity: 0.8;
  }
</style>
