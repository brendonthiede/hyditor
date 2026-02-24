import { invoke } from '@tauri-apps/api/core';
import type { RepoInfo } from '$lib/stores/repo';

export type PullRequestInfo = {
  number: number;
  title: string;
  state: string;
  url: string;
};

export async function listRepos(): Promise<RepoInfo[]> {
  return invoke<RepoInfo[]>('list_repos');
}

export async function listPullRequests(owner: string, repo: string): Promise<PullRequestInfo[]> {
  return invoke<PullRequestInfo[]>('list_prs', { owner, repo });
}

export async function createPullRequest(
  owner: string,
  repo: string,
  head: string,
  base: string,
  title: string,
  body: string
): Promise<PullRequestInfo> {
  return invoke<PullRequestInfo>('create_pr', {
    owner,
    repo,
    head,
    base,
    title,
    body
  });
}
