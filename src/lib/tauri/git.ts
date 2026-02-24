import { invoke } from '@tauri-apps/api/core';

export type GitStatusEntry = {
  path: string;
  status: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
};

export async function status(repoPath: string): Promise<GitStatusEntry[]> {
  return invoke<GitStatusEntry[]>('git_status', { repoPath });
}

export async function cloneRepo(owner: string, name: string, path?: string): Promise<string> {
  return invoke<string>('clone_repo', { owner, name, path });
}

export async function stage(repoPath: string, files: string[]): Promise<void> {
  await invoke('git_stage', { repoPath, files });
}

export async function unstage(repoPath: string, files: string[]): Promise<void> {
  await invoke('git_unstage', { repoPath, files });
}

export async function commit(repoPath: string, message: string): Promise<string> {
  return invoke<string>('git_commit', { repoPath, message });
}

export async function push(repoPath: string): Promise<void> {
  await invoke('git_push', { repoPath });
}

export async function listBranches(repoPath: string): Promise<string[]> {
  return invoke<string[]>('list_branches', { repoPath });
}

export async function createBranch(repoPath: string, branchName: string): Promise<void> {
  await invoke('create_branch', { repoPath, branchName });
}

export async function switchBranch(repoPath: string, branchName: string): Promise<void> {
  await invoke('switch_branch', { repoPath, branchName });
}
