import { get, writable } from 'svelte/store';
import { startJekyll, stopJekyll } from '$lib/tauri/preview';
import { jekyllUrlForFile } from '$lib/utils/jekyll';

type Preset = 'desktop' | 'tablet' | 'mobile';

const PRESETS: Record<Preset, { width: number; height: number }> = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 812 }
};

export const previewState = writable<{
  mode: 'instant' | 'jekyll';
  viewport: { width: number; height: number };
  jekyllBaseUrl: string | null;
  jekyllUrl: string | null;
  repoPath: string | null;
  loading: boolean;
  error: string | null;
}>({
  mode: 'instant',
  viewport: PRESETS.desktop,
  jekyllBaseUrl: null,
  jekyllUrl: null,
  repoPath: null,
  loading: false,
  error: null
});

export function setViewportPreset(preset: Preset): void {
  previewState.update((state) => ({ ...state, viewport: PRESETS[preset] }));
}

export async function setPreviewMode(
  mode: 'instant' | 'jekyll',
  repoPath?: string,
  currentFile?: string | null
): Promise<void> {
  if (mode === 'instant') {
    try {
      await stopJekyll();
    } catch {
      // noop
    }
    previewState.update((state) => ({
      ...state,
      mode: 'instant',
      loading: false,
      error: null,
      jekyllBaseUrl: null,
      jekyllUrl: null,
      repoPath: null
    }));
    return;
  }

  if (!repoPath) {
    previewState.update((state) => ({
      ...state,
      mode: 'instant',
      loading: false,
      error: 'Open a repository before starting full preview.',
      jekyllBaseUrl: null,
      jekyllUrl: null,
      repoPath: null
    }));
    return;
  }

  previewState.update((state) => ({
    ...state,
    loading: true,
    error: null
  }));

  try {
    const baseUrl = await startJekyll(repoPath);
    const jekyllUrl =
      currentFile ? jekyllUrlForFile(baseUrl, repoPath, currentFile) : baseUrl;
    previewState.update((state) => ({
      ...state,
      mode: 'jekyll',
      jekyllBaseUrl: baseUrl,
      jekyllUrl,
      repoPath,
      loading: false,
      error: null
    }));
  } catch (error) {
    previewState.update((state) => ({
      ...state,
      mode: 'instant',
      jekyllBaseUrl: null,
      jekyllUrl: null,
      repoPath: null,
      loading: false,
      error: error instanceof Error ? error.message : 'Failed to start Jekyll preview.'
    }));
  }
}

export function navigateToCurrentFile(filePath: string | null): void {
  const state = get(previewState);
  if (state.mode !== 'jekyll' || !state.jekyllBaseUrl || !state.repoPath) return;
  const jekyllUrl = filePath
    ? jekyllUrlForFile(state.jekyllBaseUrl, state.repoPath, filePath)
    : state.jekyllBaseUrl;
  previewState.update((s) => ({ ...s, jekyllUrl }));
}

export async function stopJekyllPreview(): Promise<void> {
  try {
    await stopJekyll();
  } catch {
    // noop
  }
  previewState.update((state) => ({
    ...state,
    mode: 'instant',
    jekyllBaseUrl: null,
    jekyllUrl: null,
    repoPath: null,
    loading: false
  }));
}
