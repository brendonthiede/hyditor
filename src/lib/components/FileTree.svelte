<script context="module" lang="ts">
  import { derived, writable } from 'svelte/store';

  interface TreeNode {
    name: string;
    path: string;
    is_dir: boolean;
    children: TreeNode[];
  }

  /** Top-level directory/file names that are not relevant to Jekyll sites. */
  const JEKYLL_IGNORED_NAMES = new Set([
    'node_modules',
    'vendor',
    '.bundle',
    '_site',
    '.sass-cache',
    '.jekyll-cache',
    '.jekyll-metadata',
    '_includes',
    '_layouts',
    '_sass'
  ]);

  /** Subdirectory names under `assets/` that are hidden in Jekyll-relevant mode. */
  const ASSETS_HIDDEN_SUBDIRS = new Set(['js', 'css', 'scss']);

  /** File extensions that are binary/non-previewable (images excluded — they
   *  are referenced in posts and should remain visible in the tree). */
  const BINARY_EXTENSIONS = new Set([
    '.woff', '.woff2', '.ttf', '.eot', '.otf',
    '.zip', '.tar', '.gz', '.bz2', '.br', '.7z', '.rar',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.exe', '.bin', '.o', '.so', '.dylib', '.a',
    '.mp4', '.mp3', '.mov', '.avi', '.wav', '.ogg', '.flac', '.mid',
    '.pyc', '.class', '.wasm'
  ]);

  function isBinary(path: string): boolean {
    const dot = path.lastIndexOf('.');
    if (dot === -1) return false;
    return BINARY_EXTENSIONS.has(path.slice(dot).toLowerCase());
  }

  function topLevelName(path: string): string {
    return path.split('/')[0];
  }

  /**
   * Returns true when the item lives under one of the hidden subdirectories of
   * the top-level `assets/` folder (e.g. `assets/js/…`, `assets/css/…`,
   * `assets/scss/…`).
   */
  function isAssetsHiddenSubdir(path: string): boolean {
    const parts = path.split('/');
    if (parts.length < 2 || parts[0] !== 'assets') return false;
    return ASSETS_HIDDEN_SUBDIRS.has(parts[1]);
  }

  const collapsedDirs = writable<Set<string>>(new Set());
  const filterText = writable('');
  const showAll = writable(false);

  interface ContextMenu {
    type: 'dir' | 'file';
    path: string;
    absPath: string;
    x: number;
    y: number;
  }
  const contextMenu = writable<ContextMenu | null>(null);

  /**
   * When a search query is active every directory should be expanded so the
   * user can see matching results without having to manually open folders.
   */
  const effectiveCollapsedDirs = derived(
    [filterText, collapsedDirs],
    ([$filterText, $collapsedDirs]) =>
      $filterText.trim() ? (new Set<string>()) : $collapsedDirs
  );
</script>

<script lang="ts">
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import { editorState, fileTree } from '$lib/stores/editor';
  import { activeRepo, openRepoFile } from '$lib/stores/repo';
  import { layout } from '$lib/stores/layout';
  import { copyFileIntoRepo, exportFile, readTree } from '$lib/tauri/fs';
  import { open as openFilePicker, save as saveFilePicker } from '@tauri-apps/plugin-dialog';
  import SearchPanel from '$lib/components/SearchPanel.svelte';
  import GitPanel from '$lib/components/GitPanel.svelte';
  import AiPanel from '$lib/components/AiPanel.svelte';

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

  function applyFilters(
    items: { path: string; is_dir: boolean }[],
    all: boolean,
    query: string
  ): { path: string; is_dir: boolean }[] {
    let filtered = items;

    if (!all) {
      // Remove Jekyll-irrelevant top-level entries (whole subtrees already
      // excluded by checking the first path segment).
      filtered = filtered.filter((item) => !JEKYLL_IGNORED_NAMES.has(topLevelName(item.path)));
      // Hide assets/js, assets/css, assets/scss subdirectories (but keep
      // other assets content like images visible).
      filtered = filtered.filter((item) => !isAssetsHiddenSubdir(item.path));
      // Remove binary files (keep directories — their children drive visibility).
      filtered = filtered.filter((item) => item.is_dir || !isBinary(item.path));
    }

    const q = query.trim().toLowerCase();
    if (q) {
      // Collect files/dirs whose name matches, plus all their ancestor dirs.
      const keep = new SvelteSet<string>();
      for (const item of filtered) {
        const name = item.path.split('/').pop() ?? '';
        if (name.toLowerCase().includes(q)) {
          keep.add(item.path);
          // Add every ancestor path so the tree renders correctly.
          const parts = item.path.split('/');
          for (let i = 1; i < parts.length; i++) {
            keep.add(parts.slice(0, i).join('/'));
          }
        }
      }
      filtered = filtered.filter((item) => keep.has(item.path));
    }

    return filtered;
  }

  async function addFileToDir(absPath: string): Promise<void> {
    contextMenu.set(null);
    const selected = await openFilePicker({ multiple: false, directory: false });
    if (!selected) return;
    const srcPath = typeof selected === 'string' ? selected : selected[0];
    if (!srcPath) return;
    try {
      await copyFileIntoRepo(srcPath, absPath);
      const repo = $activeRepo;
      if (repo) {
        const tree = await readTree(repo.localPath);
        fileTree.set(tree);
      }
    } catch (err) {
      console.error('Failed to copy file:', err);
    }
  }

  async function downloadFile(fileName: string, absPath: string): Promise<void> {
    contextMenu.set(null);
    const lastDir = localStorage.getItem('hyditor:lastSaveDir');
    const defaultPath = lastDir ? `${lastDir}/${fileName}` : fileName;
    const destPath = await saveFilePicker({ defaultPath });
    if (!destPath) return;
    try {
      await exportFile(absPath, destPath);
      const lastSlash = Math.max(destPath.lastIndexOf('/'), destPath.lastIndexOf('\\'));
      if (lastSlash > 0) {
        localStorage.setItem('hyditor:lastSaveDir', destPath.slice(0, lastSlash));
      }
    } catch (err) {
      console.error('Failed to export file:', err);
    }
  }

  function onDirContextMenu(e: MouseEvent, dirPath: string): void {
    const repo = $activeRepo;
    if (!repo) return;
    e.preventDefault();
    contextMenu.set({ type: 'dir', path: dirPath, absPath: `${repo.localPath}/${dirPath}`, x: e.clientX, y: e.clientY });
  }

  function onFileDragStart(e: DragEvent, path: string): void {
    e.dataTransfer?.setData('text/x-hyditor-file', path);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
  }

  function onFileContextMenu(e: MouseEvent, filePath: string): void {
    const repo = $activeRepo;
    if (!repo) return;
    e.preventDefault();
    contextMenu.set({ type: 'file', path: filePath, absPath: `${repo.localPath}/${filePath}`, x: e.clientX, y: e.clientY });
  }

  $: isRoot = nodes === undefined;
  $: filteredItems = isRoot ? applyFilters($fileTree, $showAll, $filterText) : [];
  $: tree = isRoot ? buildTree(filteredItems) : [];
  $: displayNodes = nodes ?? tree;
  $: hiddenCount = isRoot && !$showAll
    ? $fileTree.filter(
        (item) =>
          JEKYLL_IGNORED_NAMES.has(topLevelName(item.path)) ||
          isAssetsHiddenSubdir(item.path) ||
          (!item.is_dir && isBinary(item.path))
      ).length
    : 0;
</script>

{#if $contextMenu && isRoot}
  <div
    style="position:fixed;inset:0;z-index:999;"
    role="button"
    tabindex="-1"
    on:click={() => contextMenu.set(null)}
    on:keydown={(e) => { if (e.key === 'Escape') contextMenu.set(null); }}
    on:contextmenu|preventDefault={() => contextMenu.set(null)}
  ></div>
  <div
    class="ctx-menu"
    style="position:fixed;z-index:1000;left:{$contextMenu.x}px;top:{$contextMenu.y}px;"
  >
    {#if $contextMenu.type === 'dir'}
      <button on:click={() => addFileToDir($contextMenu!.absPath)}>Add file here…</button>
    {:else}
      <button on:click={() => downloadFile($contextMenu!.path.split('/').pop() ?? $contextMenu!.path, $contextMenu!.absPath)}>
        Save a copy…
      </button>
    {/if}
  </div>
{/if}

{#if isRoot}
  <section class="file-tree">
    <div class="file-tree-header">
      <div class="blade-tabs">
        <button
          class="blade-tab"
          class:active={$layout.leftPanelBlade === 'files'}
          on:click={() => layout.setLeftPanelBlade('files')}
        >Files</button>
        <button
          class="blade-tab"
          class:active={$layout.leftPanelBlade === 'search'}
          on:click={() => layout.setLeftPanelBlade('search')}
        >Search</button>
        <button
          class="blade-tab"
          class:active={$layout.leftPanelBlade === 'git'}
          on:click={() => layout.setLeftPanelBlade('git')}
        >Publish</button>
        <button
          class="blade-tab"
          class:active={$layout.leftPanelBlade === 'ai'}
          on:click={() => layout.setLeftPanelBlade('ai')}
        >AI</button>
      </div>
      {#if $layout.leftPanelBlade === 'files' && $fileTree.length > 0}
        <button class="icon-btn" title="Collapse all folders" on:click={collapseAll}>
          ⊟
        </button>
        <button
          class="icon-btn"
          class:active={$showAll}
          title={$showAll
            ? 'Showing all files — click to hide non-Jekyll / binary files'
            : 'Filtering to Jekyll-relevant files — click to show all files'}
          on:click={() => showAll.update((v) => !v)}
        >
          {$showAll ? '👁' : '🔽'}
        </button>
      {/if}
      <button class="panel-collapse-btn" title="Collapse file panel" on:click={() => layout.toggleFileTree()}>
        ◀
      </button>
    </div>

    {#if $layout.leftPanelBlade === 'search'}
      <div class="blade-content">
        <SearchPanel />
      </div>
    {:else if $layout.leftPanelBlade === 'git'}
      <div class="blade-content">
        <GitPanel />
      </div>
    {:else if $layout.leftPanelBlade === 'ai'}
      <div class="blade-content">
        <AiPanel />
      </div>
    {:else}
      {#if $fileTree.length > 0}
        <div class="filter-row">
          <input
            class="filter-input"
            type="search"
            placeholder="Filter files…"
            bind:value={$filterText}
            aria-label="Filter files by name"
          />
        </div>
        {#if !$showAll && hiddenCount > 0}
          <p class="hidden-notice">
            {hiddenCount} item{hiddenCount === 1 ? '' : 's'} hidden — <button class="inline-link" on:click={() => showAll.set(true)}>show all</button>
          </p>
        {/if}
      {/if}
      <div class="file-list-scroll">
        {#if $fileTree.length === 0}
          <p>No files loaded.</p>
        {:else if filteredItems.length === 0}
          <p class="no-results">No files match.</p>
        {:else}
          <svelte:self nodes={displayNodes} />
        {/if}
      </div>
    {/if}
  </section>
{:else}
  <ul>
    {#each displayNodes as node (node.path)}
      <li>
        {#if node.is_dir}
          <button
            class="dir-toggle"
            on:click={() => { contextMenu.set(null); toggleDir(node.path); }}
            on:contextmenu={(e) => onDirContextMenu(e, node.path)}
          >
            <span class="chevron" class:collapsed={$effectiveCollapsedDirs.has(node.path)}>▶</span>
            <strong>{node.name}</strong>
          </button>
          {#if !$effectiveCollapsedDirs.has(node.path) && node.children.length > 0}
            <svelte:self nodes={node.children} />
          {/if}
        {:else}
          <button
            class="file-btn"
            class:active={$editorState.currentFile === node.path}
            draggable="true"
            on:click={() => { contextMenu.set(null); void openRepoFile(node.path); }}
            on:contextmenu={(e) => onFileContextMenu(e, node.path)}
            on:dragstart={(e) => onFileDragStart(e, node.path)}
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
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .file-tree-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.25rem;
    flex-shrink: 0;
  }

  .blade-tabs {
    display: flex;
    gap: 0;
    flex-shrink: 0;
  }

  .blade-tab {
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: inherit;
    cursor: pointer;
    font-size: 0.8rem;
    font-weight: 500;
    padding: 0.2rem 0.5rem 0.15rem;
    opacity: 0.55;
    transition: opacity 0.1s, border-color 0.1s;
    border-radius: 0;
  }

  .blade-tab:hover {
    opacity: 0.85;
  }

  .blade-tab.active {
    opacity: 1;
    border-bottom-color: #58a6ff;
  }

  .icon-btn {
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

  .icon-btn:hover {
    border-color: #30363d;
    opacity: 1;
  }

  .icon-btn.active {
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

  .filter-row {
    margin-bottom: 0.35rem;
    flex-shrink: 0;
  }

  .filter-input {
    width: 100%;
    box-sizing: border-box;
    background: #0d1117;
    color: inherit;
    border: 1px solid #30363d;
    border-radius: 6px;
    padding: 0.3rem 0.5rem;
    font-size: 0.85rem;
    outline: none;
  }

  .filter-input:focus {
    border-color: #58a6ff;
  }

  .hidden-notice {
    font-size: 0.75rem;
    opacity: 0.6;
    margin: 0 0 0.35rem;
    flex-shrink: 0;
  }

  .blade-content {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .file-list-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  .inline-link {
    background: none;
    border: none;
    color: #58a6ff;
    cursor: pointer;
    font-size: inherit;
    padding: 0;
    text-decoration: underline;
  }

  .no-results {
    font-size: 0.85rem;
    opacity: 0.6;
    margin-top: 0.5rem;
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

  :global(.ctx-menu) {
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 6px;
    padding: 0.25rem 0;
    min-width: 160px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  }

  :global(.ctx-menu button) {
    display: block;
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    color: inherit;
    cursor: pointer;
    font-size: 0.85rem;
    padding: 0.4rem 0.75rem;
  }

  :global(.ctx-menu button:hover) {
    background: #21262d;
  }
</style>
