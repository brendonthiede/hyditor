import { tauriInvoke } from '$lib/tauri/runtime';

export type LastSession = {
  owner: string;
  name: string;
  last_branch: string;
  last_file: string | null;
};

export async function saveLastSession(
  owner: string,
  name: string,
  lastBranch: string,
  lastFile: string | null
): Promise<void> {
  await tauriInvoke('save_last_session', {
    owner,
    name,
    lastBranch,
    lastFile
  });
}

export async function loadLastSession(): Promise<LastSession | null> {
  return tauriInvoke<LastSession | null>('load_last_session');
}

export async function clearLastSession(): Promise<void> {
  await tauriInvoke('clear_last_session');
}
