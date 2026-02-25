import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { emitTo } from '@tauri-apps/api/event';

export const PREVIEW_POPUP_LABEL = 'preview-popup';

/** Open the preview pop-out window.
 *
 * Jekyll mode: the new window loads the Jekyll dev server URL directly (no
 * Hyditor chrome) so the user can drag it to a second monitor.
 *
 * Instant mode: the new window loads the /preview-window SvelteKit route and
 * receives rendered HTML via the `preview-popup-update` Tauri event.
 */
export async function openPreviewPopup(options: {
  mode: 'jekyll';
  url: string;
  title?: string;
}): Promise<void>;
export async function openPreviewPopup(options: {
  mode: 'instant';
  title?: string;
}): Promise<void>;
export async function openPreviewPopup(
  options: { mode: 'jekyll'; url: string; title?: string } | { mode: 'instant'; title?: string }
): Promise<void> {
  // Close any existing popup of the same label first.
  const existing = await WebviewWindow.getByLabel(PREVIEW_POPUP_LABEL);
  if (existing) {
    try {
      await existing.close();
    } catch {
      // Ignore close errors — window may already be gone.
    }
  }

  const windowUrl =
    options.mode === 'jekyll' && 'url' in options ? options.url : '/preview-window';

  const win = new WebviewWindow(PREVIEW_POPUP_LABEL, {
    url: windowUrl,
    title: options.title ?? 'Hyditor Preview',
    width: 1440,
    height: 900,
    resizable: true,
  });

  await new Promise<void>((resolve) => {
    let settled = false;
    const settle = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    // once() returns Promise<UnlistenFn>; we don't need to call unlisten since
    // the handler fires at most once and the window owns its own lifecycle.
    void win.once('tauri://created', settle);
    void win.once('tauri://error', settle);
    // Resolve after a generous timeout regardless, to avoid blocking the UI.
    setTimeout(settle, 5000);
  });
}

/** Close the preview pop-out window if it is open. */
export async function closePreviewPopup(): Promise<void> {
  const win = await WebviewWindow.getByLabel(PREVIEW_POPUP_LABEL);
  if (win) {
    try {
      await win.close();
    } catch {
      // Already closed.
    }
  }
}

/** Returns true if the preview popup window currently exists. */
export async function isPreviewPopupOpen(): Promise<boolean> {
  return (await WebviewWindow.getByLabel(PREVIEW_POPUP_LABEL)) !== null;
}

/** Emit an event to the preview popup window.  No-ops if no popup is open. */
export async function emitToPreviewPopup(
  event: string,
  payload: unknown
): Promise<void> {
  try {
    await emitTo(PREVIEW_POPUP_LABEL, event, payload);
  } catch {
    // Popup may have been closed.
  }
}
