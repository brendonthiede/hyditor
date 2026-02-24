import { tauriInvoke } from '$lib/tauri/runtime';

export async function startJekyll(repoPath: string): Promise<string> {
  return tauriInvoke<string>('start_jekyll', { repoPath });
}

export async function stopJekyll(): Promise<void> {
  await tauriInvoke('stop_jekyll');
}
