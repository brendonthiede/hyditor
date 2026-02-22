<script lang="ts">
  import { loadRepos, selectRepo } from '$lib/stores/repo';
  import { onMount } from 'svelte';
  import { repoList } from '$lib/stores/repo';

  onMount(loadRepos);
</script>

<section class="repo-picker">
  <h2>Select a Repository</h2>
  {#if $repoList.length === 0}
    <p>No repositories available yet.</p>
  {:else}
    <ul>
      {#each $repoList as repo}
        <li>
          <button on:click={() => selectRepo(repo)}>{repo.owner}/{repo.name}</button>
        </li>
      {/each}
    </ul>
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
</style>
