import { tauriInvoke } from '$lib/tauri/runtime';
import type { TreeItem } from '$lib/stores/editor';

export async function readTree(repoPath: string): Promise<TreeItem[]> {
  return tauriInvoke<TreeItem[]>('read_tree', { repoPath });
}

export async function readFile(path: string): Promise<string> {
  return tauriInvoke<string>('read_file_scoped', { path });
}

export async function readFileBase64(path: string): Promise<string> {
  return tauriInvoke<string>('read_file_base64', { path });
}

export async function writeFile(path: string, content: string): Promise<void> {
  await tauriInvoke('write_file_scoped', { path, content });
}

export async function copyFileIntoRepo(srcPath: string, destDir: string): Promise<string> {
  return tauriInvoke<string>('copy_file_into_repo', { srcPath, destDir });
}

export async function exportFile(srcPath: string, destPath: string): Promise<void> {
  await tauriInvoke('export_file', { srcPath, destPath });
}

export interface SearchMatch {
  line: number;
  content: string;
}

export interface FileSearchResult {
  file: string;
  matches: SearchMatch[];
}

export async function searchRepoFiles(repoPath: string, query: string): Promise<FileSearchResult[]> {
  return tauriInvoke<FileSearchResult[]>('search_repo_files', { repoPath, query });
}
