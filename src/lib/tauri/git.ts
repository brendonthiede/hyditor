import { invoke } from '@tauri-apps/api/core';

export type GitStatusEntry = {
  path: string;
  status: string;
};

export async function status(repoPath: string): Promise<GitStatusEntry[]> {
  return invoke<GitStatusEntry[]>('git_status', { repoPath });
}

export async function cloneRepo(owner: string, name: string, path?: string): Promise<string> {
  return invoke<string>('clone_repo', { owner, name, path });
}

export async function push(repoPath: string): Promise<void> {
  await invoke('git_push', { repoPath });
}
