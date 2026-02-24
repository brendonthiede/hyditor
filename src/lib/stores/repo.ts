import { get, writable } from 'svelte/store';
import { listRepos } from '$lib/tauri/github';
import { cloneRepo, commit, push, stage, status, type GitStatusEntry, unstage } from '$lib/tauri/git';
import { readFile, readTree, writeFile } from '$lib/tauri/fs';
import { fileTree, setCurrentFileContent } from '$lib/stores/editor';

export type RepoInfo = {
  owner: string;
  name: string;
  default_branch: string;
  description?: string;
};

export type ActiveRepo = RepoInfo & {
  localPath: string;
};

export const repoList = writable<RepoInfo[]>([]);
export const activeRepo = writable<ActiveRepo | null>(null);
export const repoState = writable<{
  loading: boolean;
  cloning: string | null;
  error: string | null;
}>({
  loading: false,
  cloning: null,
  error: null
});
export const gitState = writable<{
  entries: GitStatusEntry[];
  busy: boolean;
  error: string | null;
  lastAction: string | null;
}>({ entries: [], busy: false, error: null, lastAction: null });
export const branchState = writable<{ current: string; branches: string[] }>({
  current: 'main',
  branches: ['main']
});

function isMarkdownPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith('.md') || lower.endsWith('.markdown');
}

function joinRepoPath(localPath: string, relativePath: string): string {
  const trimmedBase = localPath.replace(/[\\/]+$/, '');
  const trimmedRelative = relativePath.replace(/^[/\\]+/, '');
  return `${trimmedBase}/${trimmedRelative}`;
}

async function openFirstMarkdownFile(localPath: string): Promise<void> {
  const tree = get(fileTree);
  const firstMarkdownFile = tree
    .filter((item) => !item.is_dir && isMarkdownPath(item.path))
    .sort((left, right) => left.path.localeCompare(right.path))[0];

  if (!firstMarkdownFile) {
    return;
  }

  await openRepoFile(firstMarkdownFile.path, localPath);
}

export async function openRepoFile(relativePath: string, localPathOverride?: string): Promise<void> {
  const basePath = localPathOverride ?? get(activeRepo)?.localPath;
  if (!basePath) {
    return;
  }

  const fullPath = joinRepoPath(basePath, relativePath);
  try {
    const content = await readFile(fullPath);
    setCurrentFileContent(relativePath, content);
  } catch {
    return;
  }
}

export async function saveRepoFile(relativePath: string, content: string, localPathOverride?: string): Promise<void> {
  const basePath = localPathOverride ?? get(activeRepo)?.localPath;
  if (!basePath) {
    return;
  }

  const fullPath = joinRepoPath(basePath, relativePath);
  await writeFile(fullPath, content);
}

export async function loadRepos(): Promise<void> {
  repoState.update((state) => ({ ...state, loading: true, error: null }));
  try {
    const repos = await listRepos();
    repoList.set(repos);
  } catch (error) {
    repoState.update((state) => ({
      ...state,
      error: error instanceof Error ? error.message : 'Failed to load repositories.'
    }));
  } finally {
    repoState.update((state) => ({ ...state, loading: false }));
  }
}

export async function selectRepo(repo: RepoInfo): Promise<void> {
  const repoKey = `${repo.owner}/${repo.name}`;
  repoState.update((state) => ({ ...state, cloning: repoKey, error: null }));

  try {
    const localPath = await cloneRepo(repo.owner, repo.name);
    activeRepo.set({ ...repo, localPath });

    const tree = await readTree(localPath);
    fileTree.set(tree);
    await openFirstMarkdownFile(localPath);

    await refreshGitStatus();
  } catch (error) {
    repoState.update((state) => ({
      ...state,
      error: error instanceof Error ? error.message : 'Failed to clone repository.'
    }));
  } finally {
    repoState.update((state) => ({ ...state, cloning: null }));
  }
}

export async function refreshGitStatus(): Promise<void> {
  const current = get(activeRepo);
  if (!current) {
    gitState.set({ entries: [], busy: false, error: null, lastAction: null });
    return;
  }

  try {
    const currentStatus = await status(current.localPath);
    gitState.update((state) => ({
      ...state,
      entries: currentStatus,
      error: null
    }));
  } catch (error) {
    gitState.update((state) => ({
      ...state,
      error: error instanceof Error ? error.message : 'Failed to refresh git status.'
    }));
  }
}

async function runGitAction(actionLabel: string, action: (repoPath: string) => Promise<void>): Promise<void> {
  const current = get(activeRepo);
  if (!current) {
    return;
  }

  gitState.update((state) => ({ ...state, busy: true, error: null, lastAction: null }));
  try {
    await action(current.localPath);
    await refreshGitStatus();
    gitState.update((state) => ({ ...state, lastAction: actionLabel }));
  } catch (error) {
    gitState.update((state) => ({
      ...state,
      error: error instanceof Error ? error.message : `${actionLabel} failed.`
    }));
  } finally {
    gitState.update((state) => ({ ...state, busy: false }));
  }
}

export async function stageFiles(files: string[]): Promise<void> {
  if (files.length === 0) {
    return;
  }

  await runGitAction('Staged file selection.', async (repoPath) => {
    await stage(repoPath, files);
  });
}

export async function unstageFiles(files: string[]): Promise<void> {
  if (files.length === 0) {
    return;
  }

  await runGitAction('Unstaged file selection.', async (repoPath) => {
    await unstage(repoPath, files);
  });
}

export async function commitChanges(message: string): Promise<void> {
  const trimmed = message.trim();
  if (!trimmed) {
    gitState.update((state) => ({ ...state, error: 'Commit message is required.' }));
    return;
  }

  await runGitAction('Committed staged changes.', async (repoPath) => {
    await commit(repoPath, trimmed);
  });
}

export async function pushChanges(): Promise<void> {
  await runGitAction('Pushed current branch to origin.', async (repoPath) => {
    await push(repoPath);
  });
}
