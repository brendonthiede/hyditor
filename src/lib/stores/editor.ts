import { writable } from 'svelte/store';

export type TreeItem = {
  path: string;
  is_dir: boolean;
};

export const fileTree = writable<TreeItem[]>([]);

export const editorState = writable<{
  currentFile: string | null;
  currentContent: string;
  originalContent: string;
}>({
  currentFile: null,
  currentContent: '# Welcome to Hyditor\n\nStart editing your Jekyll content.',
  originalContent: '# Welcome to Hyditor\n\nStart editing your Jekyll content.'
});

export function updateCurrentContent(content: string): void {
  editorState.update((state) => ({ ...state, currentContent: content }));
}

export function setCurrentFileContent(path: string, content: string): void {
  editorState.set({
    currentFile: path,
    currentContent: content,
    originalContent: content
  });
}

export function markCurrentContentSaved(): void {
  editorState.update((state) => ({ ...state, originalContent: state.currentContent }));
}
