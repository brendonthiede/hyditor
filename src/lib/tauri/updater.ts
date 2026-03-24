import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

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
 * Throws on failure.
 */
export async function downloadAndInstall(): Promise<void> {
  const update = await check();
  if (!update) throw new Error('No update available');
  await update.downloadAndInstall();
  await relaunch();
}
