import { tauriInvoke } from '$lib/tauri/runtime';

export async function startJekyll(repoPath: string): Promise<string> {
  return tauriInvoke<string>('start_jekyll', { repoPath });
}

export async function stopJekyll(): Promise<void> {
  await tauriInvoke('stop_jekyll');
}

export async function readPreviewLogTail(lines = 50): Promise<string> {
  return tauriInvoke<string>('read_preview_log_tail', { lines });
}

export async function getPreviewLogDirectory(): Promise<string> {
  return tauriInvoke<string>('get_preview_log_directory');
}
