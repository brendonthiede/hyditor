<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { listen } from '@tauri-apps/api/event';
  import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
  import ViewportToolbar from '$lib/components/ViewportToolbar.svelte';
  import { editorState } from '$lib/stores/editor';
  import { previewState, stopJekyllPreview } from '$lib/stores/preview';
  import { layout } from '$lib/stores/layout';
  import { parseFrontmatter } from '$lib/utils/frontmatter';
  import { renderMarkdown } from '$lib/utils/markdown';
  import { jekyllUrlForFile } from '$lib/utils/jekyll';
  import { isHtmlPath } from '$lib/utils/errors';
  import { PREVIEW_POPUP_LABEL, emitToPreviewPopup } from '$lib/tauri/window';

  $: parsed = parseFrontmatter($editorState.currentContent);
  $: isHtml = isHtmlPath($editorState.currentFile ?? '');
  // For HTML files the body is already HTML — skip the markdown pipeline.
  $: rendered = isHtml ? parsed.content : renderMarkdown(parsed.content);
  $: frontmatterEntries = Object.entries(parsed.data);

  // Derive the iframe URL directly from editor + preview state with no store
  // writes, so there is no circular reactive dependency.
  $: iframeUrl = (() => {
    const { mode, jekyllBaseUrl, repoPath, sitePermalink } = $previewState;
    if (mode !== 'jekyll' || !jekyllBaseUrl) return null;
    const file = $editorState.currentFile;
    if (!file || !repoPath) return jekyllBaseUrl;
    // currentFile may be a relative path from the repo root — make it absolute
    const absFile = file.startsWith('/') ? file : `${repoPath}/${file}`;
    return jekyllUrlForFile(jekyllBaseUrl, repoPath, absFile, $editorState.currentContent, sitePermalink);
  })();

  // Debounced iframe URL — prevents rapid reloads during frontmatter edits
  let debouncedIframeUrl: string | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const IFRAME_RELOAD_DELAY_MS = 1000;

  function applyIframeUrl(url: string | null): void {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (url === null || debouncedIframeUrl === null) {
      // Mode switch or first URL — apply immediately
      debouncedIframeUrl = url;
    } else if (url !== debouncedIframeUrl) {
      debounceTimer = setTimeout(() => {
        debouncedIframeUrl = url;
        debounceTimer = null;
      }, IFRAME_RELOAD_DELAY_MS);
    }
  }

  $: applyIframeUrl(iframeUrl);

  // Push instant-mode content to the pop-out window whenever it changes.
  $: if ($layout.previewPoppedOut && $previewState.mode === 'instant') {
    void emitToPreviewPopup('preview-popup-update', {
      html: rendered,
      frontmatter: frontmatterEntries,
    });
  }

  // Track the popup window reference to detect when user closes it via the OS.
  let unlistenPopupDestroyed: (() => void) | null = null;
  let unlistenPopupReady: (() => void) | null = null;

  async function attachPopupCloseListener(): Promise<void> {
    unlistenPopupDestroyed?.();
    unlistenPopupDestroyed = null;
    const win = await WebviewWindow.getByLabel(PREVIEW_POPUP_LABEL);
    if (!win) return;
    unlistenPopupDestroyed = await win.once('tauri://destroyed', () => {
      layout.setPreviewPoppedOut(false);
      unlistenPopupDestroyed = null;
    });
  }

  $: if ($layout.previewPoppedOut) {
    void attachPopupCloseListener();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape' && $layout.previewFullscreen) {
      layout.togglePreviewFullscreen();
    }
  }

  onMount(async () => {
    // When the instant-mode popup signals it is ready, send the current content.
    unlistenPopupReady = await listen('preview-popup-ready', () => {
      if ($previewState.mode === 'instant') {
        void emitToPreviewPopup('preview-popup-update', {
          html: rendered,
          frontmatter: frontmatterEntries,
        });
      }
    });
  });

  onDestroy(() => {
    void stopJekyllPreview();
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    unlistenPopupReady?.();
    unlistenPopupDestroyed?.();
  });
</script>

<svelte:window on:keydown={onKeyDown} />

<section class="preview" class:fullscreen={$layout.previewFullscreen}>
  <ViewportToolbar />
  {#if $previewState.error}
    <p class="error">{$previewState.error}</p>
  {/if}
  <div class="preview-canvas">
    <div
      class="viewport"
      style={`width: ${$previewState.viewport.width}px; height: ${$previewState.viewport.height}px;`}
    >
      {#if $previewState.mode === 'jekyll' && debouncedIframeUrl}
        {#key debouncedIframeUrl}
          <iframe title="Jekyll preview" src={debouncedIframeUrl}></iframe>
        {/key}
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

  /* Fullscreen overlay — covers the entire window on top of everything */
  .preview.fullscreen {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: #0d1117;
    height: 100dvh;
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
    justify-content: flex-start;
    align-items: flex-start;
    /* Canvas scrolls; the viewport renders at its exact selected dimensions */
    min-width: 0;
    min-height: 0;
  }

  .viewport {
    /* Exact dimensions — never shrink to fit the panel; canvas provides scrollbars */
    flex-shrink: 0;
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
