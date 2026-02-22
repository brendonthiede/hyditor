import { invoke } from '@tauri-apps/api/core';
import type { RepoInfo } from '$lib/stores/repo';

export async function listRepos(): Promise<RepoInfo[]> {
  return invoke<RepoInfo[]>('list_repos');
}
