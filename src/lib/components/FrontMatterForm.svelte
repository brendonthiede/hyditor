<script lang="ts">
  import { editorState, updateCurrentContent } from '$lib/stores/editor';
  import {
    parseFrontmatter,
    removeFrontmatterField,
    renameFrontmatterField,
    upsertFrontmatterField
  } from '$lib/utils/frontmatter';

  type FrontmatterRow = {
    key: string;
    value: string;
  };

  let newKey = '';
  let newValue = '';

  $: currentFile = $editorState.currentFile;
  $: currentContent = $editorState.currentContent;
  $: parsed = parseFrontmatter(currentContent);
  $: rows = Object.entries(parsed.data).map<FrontmatterRow>(([key, value]) => ({ key, value: String(value) }));
  $: canEdit = Boolean(currentFile);

  function applyContent(nextContent: string): void {
    if (nextContent !== currentContent) {
      updateCurrentContent(nextContent);
    }
  }

  function handleValueInput(key: string, event: Event): void {
    const target = event.currentTarget as HTMLInputElement;
    applyContent(upsertFrontmatterField(currentContent, key, target.value));
  }

  function handleKeyChange(previousKey: string, event: Event): void {
    const target = event.currentTarget as HTMLInputElement;
    applyContent(renameFrontmatterField(currentContent, previousKey, target.value));
  }

  function handleRemove(key: string): void {
    applyContent(removeFrontmatterField(currentContent, key));
  }

  function handleAddField(): void {
    const key = newKey.trim();
    if (!key) {
      return;
    }

    applyContent(upsertFrontmatterField(currentContent, key, newValue));
    newKey = '';
    newValue = '';
  }

  let isCollapsed = false;
</script>

<section class="frontmatter-form">
  <header>
    <h3>Front Matter</h3>
    <div class="header-right">
      <p>Structured YAML fields</p>
      <button
        type="button"
        class="collapse-btn"
        aria-label={isCollapsed ? 'Expand front matter' : 'Collapse front matter'}
        on:click={() => (isCollapsed = !isCollapsed)}
      >{isCollapsed ? '▶' : '▼'}</button>
    </div>
  </header>

  {#if !isCollapsed}
    {#if !canEdit}
      <p class="empty">Select a file to edit front matter.</p>
    {:else}
      <div class="rows" aria-label="Front matter fields">
        {#if rows.length === 0}
          <p class="empty">No fields yet. Add one below.</p>
        {:else}
          {#each rows as row (row.key)}
            <div class="row">
              <input
                aria-label="Front matter key"
                class="key"
                type="text"
                value={row.key}
                on:change={(event) => handleKeyChange(row.key, event)}
              />
              <input
                aria-label="Front matter value"
                class="value"
                type="text"
                value={row.value}
                on:input={(event) => handleValueInput(row.key, event)}
              />
              <button type="button" on:click={() => handleRemove(row.key)}>Remove</button>
            </div>
          {/each}
        {/if}
      </div>

      <div class="add-row">
        <input aria-label="New front matter key" class="key" type="text" bind:value={newKey} placeholder="key" />
        <input
          aria-label="New front matter value"
          class="value"
          type="text"
          bind:value={newValue}
          placeholder="value"
        />
        <button type="button" on:click={handleAddField}>Add</button>
      </div>
    {/if}
  {/if}
</section>

<style>
  .frontmatter-form {
    border: 1px solid #30363d;
    border-radius: 6px;
    padding: 0.75rem;
    display: grid;
    gap: 0.5rem;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .collapse-btn {
    border: none;
    background: transparent;
    color: inherit;
    padding: 0 0.25rem;
    cursor: pointer;
    font-size: 0.7rem;
    opacity: 0.7;
    line-height: 1;
  }

  .collapse-btn:hover {
    opacity: 1;
  }

  h3 {
    margin: 0;
    font-size: 0.95rem;
  }

  p {
    margin: 0;
    font-size: 0.8rem;
    opacity: 0.75;
  }

  .rows {
    display: grid;
    gap: 0.4rem;
  }

  .row,
  .add-row {
    display: grid;
    grid-template-columns: minmax(7rem, 1fr) minmax(10rem, 2fr) auto;
    gap: 0.4rem;
    align-items: center;
  }

  input,
  button {
    border: 1px solid #30363d;
    background: transparent;
    color: inherit;
    border-radius: 6px;
    padding: 0.3rem 0.45rem;
  }

  button {
    cursor: pointer;
    white-space: nowrap;
  }

  .empty {
    font-size: 0.8rem;
    opacity: 0.8;
    padding: 0.2rem 0;
  }
</style>
