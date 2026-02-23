<script lang="ts">
  import { editorState, updateCurrentContent } from '$lib/stores/editor';

  $: currentFile = $editorState.currentFile;
  $: fileName = currentFile ? currentFile.split('/').pop() ?? currentFile : null;
  $: directoryPath = currentFile && fileName ? currentFile.slice(0, Math.max(0, currentFile.length - fileName.length - 1)) : '';
</script>

<section class="editor">
  <header>
    <h3>Editor</h3>
    {#if currentFile && fileName}
      <p>
        {#if directoryPath}<span class="dir">{directoryPath}/</span>{/if}<strong>{fileName}</strong>
      </p>
    {:else}
      <p>No file selected</p>
    {/if}
  </header>
  <textarea
    value={$editorState.currentContent}
    on:input={(event) => updateCurrentContent((event.target as HTMLTextAreaElement).value)}
  ></textarea>
</section>

<style>
  .editor {
    height: 100%;
    display: grid;
    grid-template-rows: auto 1fr;
    padding: 0.75rem;
    gap: 0.5rem;
  }

  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.75rem;
  }

  h3 {
    margin: 0;
  }

  p {
    margin: 0;
    font-size: 0.85rem;
    opacity: 0.75;
    text-overflow: ellipsis;
    overflow: hidden;
    white-space: nowrap;
  }

  .dir {
    opacity: 0.75;
  }

  strong {
    font-weight: 600;
  }

  textarea {
    width: 100%;
    height: 100%;
    resize: none;
    border: 1px solid #30363d;
    background: transparent;
    color: inherit;
    padding: 0.75rem;
  }
</style>
