import { writable } from 'svelte/store';
import { startJekyll, stopJekyll } from '$lib/tauri/preview';

type Preset = 'desktop' | 'tablet' | 'mobile';

const PRESETS: Record<Preset, { width: number; height: number }> = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 812 }
};

export const previewState = writable<{
  mode: 'instant' | 'jekyll';
  viewport: { width: number; height: number };
  jekyllUrl: string | null;
  loading: boolean;
  error: string | null;
}>({
  mode: 'instant',
  viewport: PRESETS.desktop,
  jekyllUrl: null,
  loading: false,
  error: null
});

export function setViewportPreset(preset: Preset): void {
  previewState.update((state) => ({ ...state, viewport: PRESETS[preset] }));
}

export async function setPreviewMode(mode: 'instant' | 'jekyll', repoPath?: string): Promise<void> {
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
      jekyllUrl: null
    }));
    return;
  }

  if (!repoPath) {
    previewState.update((state) => ({
      ...state,
      mode: 'instant',
      loading: false,
      error: 'Open a repository before starting full preview.',
      jekyllUrl: null
    }));
    return;
  }

  previewState.update((state) => ({
    ...state,
    loading: true,
    error: null
  }));

  try {
    const url = await startJekyll(repoPath);
    previewState.update((state) => ({
      ...state,
      mode: 'jekyll',
      jekyllUrl: url,
      loading: false,
      error: null
    }));
  } catch (error) {
    previewState.update((state) => ({
      ...state,
      mode: 'instant',
      jekyllUrl: null,
      loading: false,
      error: error instanceof Error ? error.message : 'Failed to start Jekyll preview.'
    }));
  }
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
    jekyllUrl: null,
    loading: false
  }));
}
