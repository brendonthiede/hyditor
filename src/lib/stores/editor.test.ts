import { describe, expect, it, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
  editorState,
  fileTree,
  lastSavedAt,
  markCurrentContentSaved,
  resetEditorState,
  setCurrentFileContent,
  updateCurrentContent
} from './editor';

const INITIAL_CONTENT = '# Welcome to Hyditor\n\nStart editing your Jekyll content.';

describe('editor store', () => {
  beforeEach(() => {
    resetEditorState();
    lastSavedAt.set(0);
  });

  describe('updateCurrentContent', () => {
    it('updates currentContent while preserving other fields', () => {
      setCurrentFileContent('test.md', 'original');
      updateCurrentContent('modified');

      const state = get(editorState);
      expect(state.currentContent).toBe('modified');
      expect(state.currentFile).toBe('test.md');
      expect(state.originalContent).toBe('original');
      expect(state.lineEnding).toBe('lf');
    });

    it('does not change originalContent', () => {
      updateCurrentContent('new text');

      const state = get(editorState);
      expect(state.currentContent).toBe('new text');
      expect(state.originalContent).toBe(INITIAL_CONTENT);
    });
  });

  describe('setCurrentFileContent', () => {
    it('sets path, currentContent, and originalContent together', () => {
      setCurrentFileContent('docs/guide.md', '# Guide');

      const state = get(editorState);
      expect(state.currentFile).toBe('docs/guide.md');
      expect(state.currentContent).toBe('# Guide');
      expect(state.originalContent).toBe('# Guide');
      expect(state.lineEnding).toBe('lf');
    });

    it('detects CRLF line endings from file content', () => {
      setCurrentFileContent('docs/guide.md', '# Guide\r\n\r\nBody\r\n');

      const state = get(editorState);
      expect(state.lineEnding).toBe('crlf');
    });
  });

  describe('markCurrentContentSaved', () => {
    it('syncs originalContent to currentContent', () => {
      setCurrentFileContent('test.md', 'original');
      updateCurrentContent('edited version');

      const before = get(editorState);
      expect(before.currentContent).not.toBe(before.originalContent);

      markCurrentContentSaved();

      const after = get(editorState);
      expect(after.originalContent).toBe('edited version');
      expect(after.currentContent).toBe('edited version');
      expect(after.lineEnding).toBe('lf');
    });

    it('updates lastSavedAt timestamp', () => {
      const beforeSave = get(lastSavedAt);
      expect(beforeSave).toBe(0);

      markCurrentContentSaved();

      const afterSave = get(lastSavedAt);
      expect(afterSave).toBeGreaterThan(0);
    });

    it('supports explicitly saved content snapshots', () => {
      setCurrentFileContent('test.md', 'original');
      updateCurrentContent('newer unsaved edit');

      markCurrentContentSaved('older saved edit');

      const after = get(editorState);
      expect(after.originalContent).toBe('older saved edit');
      expect(after.currentContent).toBe('newer unsaved edit');
    });
  });

  describe('resetEditorState', () => {
    it('resets editorState to defaults', () => {
      setCurrentFileContent('test.md', 'some content');
      updateCurrentContent('modified');
      resetEditorState();

      const state = get(editorState);
      expect(state.currentFile).toBeNull();
      expect(state.currentContent).toBe(INITIAL_CONTENT);
      expect(state.originalContent).toBe(INITIAL_CONTENT);
      expect(state.lineEnding).toBe('lf');
    });

    it('clears the file tree', () => {
      fileTree.set([
        { path: 'a.md', is_dir: false },
        { path: 'dir', is_dir: true }
      ]);
      resetEditorState();

      expect(get(fileTree)).toEqual([]);
    });
  });
});
