<script lang="ts">
  import { onDestroy } from 'svelte';
  import ViewportToolbar from '$lib/components/ViewportToolbar.svelte';
  import { editorState } from '$lib/stores/editor';
  import { previewState, stopJekyllPreview, navigateToCurrentFile } from '$lib/stores/preview';
  import { parseFrontmatter } from '$lib/utils/frontmatter';
  import { renderMarkdown } from '$lib/utils/markdown';

  $: parsed = parseFrontmatter($editorState.currentContent);
  $: rendered = renderMarkdown(parsed.content);
  $: frontmatterEntries = Object.entries(parsed.data);

  // When in Jekyll mode, keep the iframe pointed at the current file.
  $: if ($previewState.mode === 'jekyll') {
    navigateToCurrentFile($editorState.currentFile);
  }

  onDestroy(() => {
    void stopJekyllPreview();
  });
</script>

<section class="preview">
  <ViewportToolbar />
  {#if $previewState.error}
    <p class="error">{$previewState.error}</p>
  {/if}
  <div class="preview-canvas">
    <div
      class="viewport"
      style={`width: ${$previewState.viewport.width}px; height: ${$previewState.viewport.height}px;`}
    >
      {#if $previewState.mode === 'jekyll' && $previewState.jekyllUrl}
        <iframe title="Jekyll preview" src={$previewState.jekyllUrl}></iframe>
      {:else}
        <article>
          {#if frontmatterEntries.length > 0}
            <header class="frontmatter">
              {#each frontmatterEntries as [key, value]}
                <p><strong>{key}:</strong> {String(value)}</p>
              {/each}
            </header>
          {/if}
          {@html rendered}
        </article>
      {/if}
    </div>
  </div>
</section>

<style>
  .preview {
    height: 100%;
    display: grid;
    grid-template-rows: auto 1fr;
    overflow: hidden;
  }

  .error {
    margin: 0;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid #30363d;
    color: #f85149;
  }

  .preview-canvas {
    overflow: auto;
    padding: 0.75rem;
    display: flex;
    justify-content: center;
    align-items: flex-start;
  }

  .viewport {
    max-width: 100%;
    max-height: 100%;
    border: 1px solid #30363d;
    background: #0d1117;
    overflow: hidden;
  }

  iframe {
    width: 100%;
    height: 100%;
    border: 0;
    background: #fff;
  }

  article {
    overflow: auto;
    width: 100%;
    height: 100%;
    padding: 0.75rem;
  }

  .frontmatter {
    margin-bottom: 1rem;
    padding: 0.5rem;
    border: 1px solid #30363d;
    border-radius: 6px;
  }

  .frontmatter p {
    margin: 0;
    font-size: 0.85rem;
  }

  .frontmatter p + p {
    margin-top: 0.25rem;
  }
</style>
