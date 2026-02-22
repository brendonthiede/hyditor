import { writable } from 'svelte/store';

type Preset = 'desktop' | 'tablet' | 'mobile';

const PRESETS: Record<Preset, { width: number; height: number }> = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 812 }
};

export const previewState = writable<{
  mode: 'instant' | 'jekyll';
  viewport: { width: number; height: number };
}>({ mode: 'instant', viewport: PRESETS.desktop });

export function setViewportPreset(preset: Preset): void {
  previewState.update((state) => ({ ...state, viewport: PRESETS[preset] }));
}
