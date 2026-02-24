<script lang="ts">
  import { activeRepo } from '$lib/stores/repo';
  import { editorState } from '$lib/stores/editor';
  import { previewState, setPreviewMode, setViewportPreset } from '$lib/stores/preview';
</script>

<nav class="viewport-toolbar">
  <button
    class:active={$previewState.mode === 'instant'}
    on:click={() => {
      void setPreviewMode('instant');
    }}
  >
    Instant
  </button>
  <button
    class:active={$previewState.mode === 'jekyll'}
    disabled={$previewState.loading || !$activeRepo}
    on:click={() => {
      void setPreviewMode('jekyll', $activeRepo?.localPath, $editorState.currentFile, $editorState.currentContent);
    }}
  >
    Full Preview
  </button>
  <button on:click={() => setViewportPreset('desktop')}>Desktop</button>
  <button on:click={() => setViewportPreset('tablet')}>Tablet</button>
  <button on:click={() => setViewportPreset('mobile')}>Mobile</button>
  <span>{$previewState.viewport.width}×{$previewState.viewport.height}</span>
  {#if $previewState.loading}
    <span>Starting Jekyll…</span>
  {/if}
</nav>

<style>
  .viewport-toolbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid #30363d;
  }

  button.active {
    border-color: #30363d;
  }
</style>
