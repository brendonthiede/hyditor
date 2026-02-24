import { tauriInvoke } from '$lib/tauri/runtime';
import type { TreeItem } from '$lib/stores/editor';

export async function readTree(repoPath: string): Promise<TreeItem[]> {
  return tauriInvoke<TreeItem[]>('read_tree', { repoPath });
}

export async function readFile(path: string): Promise<string> {
  return tauriInvoke<string>('read_file_scoped', { path });
}

export async function writeFile(path: string, content: string): Promise<void> {
  await tauriInvoke('write_file_scoped', { path, content });
}
