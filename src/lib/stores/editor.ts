import { writable } from 'svelte/store';

export type TreeItem = {
  path: string;
  is_dir: boolean;
};

export const fileTree = writable<TreeItem[]>([]);

export const editorState = writable<{
  currentFile: string | null;
  currentContent: string;
}>({
  currentFile: null,
  currentContent: '# Welcome to Hyditor\n\nStart editing your Jekyll content.'
});

export function updateCurrentContent(content: string): void {
  editorState.update((state) => ({ ...state, currentContent: content }));
}
