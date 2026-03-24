import { get, writable } from 'svelte/store';
import {
  listRepos
} from '$lib/tauri/github';
import {
  cloneRepo,
  fileHeadContent,
  listBranches,
  pull,
  publish,
  revertFiles,
  status,
  switchBranch,
  type GitStatusEntry
} from '$lib/tauri/git';
import { readFile, readTree, writeFile } from '$lib/tauri/fs';
import { requireReauthentication } from '$lib/stores/auth';
import { editorState, enterDiffMode, exitDiffMode, fileTree, resetEditorState, setCurrentFileContent, setCurrentImageFile } from '$lib/stores/editor';
import { extractAuthExpiredMessage } from '$lib/utils/authErrors';
import { getErrorMessage, isContentPath, isImagePath, isMarkdownPath, joinRepoPath } from '$lib/utils/errors';
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
export const branchState = writable<{
  current: string;
  branches: string[];
  busy: boolean;
  error: string | null;
  lastAction: string | null;
}>({
  current: 'main',
  branches: ['main'],
  busy: false,
  error: null,
  lastAction: null
});

/** Non-blocking pull status shown after a repo is loaded. */
export const pullState = writable<{
  busy: boolean;
  error: string | null;
  lastAction: string | null;
}>({ busy: false, error: null, lastAction: null });


// getErrorMessage imported from '$lib/utils/errors'

/**
 * Fetch + fast-forward pull from origin. Non-blocking: errors are stored in
 * pullState so the repo still opens even if the pull fails.
 */
async function pullLatest(localPath: string): Promise<void> {
  pullState.set({ busy: true, error: null, lastAction: null });
  try {
    const message = await pull(localPath);
    pullState.set({ busy: false, error: null, lastAction: message });
  } catch (error) {
    // Auth-expired is still fatal — redirect to sign-in
    if (handleAuthExpiredError(error)) {
      return;
    }
    pullState.set({
      busy: false,
      error: getErrorMessage(error) ?? 'Failed to pull latest changes.',
      lastAction: null
    });
  }
}

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

  exitDiffMode();

  const persistSession = () => {
    const repo = get(activeRepo);
    if (repo) {
      const currentBranch = get(branchState).current;
      saveLastSession(repo.owner, repo.name, currentBranch, relativePath).catch(() => {});
    }
  };

  if (isImagePath(relativePath)) {
    setCurrentImageFile(relativePath);
    persistSession();
    return;
  }

  const fullPath = joinRepoPath(basePath, relativePath);
  try {
    const content = await readFile(fullPath);
    setCurrentFileContent(relativePath, content);
    persistSession();
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

    // Pull latest changes from origin (non-blocking — errors shown in UI)
    await pullLatest(localPath);

    const tree = await readTree(localPath);
    fileTree.set(tree);
    await openFirstContentFile(localPath);

    await refreshGitStatus();
    await refreshBranches();
    void setPreviewMode('jekyll', localPath);

    // Persist selected repo for session restore
    const currentFile = get(editorState).currentFile;
    const currentBranch = get(branchState).current;
    saveLastSession(repo.owner, repo.name, currentBranch, currentFile).catch(() => {});
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
    branchState.set({ current: 'main', branches: ['main'], busy: false, error: null, lastAction: null });
    return;
  }

  branchState.update((state) => ({ ...state, busy: true, error: null }));
  try {
    const branches = await listBranches(current.localPath);
    const sortedBranches = [...branches].sort((left, right) => left.localeCompare(right));
    const fallbackCurrent = sortedBranches.includes(current.default_branch)
      ? current.default_branch
      : sortedBranches[0] ?? current.default_branch;
    branchState.update((state) => {
      const resolvedCurrent = sortedBranches.includes(state.current) ? state.current : fallbackCurrent;
      return {
        ...state,
        current: resolvedCurrent,
        branches: sortedBranches
      };
    });
  } catch (error) {
    if (handleAuthExpiredError(error)) {
      return;
    }

    branchState.update((state) => ({
      ...state,
      error: getErrorMessage(error) ?? 'Failed to refresh branches.'
    }));
  } finally {
    branchState.update((state) => ({ ...state, busy: false }));
  }
}

async function runBranchAction(actionLabel: string, action: (repoPath: string) => Promise<void>): Promise<void> {
  const current = get(activeRepo);
  if (!current) {
    return;
  }

  branchState.update((state) => ({ ...state, busy: true, error: null, lastAction: null }));
  try {
    await action(current.localPath);
    await refreshBranches();
    await refreshGitStatus();
    const tree = await readTree(current.localPath);
    fileTree.set(tree);
    await openFirstContentFile(current.localPath);
    branchState.update((state) => ({ ...state, lastAction: actionLabel }));
  } catch (error) {
    if (handleAuthExpiredError(error)) {
      return;
    }

    branchState.update((state) => ({
      ...state,
      error: getErrorMessage(error) ?? `${actionLabel} failed.`
    }));
  } finally {
    branchState.update((state) => ({ ...state, busy: false }));
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

    // Persist the newly selected branch for session restore
    const repo = get(activeRepo);
    if (repo) {
      const currentFile = get(editorState).currentFile;
      saveLastSession(repo.owner, repo.name, trimmed, currentFile).catch(() => {});
    }
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
      default_branch: session.last_branch
    };

    const repoKey = `${repo.owner}/${repo.name}`;
    repoState.update((state) => ({ ...state, cloning: repoKey, error: null }));
    cloneProgress.set(null);

    try {
      const localPath = await cloneRepo(repo.owner, repo.name);
      activeRepo.set({ ...repo, localPath });

      // Pull latest changes from origin (non-blocking — errors shown in UI)
      await pullLatest(localPath);

      const tree = await readTree(localPath);
      fileTree.set(tree);

      // Open the last file if it still exists, otherwise fall back to first content file
      if (session.last_file && tree.some((item) => item.path === session.last_file)) {
        await openRepoFile(session.last_file, localPath);
      } else {
        await openFirstContentFile(localPath);
      }

      await refreshGitStatus();

      // Try to restore the last-used branch; fall back gracefully if it no longer exists
      const branches = await listBranches(localPath);
      if (session.last_branch && branches.includes(session.last_branch)) {
        try {
          await switchBranch(localPath, session.last_branch);
          branchState.set({ current: session.last_branch, branches: [...branches].sort((a, b) => a.localeCompare(b)), busy: false, error: null, lastAction: null });
        } catch {
          // Switch failed — stay on current branch
          await refreshBranches();
        }
      } else {
        await refreshBranches();
      }

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

export async function openDiffForFile(relativePath: string, fileStatus: string): Promise<void> {
  const repo = get(activeRepo);
  if (!repo) return;

  const headContent = await fileHeadContent(repo.localPath, relativePath);

  // Also load the current working copy into the editor state
  const fullPath = joinRepoPath(repo.localPath, relativePath);
  try {
    const content = await readFile(fullPath);
    setCurrentFileContent(relativePath, content);
  } catch {
    // File was deleted — show empty working copy
    setCurrentFileContent(relativePath, '');
  }

  enterDiffMode(relativePath, headContent, fileStatus);
}

export function resetRepoSession(): void {
  repoList.set([]);
  activeRepo.set(null);
  repoState.set({ loading: false, cloning: null, error: null });
  gitState.set({ entries: [], busy: false, error: null, lastAction: null });
  branchState.set({ current: 'main', branches: ['main'], busy: false, error: null, lastAction: null });
  pullState.set({ busy: false, error: null, lastAction: null });
  fileTree.set([]);
  resetEditorState();
  clearLastSession().catch(() => {});
}

export function dismissPullError(): void {
  pullState.update((state) => ({ ...state, error: null }));
}
