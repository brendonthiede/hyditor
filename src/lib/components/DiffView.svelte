<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { MergeView } from '@codemirror/merge';
  import { basicSetup, EditorView } from 'codemirror';
  import { EditorState } from '@codemirror/state';
  import { oneDark } from '@codemirror/theme-one-dark';
  import {
    diffState,
    editorState,
    exitDiffMode,
    updateCurrentContent,
    markCurrentContentSaved
  } from '$lib/stores/editor';
  import { activeRepo, saveRepoFile } from '$lib/stores/repo';
  import { applyLineEnding, equalsIgnoringLineEndings } from '$lib/utils/lineEndings';

  $: diff = $diffState;
  $: currentContent = $editorState.currentContent;
  $: originalContent = $editorState.originalContent;
  $: lineEnding = $editorState.lineEnding;
  $: currentFile = $editorState.currentFile;
  $: fileName = diff.filePath ? diff.filePath.split('/').pop() ?? diff.filePath : null;
  $: directoryPath =
    diff.filePath && fileName
      ? diff.filePath.slice(0, Math.max(0, diff.filePath.length - fileName.length - 1))
      : '';

  let diffHost: HTMLDivElement;
  let mergeView: MergeView | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  onMount(() => {
    mergeView = new MergeView({
      parent: diffHost,
      a: {
        doc: diff.headContent,
        extensions: [
          basicSetup,
          oneDark,
          EditorView.lineWrapping,
          EditorState.readOnly.of(true)
        ]
      },
      b: {
        doc: currentContent,
        extensions: [
          basicSetup,
          oneDark,
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            const content = update.state.doc.toString();
            if (content !== currentContent) {
              updateCurrentContent(content);
            }
          })
        ]
      },
      gutter: true
    });
  });

  onDestroy(() => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    mergeView?.destroy();
    mergeView = null;
  });

  // Sync external content changes into the merge view's modified (b) editor
  $: if (mergeView) {
    const bView = mergeView.b;
    const currentDoc = bView.state.doc.toString();
    if (currentDoc !== currentContent) {
      bView.dispatch({
        changes: { from: 0, to: bView.state.doc.length, insert: currentContent }
      });
    }
  }

  // Auto-save (same debounce logic as Editor.svelte)
  $: {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }

    if (currentFile && currentContent !== originalContent) {
      saveTimer = setTimeout(async () => {
        const contentToSave = currentContent;

        if (equalsIgnoringLineEndings(contentToSave, originalContent)) {
          markCurrentContentSaved(contentToSave);
          return;
        }

        try {
          await saveRepoFile(currentFile, applyLineEnding(contentToSave, lineEnding));
          markCurrentContentSaved(contentToSave);
        } catch {
          return;
        }
      }, 500);
    }
  }
</script>

<section class="diff-view">
  <header>
    <div class="header-left">
      <h3>Diff</h3>
      {#if diff.filePath && fileName}
        <p class="file-info">
          {#if directoryPath}<span class="dir">{directoryPath}/</span>{/if}<strong>{fileName}</strong>
          <span class="status-tag">{diff.fileStatus}</span>
        </p>
      {/if}
    </div>
    <button class="close-btn" title="Close diff view" on:click={exitDiffMode}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z"/>
      </svg>
    </button>
  </header>
  <div class="column-labels">
    <span class="label original">HEAD (original)</span>
    <span class="label modified">Working copy (editable)</span>
  </div>
  <div bind:this={diffHost} class="diff-host" aria-label="Diff view"></div>
</section>

<style>
  .diff-view {
    height: 100%;
    display: flex;
    flex-direction: column;
    padding: 0.75rem;
    gap: 0.5rem;
    overflow: hidden;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    flex-shrink: 0;
  }

  .header-left {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    min-width: 0;
    overflow: hidden;
  }

  h3 {
    margin: 0;
    flex-shrink: 0;
  }

  .file-info {
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

  .status-tag {
    margin-left: 0.5rem;
    font-size: 0.7rem;
    text-transform: uppercase;
    opacity: 0.65;
    background: #30363d;
    padding: 0.1rem 0.35rem;
    border-radius: 3px;
  }

  .close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    color: inherit;
    border-radius: 4px;
    padding: 0.3rem;
    cursor: pointer;
    opacity: 0.7;
    transition: opacity 0.15s, background 0.15s;
    flex-shrink: 0;
  }

  .close-btn:hover {
    opacity: 1;
    background: #30363d;
  }

  .column-labels {
    display: flex;
    gap: 0;
    flex-shrink: 0;
  }

  .label {
    flex: 1;
    font-size: 0.75rem;
    opacity: 0.55;
    padding: 0.15rem 0.5rem;
    text-align: center;
  }

  .diff-host {
    flex: 1;
    min-height: 0;
    border: 1px solid #30363d;
    background: transparent;
    overflow: overlay;
  }

  /* MergeView container fills the host */
  .diff-host :global(.cm-merge-view) {
    height: 100%;
    overflow: hidden;
  }

  /* Both editor panels inside the merge view */
  .diff-host :global(.cm-editor) {
    height: 100%;
    background: transparent;
    color: inherit;
    overflow: hidden;
  }

  .diff-host :global(.cm-scroller) {
    font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace;
    line-height: 1.45;
    overflow: auto !important;
  }

  .diff-host :global(.cm-gutters) {
    background: transparent;
    border-right: 1px solid #30363d;
  }

  /* Deleted lines (in the original/left panel) */
  .diff-host :global(.cm-deletedChunk) {
    background-color: rgba(248, 81, 73, 0.15);
  }

  .diff-host :global(.cm-deletedText) {
    background-color: rgba(248, 81, 73, 0.3);
  }

  /* Inserted lines (in the modified/right panel) */
  .diff-host :global(.cm-insertedChunk) {
    background-color: rgba(63, 185, 80, 0.15);
  }

  .diff-host :global(.cm-insertedText) {
    background-color: rgba(63, 185, 80, 0.3);
  }

  /* Change gutter markers */
  .diff-host :global(.cm-changeGutter) {
    width: 4px;
    min-width: 4px;
  }

  .diff-host :global(.cm-deletedLineGutter) {
    background-color: #f85149;
  }

  .diff-host :global(.cm-insertedLineGutter) {
    background-color: #3fb950;
  }
</style>
