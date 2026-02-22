<script lang="ts">
  import { fileTree } from '$lib/stores/editor';
</script>

<section class="file-tree">
  <h3>Files</h3>
  {#if $fileTree.length === 0}
    <p>No files loaded.</p>
  {:else}
    <ul>
      {#each $fileTree as item}
        <li>{item.path}</li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .file-tree {
    height: 100%;
    padding: 0.75rem;
    overflow: auto;
  }

  ul {
    margin: 0;
    padding-left: 1rem;
  }
</style>
