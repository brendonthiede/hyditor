<script lang="ts">
  import { previewState, setViewportPreset } from '$lib/stores/preview';
  import { layout } from '$lib/stores/layout';
  import { openPreviewPopup, closePreviewPopup } from '$lib/tauri/window';

  async function handlePopOut(): Promise<void> {
    if ($layout.previewPoppedOut) {
      await closePreviewPopup();
      layout.setPreviewPoppedOut(false);
    } else {
      try {
        const { mode, jekyllBaseUrl } = $previewState;
        if (mode === 'jekyll' && jekyllBaseUrl) {
          await openPreviewPopup({ mode: 'jekyll', url: jekyllBaseUrl });
        } else {
          await openPreviewPopup({ mode: 'instant' });
        }
        layout.setPreviewPoppedOut(true);
      } catch (err) {
        console.error('[PopOut] Failed to open preview window:', err);
      }
    }
  }
</script>

<nav class="viewport-toolbar">
  <!-- Viewport preset dropdown -->
  <select
    class="viewport-select"
    value={$previewState.viewportPreset}
    on:change={(e) => setViewportPreset(e.currentTarget.value as 'desktop' | 'tablet' | 'mobile')}
  >
    <option value="desktop">Desktop (1440×900)</option>
    <option value="tablet">Tablet (768×1024)</option>
    <option value="mobile">Mobile (375×812)</option>
  </select>

  {#if $previewState.loading}
    <span class="dim">Starting Jekyll…</span>
  {/if}

  <span class="spacer"></span>

  <!-- Panel controls -->
  <div class="icon-group">
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
    </button>

    <button
      class="icon-btn"
      class:active={$layout.previewPoppedOut}
      title={$layout.previewPoppedOut ? 'Close pop-out window' : 'Pop out to new window'}
      on:click={() => void handlePopOut()}
    >
      ⧉
    </button>

    <button
      class="icon-btn"
      title="Collapse preview panel"
      on:click={() => layout.togglePreview()}
    >
      ✕
    </button>
  </div>
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

  .spacer {
    flex: 1;
  }

  .dim {
    font-size: 0.8rem;
    opacity: 0.65;
    white-space: nowrap;
  }

  .icon-group {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    flex-shrink: 0;
  }

  .icon-btn {
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    color: #c9d1d9;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    font-size: 0.85rem;
    line-height: 1;
    opacity: 0.75;
    flex-shrink: 0;
  }

  .icon-btn:hover,
  .icon-btn:focus-visible {
    opacity: 1;
    border-color: #30363d;
  }

  .icon-btn.active {
    border-color: #388bfd;
    color: #79c0ff;
    opacity: 1;
  }

  .viewport-select {
    background: #c9d1d9;
    border: 1px solid #484f58;
    border-radius: 4px;
    color: #0d1117;
    cursor: pointer;
    padding: 0.2rem 0.35rem;
    font-size: 0.8rem;
    flex-shrink: 0;
  }

  .viewport-select:hover,
  .viewport-select:focus-visible {
    border-color: #8b949e;
  }
</style>
