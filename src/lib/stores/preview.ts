import { writable } from 'svelte/store';
import { startJekyll, stopJekyll } from '$lib/tauri/preview';
import { readFile } from '$lib/tauri/fs';
import { parseSitePermalink } from '$lib/utils/jekyll';

type Preset = 'desktop' | 'tablet' | 'mobile';

const PRESETS: Record<Preset, { width: number; height: number }> = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 812 }
};

export const previewState = writable<{
  mode: 'instant' | 'jekyll';
  viewport: { width: number; height: number };
  viewportPreset: Preset;
  jekyllBaseUrl: string | null;
  repoPath: string | null;
  sitePermalink: string;
  loading: boolean;
  error: string | null;
}>({
  mode: 'instant',
  viewport: PRESETS.desktop,
  viewportPreset: 'desktop',
  jekyllBaseUrl: null,
  repoPath: null,
  sitePermalink: 'date',
  loading: false,
  error: null
});

export function setViewportPreset(preset: Preset): void {
  previewState.update((state) => ({ ...state, viewport: PRESETS[preset], viewportPreset: preset }));
}

async function loadSitePermalink(repoPath: string): Promise<string> {
  try {
    const content = await readFile(`${repoPath}/_config.yml`);
    return parseSitePermalink(content);
  } catch {
    return 'date';
  }
}

export async function setPreviewMode(
  mode: 'instant' | 'jekyll',
  repoPath?: string
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
      repoPath: null,
      sitePermalink: 'date'
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
    const [baseUrl, sitePermalink] = await Promise.all([
      startJekyll(repoPath),
      loadSitePermalink(repoPath)
    ]);
    previewState.update((state) => ({
      ...state,
      mode: 'jekyll',
      jekyllBaseUrl: baseUrl,
      repoPath,
      sitePermalink,
      loading: false,
      error: null
    }));
  } catch (error) {
    const JEKYLL_GUIDE = 'https://github.com/brendonthiede/hyditor/blob/main/docs/jekyll-prerequisites.md';
    const detail =
      typeof error === 'string' ? error
      : error instanceof Error ? error.message
      : '';
    const alreadyHasLink = detail.includes(JEKYLL_GUIDE);
    const suffix = alreadyHasLink ? '' : `\n\nFor setup instructions, see: ${JEKYLL_GUIDE}`;
    const message = detail
      ? `${detail}${suffix}`
      : `Failed to start Jekyll preview.\n\nFor setup instructions, see: ${JEKYLL_GUIDE}`;
    previewState.update((state) => ({
      ...state,
      mode: 'instant',
      jekyllBaseUrl: null,
      repoPath: null,
      loading: false,
      error: message
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
    jekyllBaseUrl: null,
    repoPath: null,
    loading: false
  }));
}
