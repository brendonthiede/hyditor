<script lang="ts">
  import { loadRepos, repoState, selectRepo } from '$lib/stores/repo';
  import { onMount } from 'svelte';
  import { repoList } from '$lib/stores/repo';

  onMount(() => {
    void loadRepos();
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
</style>
