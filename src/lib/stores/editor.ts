import { writable } from 'svelte/store';
import { detectLineEnding, type LineEnding } from '$lib/utils/lineEndings';

/**
 * Timestamp (ms) of the last successful file save.
 * GitPanel subscribes to this to auto-refresh git status after edits.
 */
export const lastSavedAt = writable<number>(0);

export type TreeItem = {
  path: string;
  is_dir: boolean;
};

export const fileTree = writable<TreeItem[]>([]);

export const editorState = writable<{
  currentFile: string | null;
  currentContent: string;
  originalContent: string;
  lineEnding: LineEnding;
}>({
  currentFile: null,
  currentContent: '# Welcome to Hyditor\n\nStart editing your Jekyll content.',
  originalContent: '# Welcome to Hyditor\n\nStart editing your Jekyll content.',
  lineEnding: 'lf'
});

const initialEditorContent = '# Welcome to Hyditor\n\nStart editing your Jekyll content.';

export function updateCurrentContent(content: string): void {
  editorState.update((state) => ({ ...state, currentContent: content }));
}

export function setCurrentFileContent(path: string, content: string): void {
  editorState.set({
    currentFile: path,
    currentContent: content,
    originalContent: content,
    lineEnding: detectLineEnding(content)
  });
}

export function setCurrentImageFile(path: string): void {
  editorState.set({
    currentFile: path,
    currentContent: '',
    originalContent: '',
    lineEnding: 'lf'
  });
}

export function markCurrentContentSaved(savedContent?: string): void {
  editorState.update((state) => ({
    ...state,
    originalContent: savedContent ?? state.currentContent
  }));
  lastSavedAt.set(Date.now());
}

export function resetEditorState(): void {
  fileTree.set([]);
  editorState.set({
    currentFile: null,
    currentContent: initialEditorContent,
    originalContent: initialEditorContent,
    lineEnding: 'lf'
  });
}
