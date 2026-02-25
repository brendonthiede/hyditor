<script context="module" lang="ts">
  import { writable } from 'svelte/store';

  interface TreeNode {
    name: string;
    path: string;
    is_dir: boolean;
    children: TreeNode[];
  }

  const collapsedDirs = writable<Set<string>>(new Set());
</script>

<script lang="ts">
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import { editorState, fileTree } from '$lib/stores/editor';
  import { openRepoFile } from '$lib/stores/repo';
  import { layout } from '$lib/stores/layout';

  /** When provided, this instance renders the given nodes (recursive child). */
  export let nodes: TreeNode[] | undefined = undefined;

  function buildTree(items: { path: string; is_dir: boolean }[]): TreeNode[] {
    const root: TreeNode[] = [];
    const dirMap = new SvelteMap<string, TreeNode>();

    // Sort by path so parent dirs are created before children
    const sorted = [...items].sort((a, b) => a.path.localeCompare(b.path));

    for (const item of sorted) {
      const parts = item.path.split('/');
      const name = parts[parts.length - 1];
      const node: TreeNode = { name, path: item.path, is_dir: item.is_dir, children: [] };

      if (item.is_dir) {
        dirMap.set(item.path, node);
      }

      const parentPath = parts.slice(0, -1).join('/');
      if (parentPath && dirMap.has(parentPath)) {
        dirMap.get(parentPath)!.children.push(node);
      } else {
        root.push(node);
      }
    }

    const sortNodes = (ns: TreeNode[]) => {
      ns.sort((a, b) => {
        if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      for (const n of ns) {
        if (n.children.length > 0) sortNodes(n.children);
      }
    };
    sortNodes(root);

    return root;
  }

  function toggleDir(path: string) {
    collapsedDirs.update((dirs) => {
      const next = new SvelteSet(dirs);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function getAllDirPaths(ns: TreeNode[]): string[] {
    const paths: string[] = [];
    for (const n of ns) {
      if (n.is_dir) {
        paths.push(n.path);
        paths.push(...getAllDirPaths(n.children));
      }
    }
    return paths;
  }

  function collapseAll() {
    collapsedDirs.set(new SvelteSet(getAllDirPaths(tree)));
  }

  $: isRoot = nodes === undefined;
  $: tree = isRoot ? buildTree($fileTree) : [];
  $: displayNodes = nodes ?? tree;
</script>

{#if isRoot}
  <section class="file-tree">
    <div class="file-tree-header">
      <h3>Files</h3>
      {#if $fileTree.length > 0}
        <button class="collapse-all-btn" title="Collapse all folders" on:click={collapseAll}>
          ⊟
        </button>
      {/if}
      <button class="panel-collapse-btn" title="Collapse file panel" on:click={() => layout.toggleFileTree()}>
        ◀
      </button>
    </div>
    {#if $fileTree.length === 0}
      <p>No files loaded.</p>
    {:else}
      <svelte:self nodes={displayNodes} />
    {/if}
  </section>
{:else}
  <ul>
    {#each displayNodes as node (node.path)}
      <li>
        {#if node.is_dir}
          <button class="dir-toggle" on:click={() => toggleDir(node.path)}>
            <span class="chevron" class:collapsed={$collapsedDirs.has(node.path)}>▶</span>
            <strong>{node.name}</strong>
          </button>
          {#if !$collapsedDirs.has(node.path) && node.children.length > 0}
            <svelte:self nodes={node.children} />
          {/if}
        {:else}
          <button
            class="file-btn"
            class:active={$editorState.currentFile === node.path}
            on:click={() => void openRepoFile(node.path)}
          >
            <strong>{node.name}</strong>
          </button>
        {/if}
      </li>
    {/each}
  </ul>
{/if}

<style>
  .file-tree {
    height: 100%;
    padding: 0.75rem;
    overflow: auto;
  }

  .file-tree-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.25rem;
  }

  .file-tree-header h3 {
    margin: 0;
  }

  .collapse-all-btn {
    background: transparent;
    border: 1px solid transparent;
    border-radius: 6px;
    color: inherit;
    cursor: pointer;
    font-size: 1rem;
    line-height: 1;
    padding: 0.15rem 0.35rem;
    opacity: 0.7;
  }

  .collapse-all-btn:hover {
    border-color: #30363d;
    opacity: 1;
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
    margin-left: auto;
  }

  .panel-collapse-btn:hover {
    border-color: #30363d;
    opacity: 1;
  }

  ul {
    margin: 0;
    padding-left: 1rem;
    list-style: none;
    display: grid;
    gap: 0.15rem;
  }

  .dir-toggle {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    width: 100%;
    text-align: left;
    background: transparent;
    color: inherit;
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 0.2rem 0.4rem;
    cursor: pointer;
    opacity: 0.9;
  }

  .dir-toggle:hover {
    border-color: #30363d;
    opacity: 1;
  }

  .chevron {
    display: inline-block;
    font-size: 0.65em;
    transition: transform 0.15s ease;
    transform: rotate(90deg);
  }

  .chevron.collapsed {
    transform: rotate(0deg);
  }

  .file-btn {
    width: 100%;
    text-align: left;
    background: transparent;
    color: inherit;
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 0.25rem 0.4rem;
    cursor: pointer;
  }

  .file-btn:hover {
    border-color: #30363d;
  }

  .file-btn.active {
    border-color: #30363d;
  }

  strong {
    font-weight: 600;
  }
</style>
