import { tauriInvoke } from '$lib/tauri/runtime';
import type { RepoInfo } from '$lib/stores/repo';

export async function listRepos(): Promise<RepoInfo[]> {
  return tauriInvoke<RepoInfo[]>('list_repos');
}
