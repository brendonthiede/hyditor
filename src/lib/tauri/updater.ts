import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

export interface UpdateInfo {
  version: string;
  body: string | undefined;
}

/**
 * Check if an update is available. Returns update info if available, null otherwise.
 * Silently returns null on any error (e.g. no network, no pubkey configured).
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const update = await check();
    if (update) {
      return {
        version: update.version,
        body: update.body,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Download and install the available update, then relaunch the app.
 * On Windows, minimizes the app window before installing so that
 * any UAC elevation prompt appears in the foreground.
 * Throws on failure.
 */
export async function downloadAndInstall(): Promise<void> {
  const update = await check();
  if (!update) throw new Error('No update available');

  // Minimize the window before installing so that any system elevation dialog
  // (UAC on Windows) is not hidden behind the app window.
  try {
    await getCurrentWebviewWindow().minimize();
  } catch {
    // Non-fatal — proceed with the install even if minimize fails.
  }

  await update.downloadAndInstall();
  await relaunch();
}
