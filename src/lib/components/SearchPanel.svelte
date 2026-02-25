<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity';
  import { onDestroy } from 'svelte';
  import { activeRepo, openRepoFile } from '$lib/stores/repo';
  import { searchRepoFiles, type FileSearchResult } from '$lib/tauri/fs';

  let query = '';
  let results: FileSearchResult[] = [];
  let loading = false;
  let error: string | null = null;
  let totalMatches = 0;
  let capped = false;
  /** File paths whose match list is collapsed. */
  let collapsedFiles = new SvelteSet<string>();
  let searchInput: HTMLInputElement | null = null;

  // Debounce timer handle
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const DEBOUNCE_MS = 300;
  const CAP = 500;

  $: if (searchInput) searchInput.focus();

  function handleInput() {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runSearch, DEBOUNCE_MS);
  }

  async function runSearch() {
    const q = query.trim();
    if (!q || !$activeRepo) {
      results = [];
      totalMatches = 0;
      capped = false;
      error = null;
      return;
    }

    loading = true;
    error = null;
    try {
      const raw = await searchRepoFiles($activeRepo.localPath, q);
      results = raw;
      totalMatches = raw.reduce((sum, f) => sum + f.matches.length, 0);
      capped = totalMatches >= CAP;
      // Auto-expand all groups when fresh results arrive
      collapsedFiles = new SvelteSet<string>();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      results = [];
      totalMatches = 0;
      capped = false;
    } finally {
      loading = false;
    }
  }

  function toggleFile(file: string) {
    const next = new SvelteSet(collapsedFiles);
    if (next.has(file)) next.delete(file);
    else next.add(file);
    collapsedFiles = next;
  }

  function collapseAll() {
    collapsedFiles = new SvelteSet(results.map((r) => r.file));
  }

  function expandAll() {
    collapsedFiles = new SvelteSet<string>();
  }

  async function openMatch(file: string) {
    if (!$activeRepo) return;
    await openRepoFile(file);
  }

  /**
   * Split `text` into parts around a case-insensitive match of `term`,
   * returning an array of { text: string; highlight: boolean } segments.
   */
  function highlight(text: string, term: string): Array<{ text: string; highlight: boolean }> {
    if (!term) return [{ text, highlight: false }];
    const idx = text.toLowerCase().indexOf(term.toLowerCase());
    if (idx === -1) return [{ text, highlight: false }];
    return [
      { text: text.slice(0, idx), highlight: false },
      { text: text.slice(idx, idx + term.length), highlight: true },
      { text: text.slice(idx + term.length), highlight: false },
    ];
  }

  onDestroy(() => {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
  });
</script>

<div class="search-panel">
  <div class="search-input-row">
    <input
      bind:this={searchInput}
      class="search-input"
      type="search"
      placeholder="Search in files…"
      bind:value={query}
      on:input={handleInput}
      aria-label="Search across all files"
    />
  </div>

  {#if loading}
    <p class="status-line">Searching…</p>
  {:else if error}
    <p class="status-line error">{error}</p>
  {:else if query.trim() && results.length === 0}
    <p class="status-line dimmed">No results.</p>
  {:else if results.length > 0}
    <div class="results-summary">
      <span>
        {totalMatches} result{totalMatches === 1 ? '' : 's'} in {results.length} file{results.length === 1 ? '' : 's'}{capped ? ' (capped at 500)' : ''}
      </span>
      <div class="summary-actions">
        <button class="icon-btn" title="Expand all" on:click={expandAll}>⊞</button>
        <button class="icon-btn" title="Collapse all" on:click={collapseAll}>⊟</button>
      </div>
    </div>

    <ul class="file-list">
      {#each results as fileResult (fileResult.file)}
        <li class="file-group">
          <!-- File heading -->
          <button
            class="file-heading"
            on:click={() => toggleFile(fileResult.file)}
            title={fileResult.file}
          >
            <span class="chevron" class:collapsed={collapsedFiles.has(fileResult.file)}>▶</span>
            <span class="file-name">{fileResult.file.split('/').pop()}</span>
            <span class="file-dir">{fileResult.file.includes('/') ? fileResult.file.slice(0, fileResult.file.lastIndexOf('/')) : ''}</span>
            <span class="match-badge">{fileResult.matches.length}</span>
          </button>

          {#if !collapsedFiles.has(fileResult.file)}
            <ul class="match-list">
              {#each fileResult.matches as match (match.line)}
                <li>
                  <button
                    class="match-row"
                    on:click={() => openMatch(fileResult.file)}
                    title="Open {fileResult.file}"
                  >
                    <span class="line-num">{match.line}</span>
                    <span class="match-content">
                      {#each highlight(match.content, query.trim()) as seg}
                        {#if seg.highlight}
                          <mark>{seg.text}</mark>
                        {:else}
                          {seg.text}
                        {/if}
                      {/each}
                    </span>
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .search-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .search-input-row {
    padding: 0.5rem 0.75rem 0.35rem;
  }

  .search-input {
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

  .search-input:focus {
    border-color: #58a6ff;
  }

  .status-line {
    padding: 0.4rem 0.75rem;
    font-size: 0.8rem;
    margin: 0;
  }

  .status-line.dimmed {
    opacity: 0.55;
  }

  .status-line.error {
    color: #f85149;
  }

  .results-summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.2rem 0.75rem;
    font-size: 0.75rem;
    opacity: 0.7;
    border-bottom: 1px solid #21262d;
    flex-shrink: 0;
  }

  .summary-actions {
    display: flex;
    gap: 0.2rem;
  }

  .icon-btn {
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    color: inherit;
    cursor: pointer;
    font-size: 0.85rem;
    line-height: 1;
    padding: 0.1rem 0.25rem;
    opacity: 0.75;
  }

  .icon-btn:hover {
    border-color: #30363d;
    opacity: 1;
  }

  .file-list {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    flex: 1;
  }

  .file-group {
    border-bottom: 1px solid #21262d;
  }

  .file-heading {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    width: 100%;
    text-align: left;
    background: #161b22;
    color: inherit;
    border: none;
    padding: 0.3rem 0.6rem;
    cursor: pointer;
    font-size: 0.8rem;
    overflow: hidden;
  }

  .file-heading:hover {
    background: #1c2128;
  }

  .chevron {
    display: inline-block;
    font-size: 0.6em;
    transition: transform 0.12s ease;
    transform: rotate(90deg);
    flex-shrink: 0;
  }

  .chevron.collapsed {
    transform: rotate(0deg);
  }

  .file-name {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex-shrink: 0;
    max-width: 55%;
  }

  .file-dir {
    opacity: 0.5;
    font-size: 0.75em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
  }

  .match-badge {
    margin-left: auto;
    background: #30363d;
    border-radius: 999px;
    padding: 0 0.35rem;
    font-size: 0.7em;
    flex-shrink: 0;
  }

  .match-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .match-row {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    width: 100%;
    text-align: left;
    background: transparent;
    color: inherit;
    border: none;
    padding: 0.22rem 0.75rem 0.22rem 1.5rem;
    cursor: pointer;
    font-size: 0.8rem;
    overflow: hidden;
  }

  .match-row:hover {
    background: #161b22;
  }

  .line-num {
    flex-shrink: 0;
    opacity: 0.45;
    min-width: 2.2em;
    text-align: right;
    font-variant-numeric: tabular-nums;
    font-size: 0.75em;
  }

  .match-content {
    white-space: pre;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.8em;
  }

  mark {
    background: rgba(210, 153, 34, 0.35);
    color: inherit;
    border-radius: 2px;
    padding: 0 1px;
    font-weight: 600;
  }
</style>
