import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock $app/environment before importing the store
vi.mock('$app/environment', () => ({
  browser: false
}));

// Dynamic import to ensure mock is in place
const { layout } = await import('./layout');
import { get } from 'svelte/store';

describe('layout store', () => {
  beforeEach(() => {
    // Reset to defaults
    layout.set({
      fileTreeWidth: 260,
      fileTreeCollapsed: false,
      centerSplit: 0.5,
      previewCollapsed: false,
      previewPosition: 'side',
      editorHeightSplit: 0.55,
      previewFullscreen: false,
      previewPoppedOut: false,
      leftPanelBlade: 'files'
    });
  });

  describe('setFileTreeWidth', () => {
    it('clamps to minimum of 120', () => {
      layout.setFileTreeWidth(50);
      expect(get(layout).fileTreeWidth).toBe(120);
    });

    it('clamps to maximum of 600', () => {
      layout.setFileTreeWidth(1000);
      expect(get(layout).fileTreeWidth).toBe(600);
    });

    it('accepts values within range', () => {
      layout.setFileTreeWidth(300);
      expect(get(layout).fileTreeWidth).toBe(300);
    });

    it('clamps exactly at boundaries', () => {
      layout.setFileTreeWidth(120);
      expect(get(layout).fileTreeWidth).toBe(120);
      layout.setFileTreeWidth(600);
      expect(get(layout).fileTreeWidth).toBe(600);
    });
  });

  describe('setCenterSplit', () => {
    it('clamps to minimum of 0.15', () => {
      layout.setCenterSplit(0);
      expect(get(layout).centerSplit).toBe(0.15);
    });

    it('clamps to maximum of 0.85', () => {
      layout.setCenterSplit(1);
      expect(get(layout).centerSplit).toBe(0.85);
    });

    it('accepts values within range', () => {
      layout.setCenterSplit(0.6);
      expect(get(layout).centerSplit).toBe(0.6);
    });
  });

  describe('setEditorHeightSplit', () => {
    it('clamps to minimum of 0.15', () => {
      layout.setEditorHeightSplit(0.05);
      expect(get(layout).editorHeightSplit).toBe(0.15);
    });

    it('clamps to maximum of 0.85', () => {
      layout.setEditorHeightSplit(0.95);
      expect(get(layout).editorHeightSplit).toBe(0.85);
    });

    it('accepts values within range', () => {
      layout.setEditorHeightSplit(0.7);
      expect(get(layout).editorHeightSplit).toBe(0.7);
    });
  });

  describe('toggleFileTree', () => {
    it('toggles fileTreeCollapsed', () => {
      expect(get(layout).fileTreeCollapsed).toBe(false);
      layout.toggleFileTree();
      expect(get(layout).fileTreeCollapsed).toBe(true);
      layout.toggleFileTree();
      expect(get(layout).fileTreeCollapsed).toBe(false);
    });
  });

  describe('togglePreview', () => {
    it('toggles previewCollapsed', () => {
      expect(get(layout).previewCollapsed).toBe(false);
      layout.togglePreview();
      expect(get(layout).previewCollapsed).toBe(true);
      layout.togglePreview();
      expect(get(layout).previewCollapsed).toBe(false);
    });
  });

  describe('togglePreviewPosition', () => {
    it('toggles between side and below', () => {
      expect(get(layout).previewPosition).toBe('side');
      layout.togglePreviewPosition();
      expect(get(layout).previewPosition).toBe('below');
      layout.togglePreviewPosition();
      expect(get(layout).previewPosition).toBe('side');
    });
  });

  describe('togglePreviewFullscreen', () => {
    it('toggles previewFullscreen', () => {
      expect(get(layout).previewFullscreen).toBe(false);
      layout.togglePreviewFullscreen();
      expect(get(layout).previewFullscreen).toBe(true);
      layout.togglePreviewFullscreen();
      expect(get(layout).previewFullscreen).toBe(false);
    });
  });

  describe('setPreviewPoppedOut', () => {
    it('sets previewPoppedOut to the given value', () => {
      layout.setPreviewPoppedOut(true);
      expect(get(layout).previewPoppedOut).toBe(true);
      layout.setPreviewPoppedOut(false);
      expect(get(layout).previewPoppedOut).toBe(false);
    });
  });

  describe('setLeftPanelBlade', () => {
    it('sets the active blade', () => {
      layout.setLeftPanelBlade('search');
      expect(get(layout).leftPanelBlade).toBe('search');
      layout.setLeftPanelBlade('git');
      expect(get(layout).leftPanelBlade).toBe('git');
      layout.setLeftPanelBlade('files');
      expect(get(layout).leftPanelBlade).toBe('files');
    });
  });
});
