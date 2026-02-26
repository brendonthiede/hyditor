import { tauriInvoke } from '$lib/tauri/runtime';

export type GitStatusEntry = {
  path: string;
  status: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  whitespace_only: boolean;
};

export async function status(repoPath: string): Promise<GitStatusEntry[]> {
  return tauriInvoke<GitStatusEntry[]>('git_status', { repoPath });
}

export async function cloneRepo(owner: string, name: string, path?: string): Promise<string> {
  return tauriInvoke<string>('clone_repo', { owner, name, path });
}

export async function stage(repoPath: string, files: string[]): Promise<void> {
  await tauriInvoke('git_stage', { repoPath, files });
}

export async function unstage(repoPath: string, files: string[]): Promise<void> {
  await tauriInvoke('git_unstage', { repoPath, files });
}

export async function commit(repoPath: string, message: string): Promise<string> {
  return tauriInvoke<string>('git_commit', { repoPath, message });
}

export async function push(repoPath: string): Promise<void> {
  await tauriInvoke('git_push', { repoPath });
}

export async function revertFiles(repoPath: string, files: string[]): Promise<void> {
  await tauriInvoke('git_revert_files', { repoPath, files });
}

export async function listBranches(repoPath: string): Promise<string[]> {
  return tauriInvoke<string[]>('list_branches', { repoPath });
}

export async function switchBranch(repoPath: string, branchName: string): Promise<void> {
  await tauriInvoke('switch_branch', { repoPath, branchName });
}
