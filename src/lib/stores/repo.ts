import { get, writable } from 'svelte/store';
import {
  listRepos
} from '$lib/tauri/github';
import {
  cloneRepo,
  commit,
  listBranches,
  publish,
  push,
  revertFiles,
  stage,
  status,
  switchBranch,
  type GitStatusEntry,
  unstage
} from '$lib/tauri/git';
import { readFile, readTree, writeFile } from '$lib/tauri/fs';
import { requireReauthentication } from '$lib/stores/auth';
import { editorState, fileTree, resetEditorState, setCurrentFileContent } from '$lib/stores/editor';
import { extractAuthExpiredMessage } from '$lib/utils/authErrors';
import { getErrorMessage, isContentPath, isMarkdownPath, joinRepoPath } from '$lib/utils/errors';
import { setPreviewMode } from '$lib/stores/preview';
import { saveLastSession, loadLastSession, clearLastSession } from '$lib/tauri/session';

export type RepoInfo = {
  owner: string;
  name: string;
  default_branch: string;
  description?: string;
};

export type ActiveRepo = RepoInfo & {
  localPath: string;
};

export type CloneProgress = {
  owner: string;
  name: string;
  received_objects: number;
  total_objects: number;
  indexed_objects: number;
  received_bytes: number;
  percent: number;
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
export const cloneProgress = writable<CloneProgress | null>(null);
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
export const branchUiState = writable<{
  busy: boolean;
  error: string | null;
  lastAction: string | null;
}>({ busy: false, error: null, lastAction: null });


// getErrorMessage imported from '$lib/utils/errors'

function handleAuthExpiredError(error: unknown): boolean {
  const authExpiredMessage = extractAuthExpiredMessage(getErrorMessage(error));
  if (!authExpiredMessage) {
    return false;
  }

  resetRepoSession();
  requireReauthentication(authExpiredMessage);
  return true;
}

function handleNotAuthenticatedError(error: unknown): boolean {
  const message = getErrorMessage(error);
  if (!message) {
    return false;
  }

  if (!message.toLowerCase().includes('not authenticated')) {
    return false;
  }

  resetRepoSession();
  requireReauthentication('GitHub session missing. Sign in again to continue.');
  return true;
}

// isContentPath, isMarkdownPath, and joinRepoPath imported from '$lib/utils/errors'

async function openFirstContentFile(localPath: string): Promise<void> {
  const tree = get(fileTree);
  // Prefer markdown files, fall back to HTML if no markdown is found.
  const contentFiles = tree
    .filter((item) => !item.is_dir && isContentPath(item.path))
    .sort((left, right) => {
      // Sort markdown before HTML, then alphabetically.
      const aIsMd = isMarkdownPath(left.path) ? 0 : 1;
      const bIsMd = isMarkdownPath(right.path) ? 0 : 1;
      if (aIsMd !== bIsMd) return aIsMd - bIsMd;
      return left.path.localeCompare(right.path);
    });

  const firstFile = contentFiles[0];
  if (!firstFile) {
    return;
  }

  await openRepoFile(firstFile.path, localPath);
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
    // Persist the currently opened file for session restore
    const repo = get(activeRepo);
    if (repo) {
      saveLastSession(repo.owner, repo.name, repo.default_branch, relativePath).catch(() => {});
    }
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
    if (handleAuthExpiredError(error)) {
      return;
    }

    if (handleNotAuthenticatedError(error)) {
      return;
    }

    repoState.update((state) => ({
      ...state,
      error: getErrorMessage(error) ?? 'Failed to load repositories.'
    }));
  } finally {
    repoState.update((state) => ({ ...state, loading: false }));
  }
}

export async function selectRepo(repo: RepoInfo): Promise<void> {
  const repoKey = `${repo.owner}/${repo.name}`;
  repoState.update((state) => ({ ...state, cloning: repoKey, error: null }));
  cloneProgress.set(null);

  try {
    const localPath = await cloneRepo(repo.owner, repo.name);
    activeRepo.set({ ...repo, localPath });

    const tree = await readTree(localPath);
    fileTree.set(tree);
    await openFirstContentFile(localPath);

    await refreshGitStatus();
    await refreshBranches();
    void setPreviewMode('jekyll', localPath);

    // Persist selected repo for session restore
    const currentFile = get(editorState).currentFile;
    saveLastSession(repo.owner, repo.name, repo.default_branch, currentFile).catch(() => {});
  } catch (error) {
    if (handleAuthExpiredError(error)) {
      return;
    }

    repoState.update((state) => ({
      ...state,
      error: getErrorMessage(error) ?? 'Failed to clone repository.'
    }));
  } finally {
    repoState.update((state) => ({ ...state, cloning: null }));
    cloneProgress.set(null);
  }
}

export async function refreshBranches(): Promise<void> {
  const current = get(activeRepo);
  if (!current) {
    branchState.set({ current: 'main', branches: ['main'] });
    branchUiState.set({ busy: false, error: null, lastAction: null });
    return;
  }

  branchUiState.update((state) => ({ ...state, busy: true, error: null }));
  try {
    const branches = await listBranches(current.localPath);
    const sortedBranches = [...branches].sort((left, right) => left.localeCompare(right));
    const fallbackCurrent = sortedBranches.includes(current.default_branch)
      ? current.default_branch
      : sortedBranches[0] ?? current.default_branch;
    branchState.update((state) => {
      const resolvedCurrent = sortedBranches.includes(state.current) ? state.current : fallbackCurrent;
      return {
        current: resolvedCurrent,
        branches: sortedBranches
      };
    });
  } catch (error) {
    if (handleAuthExpiredError(error)) {
      return;
    }

    branchUiState.update((state) => ({
      ...state,
      error: getErrorMessage(error) ?? 'Failed to refresh branches.'
    }));
  } finally {
    branchUiState.update((state) => ({ ...state, busy: false }));
  }
}

async function runBranchAction(actionLabel: string, action: (repoPath: string) => Promise<void>): Promise<void> {
  const current = get(activeRepo);
  if (!current) {
    return;
  }

  branchUiState.update((state) => ({ ...state, busy: true, error: null, lastAction: null }));
  try {
    await action(current.localPath);
    await refreshBranches();
    await refreshGitStatus();
    const tree = await readTree(current.localPath);
    fileTree.set(tree);
    await openFirstContentFile(current.localPath);
    branchUiState.update((state) => ({ ...state, lastAction: actionLabel }));
  } catch (error) {
    if (handleAuthExpiredError(error)) {
      return;
    }

    branchUiState.update((state) => ({
      ...state,
      error: getErrorMessage(error) ?? `${actionLabel} failed.`
    }));
  } finally {
    branchUiState.update((state) => ({ ...state, busy: false }));
  }
}

export async function switchRepoBranch(branchName: string): Promise<void> {
  const trimmed = branchName.trim();
  if (!trimmed) {
    return;
  }

  await runBranchAction(`Switched to branch ${trimmed}.`, async (repoPath) => {
    await switchBranch(repoPath, trimmed);
    branchState.update((state) => ({ ...state, current: trimmed }));
  });
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
    if (handleAuthExpiredError(error)) {
      return;
    }

    gitState.update((state) => ({
      ...state,
      error: getErrorMessage(error) ?? 'Failed to refresh git status.'
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
    if (handleAuthExpiredError(error)) {
      return;
    }

    gitState.update((state) => ({
      ...state,
      error: getErrorMessage(error) ?? `${actionLabel} failed.`
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

export async function publishChanges(files: string[], message: string): Promise<void> {
  if (files.length === 0) {
    return;
  }

  const trimmed = message.trim();
  if (!trimmed) {
    gitState.update((state) => ({ ...state, error: 'Commit message is required.' }));
    return;
  }

  await runGitAction(`Published ${files.length} file(s).`, async (repoPath) => {
    await publish(repoPath, files, trimmed);
  });
}

export async function revertChanges(files: string[]): Promise<void> {
  if (files.length === 0) {
    return;
  }

  await runGitAction(`Reverted ${files.length} file(s).`, async (repoPath) => {
    await revertFiles(repoPath, files);

    // If the currently open file was reverted, reload it from disk.
    const currentFile = get(editorState).currentFile;
    if (currentFile && files.includes(currentFile)) {
      try {
        const fullPath = joinRepoPath(repoPath, currentFile);
        const content = await readFile(fullPath);
        setCurrentFileContent(currentFile, content);
      } catch {
        // File was untracked and got deleted — clear the editor.
        setCurrentFileContent(currentFile, '');
      }
    }
  });
}

export async function restoreLastSession(): Promise<boolean> {
  try {
    const session = await loadLastSession();
    if (!session) return false;

    const repo: RepoInfo = {
      owner: session.owner,
      name: session.name,
      default_branch: session.default_branch
    };

    const repoKey = `${repo.owner}/${repo.name}`;
    repoState.update((state) => ({ ...state, cloning: repoKey, error: null }));
    cloneProgress.set(null);

    try {
      const localPath = await cloneRepo(repo.owner, repo.name);
      activeRepo.set({ ...repo, localPath });

      const tree = await readTree(localPath);
      fileTree.set(tree);

      // Open the last file if it still exists, otherwise fall back to first content file
      if (session.last_file && tree.some((item) => item.path === session.last_file)) {
        await openRepoFile(session.last_file, localPath);
      } else {
        await openFirstContentFile(localPath);
      }

      await refreshGitStatus();
      await refreshBranches();
      void setPreviewMode('jekyll', localPath);
      return true;
    } catch {
      // Saved session is stale or repo is unavailable — clear it
      clearLastSession().catch(() => {});
      return false;
    } finally {
      repoState.update((state) => ({ ...state, cloning: null }));
      cloneProgress.set(null);
    }
  } catch {
    return false;
  }
}

export function resetRepoSession(): void {
  repoList.set([]);
  activeRepo.set(null);
  repoState.set({ loading: false, cloning: null, error: null });
  gitState.set({ entries: [], busy: false, error: null, lastAction: null });
  branchState.set({ current: 'main', branches: ['main'] });
  branchUiState.set({ busy: false, error: null, lastAction: null });
  fileTree.set([]);
  resetEditorState();
  clearLastSession().catch(() => {});
}
