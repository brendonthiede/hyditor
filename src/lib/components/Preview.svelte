<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { listen } from '@tauri-apps/api/event';
  import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
  import { writeText as writeClipboardText } from '@tauri-apps/plugin-clipboard-manager';
  import { openPath, openUrl } from '@tauri-apps/plugin-opener';
  import ViewportToolbar from '$lib/components/ViewportToolbar.svelte';
  import { editorState, lastSavedAt } from '$lib/stores/editor';
  import { previewState, stopJekyllPreview } from '$lib/stores/preview';
  import { getPreviewLogDirectory } from '$lib/tauri/preview';
  import { layout } from '$lib/stores/layout';
  import { parseFrontmatter } from '$lib/utils/frontmatter';
  import { renderMarkdown } from '$lib/utils/markdown';
  import { jekyllUrlForFile } from '$lib/utils/jekyll';
  import { getImageMimeType, isHtmlPath, isImagePath, joinRepoPath } from '$lib/utils/errors';
  import { PREVIEW_POPUP_LABEL, emitToPreviewPopup } from '$lib/tauri/window';
  import { activeRepo } from '$lib/stores/repo';
  import { readFileBase64 } from '$lib/tauri/fs';

  /** Split an error message into text and URL segments for rendering. */
  type ErrorSegment = { kind: 'text'; value: string } | { kind: 'url'; value: string };
  function parseErrorSegments(message: string): ErrorSegment[] {
    const urlPattern = /https?:\/\/[^\s)>\]]+/g;
    const segments: ErrorSegment[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = urlPattern.exec(message)) !== null) {
      if (match.index > lastIndex) {
        segments.push({ kind: 'text', value: message.slice(lastIndex, match.index) });
      }
      segments.push({ kind: 'url', value: match[0] });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < message.length) {
      segments.push({ kind: 'text', value: message.slice(lastIndex) });
    }
    return segments;
  }

  $: errorSegments = $previewState.error ? parseErrorSegments($previewState.error) : [];

  function handleLinkClick(url: string): void {
    openUrl(url).catch(() => {
      // Fallback: the URL is still visible, the user can copy it manually.
    });
  }

  let diagnosticsCopied = false;
  let diagnosticsCopyTimer: ReturnType<typeof setTimeout> | null = null;
  let logFolderOpened = false;
  let logFolderOpenTimer: ReturnType<typeof setTimeout> | null = null;

  async function copyDiagnostics(): Promise<void> {
    const message = $previewState.error;
    if (!message) return;
    try {
      await writeClipboardText(message);
      diagnosticsCopied = true;
      if (diagnosticsCopyTimer !== null) {
        clearTimeout(diagnosticsCopyTimer);
      }
      diagnosticsCopyTimer = setTimeout(() => {
        diagnosticsCopied = false;
        diagnosticsCopyTimer = null;
      }, 2000);
    } catch {
      // Silently ignore clipboard errors
    }
  }

  async function openLogFolder(): Promise<void> {
    try {
      const path = await getPreviewLogDirectory();
      await openPath(path);
      logFolderOpened = true;
      if (logFolderOpenTimer !== null) {
        clearTimeout(logFolderOpenTimer);
      }
      logFolderOpenTimer = setTimeout(() => {
        logFolderOpened = false;
        logFolderOpenTimer = null;
      }, 2000);
    } catch {
      // Silently ignore open errors
    }
  }

  $: currentFileIsImage = isImagePath($editorState.currentFile ?? '');

  let imageSrc: string | null = null;

  async function loadImagePreview(file: string, repoPath: string): Promise<void> {
    try {
      const b64 = await readFileBase64(joinRepoPath(repoPath, file));
      if ($editorState.currentFile === file) {
        imageSrc = `data:${getImageMimeType(file)};base64,${b64}`;
      }
    } catch {
      if ($editorState.currentFile === file) imageSrc = null;
    }
  }

  $: {
    const file = $editorState.currentFile;
    const repo = $activeRepo;
    if (file && isImagePath(file) && repo) {
      imageSrc = null;
      void loadImagePreview(file, repo.localPath);
    } else {
      imageSrc = null;
    }
  }

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
  const FALLBACK_REFRESH_DELAY_MS = 1200;
  let fallbackRefreshNonce = 0;
  let fallbackRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  function refreshPreview(): void {
    if ($previewState.mode !== 'jekyll') {
      return;
    }

    if (fallbackRefreshTimer !== null) {
      clearTimeout(fallbackRefreshTimer);
      fallbackRefreshTimer = null;
    }

    fallbackRefreshNonce = Date.now();
  }

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

  // Without livereload (fallback mode), refresh after a short delay to allow
  // Jekyll to finish rebuilding before the iframe reloads.
  $: if ($previewState.mode === 'jekyll' && !$previewState.jekyllLivereloadEnabled && $lastSavedAt > 0) {
    if (fallbackRefreshTimer !== null) {
      clearTimeout(fallbackRefreshTimer);
      fallbackRefreshTimer = null;
    }
    const savedAt = $lastSavedAt;
    fallbackRefreshTimer = setTimeout(() => {
      fallbackRefreshNonce = savedAt;
      fallbackRefreshTimer = null;
    }, FALLBACK_REFRESH_DELAY_MS);
  } else if (fallbackRefreshTimer !== null) {
    clearTimeout(fallbackRefreshTimer);
    fallbackRefreshTimer = null;
  }

  $: iframeSrc = (() => {
    if (!debouncedIframeUrl) return null;
    if ($previewState.jekyllLivereloadEnabled) return debouncedIframeUrl;
    const separator = debouncedIframeUrl.includes('?') ? '&' : '?';
    return `${debouncedIframeUrl}${separator}hyditor_refresh=${fallbackRefreshNonce}`;
  })();

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
    if (fallbackRefreshTimer !== null) clearTimeout(fallbackRefreshTimer);
    if (diagnosticsCopyTimer !== null) clearTimeout(diagnosticsCopyTimer);
    if (logFolderOpenTimer !== null) clearTimeout(logFolderOpenTimer);
    unlistenPopupReady?.();
    unlistenPopupDestroyed?.();
  });
</script>

<svelte:window on:keydown={onKeyDown} />

<section class="preview" class:fullscreen={$layout.previewFullscreen}>
  <ViewportToolbar onRefresh={refreshPreview} />
  {#if $previewState.error}
    <div class="error">
      <div class="error-actions">
        <button class="error-copy-btn" on:click={() => void copyDiagnostics()}>
          {diagnosticsCopied ? 'Copied!' : 'Copy diagnostics'}
        </button>
        <button class="error-copy-btn" on:click={() => void openLogFolder()}>
          {logFolderOpened ? 'Opened!' : 'Open log folder'}
        </button>
      </div>
      <div class="error-body">
        {#each errorSegments as segment}
          {#if segment.kind === 'url'}
            <a href={segment.value} on:click|preventDefault={() => handleLinkClick(segment.value)}>{segment.value}</a>
          {:else}
            {segment.value}
          {/if}
        {/each}
      </div>
    </div>
  {/if}
  <div class="preview-canvas">
    <div
      class="viewport"
      style={`width: ${$previewState.viewport.width}px; height: ${$previewState.viewport.height}px;`}
    >
      {#if currentFileIsImage}
        <div class="image-preview">
          {#if imageSrc}
            <img src={imageSrc} alt={$editorState.currentFile ?? ''} />
          {:else}
            <span class="image-loading">Loading…</span>
          {/if}
        </div>
      {:else if $previewState.mode === 'jekyll' && iframeSrc}
        {#key iframeSrc}
          <iframe title="Jekyll preview" src={iframeSrc}></iframe>
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
    font-size: 0.85rem;
  }

  .error-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .error-copy-btn {
    border: 1px solid #30363d;
    background: #161b22;
    color: #c9d1d9;
    border-radius: 6px;
    font-size: 0.75rem;
    padding: 0.2rem 0.5rem;
    cursor: pointer;
  }

  .error-copy-btn:hover {
    background: #21262d;
  }

  .error-body {
    white-space: pre-line;
  }

  .error a {
    color: #58a6ff;
    text-decoration: underline;
    cursor: pointer;
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

  .image-preview {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: flex-start;
    justify-content: flex-start;
    overflow: auto;
    padding: 0.75rem;
  }

  .image-preview img {
    display: block;
  }

  .image-loading {
    color: #8b949e;
    font-size: 0.9rem;
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
