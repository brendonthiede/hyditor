import { writable } from 'svelte/store';
import { browser } from '$app/environment';

const STORAGE_KEY = 'hyditor-layout-v1';

export interface LayoutState {
  fileTreeWidth: number;
  fileTreeCollapsed: boolean;
  gitPanelWidth: number;
  gitPanelCollapsed: boolean;
  /** 0‒1 fraction: editor share when preview is side-by-side */
  centerSplit: number;
  previewCollapsed: boolean;
  /** 'side' = preview right of editor; 'below' = preview below editor */
  previewPosition: 'side' | 'below';
  /** 0‒1 fraction: editor share of height when preview is below */
  editorHeightSplit: number;
  previewFullscreen: boolean;
  /** true while the preview pop-out WebviewWindow is open */
  previewPoppedOut: boolean;
}

const DEFAULTS: LayoutState = {
  fileTreeWidth: 260,
  fileTreeCollapsed: false,
  gitPanelWidth: 320,
  gitPanelCollapsed: false,
  centerSplit: 0.5,
  previewCollapsed: false,
  previewPosition: 'side',
  editorHeightSplit: 0.55,
  previewFullscreen: false,
  previewPoppedOut: false,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function loadFromStorage(): LayoutState {
  if (!browser) return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<LayoutState>;
    return { ...DEFAULTS, ...parsed, previewFullscreen: false, previewPoppedOut: false };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveToStorage(state: LayoutState): void {
  if (!browser) return;
  try {
    // Never persist transient overlay/popup state
    const { previewFullscreen: _fs, previewPoppedOut: _po, ...toSave } = state;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch {
    // Ignore storage errors
  }
}

function createLayoutStore() {
  const { subscribe, update, set } = writable<LayoutState>(loadFromStorage());

  // Persist on every change
  subscribe(saveToStorage);

  return {
    subscribe,
    set,
    update,

    toggleFileTree: () => update((s) => ({ ...s, fileTreeCollapsed: !s.fileTreeCollapsed })),

    toggleGitPanel: () => update((s) => ({ ...s, gitPanelCollapsed: !s.gitPanelCollapsed })),

    togglePreview: () => update((s) => ({ ...s, previewCollapsed: !s.previewCollapsed })),

    togglePreviewPosition: () =>
      update((s) => ({
        ...s,
        previewPosition: s.previewPosition === 'side' ? 'below' : 'side',
      })),

    togglePreviewFullscreen: () =>
      update((s) => ({ ...s, previewFullscreen: !s.previewFullscreen })),

    setPreviewPoppedOut: (value: boolean) =>
      update((s) => ({ ...s, previewPoppedOut: value })),

    setFileTreeWidth: (w: number) =>
      update((s) => ({ ...s, fileTreeWidth: clamp(w, 120, 600) })),

    setGitPanelWidth: (w: number) =>
      update((s) => ({ ...s, gitPanelWidth: clamp(w, 180, 700) })),

    setCenterSplit: (v: number) =>
      update((s) => ({ ...s, centerSplit: clamp(v, 0.15, 0.85) })),

    setEditorHeightSplit: (v: number) =>
      update((s) => ({ ...s, editorHeightSplit: clamp(v, 0.15, 0.85) })),
  };
}

export const layout = createLayoutStore();
