import { invoke } from '@tauri-apps/api/core';

export async function startJekyll(repoPath: string): Promise<string> {
  return invoke<string>('start_jekyll', { repoPath });
}

export async function stopJekyll(): Promise<void> {
  await invoke('stop_jekyll');
}
