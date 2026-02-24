<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { basicSetup, EditorView } from 'codemirror';
  import { Compartment, EditorState } from '@codemirror/state';
  import { markdown } from '@codemirror/lang-markdown';
  import { yaml } from '@codemirror/lang-yaml';
  import { html } from '@codemirror/lang-html';
  import FrontMatterForm from '$lib/components/FrontMatterForm.svelte';
  import {
    editorState,
    markCurrentContentSaved,
    updateCurrentContent
  } from '$lib/stores/editor';
  import { saveRepoFile } from '$lib/stores/repo';

  $: currentFile = $editorState.currentFile;
  $: currentContent = $editorState.currentContent;
  $: originalContent = $editorState.originalContent;
  $: fileName = currentFile ? currentFile.split('/').pop() ?? currentFile : null;
  $: directoryPath = currentFile && fileName ? currentFile.slice(0, Math.max(0, currentFile.length - fileName.length - 1)) : '';

  let editorHost: HTMLDivElement;
  let view: EditorView | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const languageCompartment = new Compartment();

  function languageForPath(path: string | null) {
    const normalized = path?.toLowerCase() ?? '';
    if (normalized.endsWith('.yml') || normalized.endsWith('.yaml')) {
      return yaml();
    }
    if (
      normalized.endsWith('.html') ||
      normalized.endsWith('.liquid') ||
      normalized.includes('/_layouts/') ||
      normalized.includes('/_includes/')
    ) {
      return html();
    }
    return markdown();
  }

  onMount(() => {
    view = new EditorView({
      parent: editorHost,
      state: EditorState.create({
        doc: currentContent,
        extensions: [
          basicSetup,
          EditorView.lineWrapping,
          languageCompartment.of(languageForPath(currentFile)),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) {
              return;
            }
            const content = update.state.doc.toString();
            if (content !== currentContent) {
              updateCurrentContent(content);
            }
          })
        ]
      })
    });
  });

  onDestroy(() => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }

    view?.destroy();
    view = null;
  });

  $: if (view) {
    const currentDoc = view.state.doc.toString();
    if (currentDoc !== currentContent) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: currentContent }
      });
    }
  }

  $: if (view) {
    view.dispatch({
      effects: languageCompartment.reconfigure(languageForPath(currentFile))
    });
  }

  $: {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }

    if (currentFile && currentContent !== originalContent) {
      saveTimer = setTimeout(async () => {
        try {
          await saveRepoFile(currentFile, currentContent);
          markCurrentContentSaved();
        } catch {
          return;
        }
      }, 500);
    }
  }
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
  <FrontMatterForm />
  <div bind:this={editorHost} class="editor-host" aria-label="Code editor"></div>
</section>

<style>
  .editor {
    height: 100%;
    display: grid;
    grid-template-rows: auto auto 1fr;
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

  .editor-host {
    width: 100%;
    height: 100%;
    border: 1px solid #30363d;
    background: transparent;
  }

  .editor-host :global(.cm-editor) {
    height: 100%;
    background: transparent;
    color: inherit;
  }

  .editor-host :global(.cm-scroller) {
    font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace;
    line-height: 1.45;
  }

  .editor-host :global(.cm-gutters) {
    background: transparent;
    border-right: 1px solid #30363d;
  }
</style>
