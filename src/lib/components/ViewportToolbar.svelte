<script lang="ts">
  import { activeRepo } from '$lib/stores/repo';
  import { previewState, setPreviewMode, setViewportPreset } from '$lib/stores/preview';
  import { layout } from '$lib/stores/layout';
</script>

<nav class="viewport-toolbar">
  <!-- Preview mode buttons -->
  <button
    class:active={$previewState.mode === 'jekyll'}
    disabled={$previewState.loading || !$activeRepo}
    on:click={() => {
      void setPreviewMode('jekyll', $activeRepo?.localPath);
    }}
  >
    Full Preview
  </button>
  <button
    class:active={$previewState.mode === 'instant'}
    on:click={() => {
      void setPreviewMode('instant');
    }}
  >
    Instant
  </button>

  <span class="divider" aria-hidden="true"></span>

  <!-- Viewport presets -->
  <button on:click={() => setViewportPreset('desktop')}>Desktop</button>
  <button on:click={() => setViewportPreset('tablet')}>Tablet</button>
  <button on:click={() => setViewportPreset('mobile')}>Mobile</button>
  <span class="dim">{$previewState.viewport.width}×{$previewState.viewport.height}</span>

  {#if $previewState.loading}
    <span class="dim">Starting Jekyll…</span>
  {/if}

  <span class="spacer"></span>

  <!-- Panel controls -->
  <button
    class="icon-btn"
    title={$layout.previewPosition === 'side' ? 'Move preview below editor' : 'Move preview beside editor'}
    on:click={() => layout.togglePreviewPosition()}
  >
    {$layout.previewPosition === 'side' ? '⬒' : '⬓'}
  </button>

  <button
    class="icon-btn"
    title={$layout.previewFullscreen ? 'Exit fullscreen' : 'Fullscreen preview'}
    on:click={() => layout.togglePreviewFullscreen()}
  >
    {$layout.previewFullscreen ? '⛶' : '⛶'}
    <span class="icon-label">{$layout.previewFullscreen ? 'Exit' : 'Full'}</span>
  </button>

  <button
    class="icon-btn"
    title="Collapse preview panel"
    on:click={() => layout.togglePreview()}
  >
    ✕
  </button>
</nav>

<style>
  .viewport-toolbar {
    display: flex;
    align-items: center;
    flex-wrap: nowrap;
    gap: 0.4rem;
    padding: 0.4rem 0.6rem;
    border-bottom: 1px solid #30363d;
    min-width: 0;
    overflow-x: auto;
  }

  .divider {
    width: 1px;
    height: 1rem;
    background: #30363d;
    flex-shrink: 0;
  }

  .spacer {
    flex: 1;
  }

  .dim {
    font-size: 0.8rem;
    opacity: 0.65;
    white-space: nowrap;
  }

  .icon-btn {
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    color: inherit;
    cursor: pointer;
    padding: 0.15rem 0.35rem;
    opacity: 0.75;
    display: flex;
    align-items: center;
    gap: 0.2rem;
    flex-shrink: 0;
    font-size: 0.85rem;
  }

  .icon-btn:hover,
  .icon-btn:focus-visible {
    opacity: 1;
    border-color: #30363d;
  }

  .icon-label {
    font-size: 0.75rem;
  }

  button.active {
    border-color: #388bfd;
    color: #79c0ff;
  }
</style>
