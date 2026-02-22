<script lang="ts">
  import { gitState, refreshGitStatus } from '$lib/stores/repo';
</script>

<section class="git">
  <header>
    <h3>Git</h3>
    <button on:click={refreshGitStatus}>Refresh</button>
  </header>
  <ul>
    {#each $gitState.changedFiles as file}
      <li>{file}</li>
    {/each}
  </ul>
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
  }

  ul {
    margin: 0.5rem 0 0;
    padding-left: 1rem;
  }
</style>
