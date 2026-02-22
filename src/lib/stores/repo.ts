import { writable } from 'svelte/store';
import { listRepos } from '$lib/tauri/github';
import { status } from '$lib/tauri/git';

export type RepoInfo = {
  owner: string;
  name: string;
  default_branch: string;
  description?: string;
};

export const repoList = writable<RepoInfo[]>([]);
export const activeRepo = writable<RepoInfo | null>(null);
export const gitState = writable<{ changedFiles: string[] }>({ changedFiles: [] });
export const branchState = writable<{ current: string; branches: string[] }>({
  current: 'main',
  branches: ['main']
});

export async function loadRepos(): Promise<void> {
  const repos = await listRepos();
  repoList.set(repos);
}

export function selectRepo(repo: RepoInfo): void {
  activeRepo.set(repo);
}

export async function refreshGitStatus(): Promise<void> {
  const currentStatus = await status('');
  gitState.set({ changedFiles: currentStatus.map((entry) => entry.path) });
}
