import { invoke } from '@tauri-apps/api/core';
import type { TreeItem } from '$lib/stores/editor';

export async function readTree(repoPath: string): Promise<TreeItem[]> {
  return invoke<TreeItem[]>('read_tree', { repoPath });
}

export async function readFile(path: string): Promise<string> {
  return invoke<string>('read_file_scoped', { path });
}

export async function writeFile(path: string, content: string): Promise<void> {
  await invoke('write_file_scoped', { path, content });
}
