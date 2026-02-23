<script lang="ts">
  import { editorState, fileTree } from '$lib/stores/editor';
  import { openRepoFile } from '$lib/stores/repo';

  $: sortedItems = [...$fileTree].sort((left, right) => {
    if (left.is_dir !== right.is_dir) {
      return left.is_dir ? -1 : 1;
    }

    return left.path.localeCompare(right.path);
  });

  function splitPath(path: string): { dir: string; name: string } {
    const parts = path.split('/');
    const name = parts.pop() ?? path;
    const dir = parts.length > 0 ? `${parts.join('/')}/` : '';
    return { dir, name };
  }
</script>

<section class="file-tree">
  <h3>Files</h3>
  {#if $fileTree.length === 0}
    <p>No files loaded.</p>
  {:else}
    <ul>
      {#each sortedItems as item}
        <li>
          {#if item.is_dir}
            {@const split = splitPath(item.path)}
            <span class="dir">{split.dir}<strong>{split.name}</strong></span>
          {:else}
            {@const split = splitPath(item.path)}
            <button
              class:active={$editorState.currentFile === item.path}
              on:click={() => {
                void openRepoFile(item.path);
              }}
            >
              {#if split.dir}<span class="path">{split.dir}</span>{/if}<strong>{split.name}</strong>
            </button>
          {/if}
        </li>
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
    display: grid;
    gap: 0.25rem;
  }

  .dir {
    display: block;
    opacity: 0.75;
    text-overflow: ellipsis;
    overflow: hidden;
    white-space: nowrap;
  }

  button {
    width: 100%;
    text-align: left;
    background: transparent;
    color: inherit;
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 0.25rem 0.4rem;
    cursor: pointer;
  }

  button:hover {
    border-color: #30363d;
  }

  button.active {
    border-color: #30363d;
  }

  .path {
    opacity: 0.75;
  }

  strong {
    font-weight: 600;
  }
</style>
