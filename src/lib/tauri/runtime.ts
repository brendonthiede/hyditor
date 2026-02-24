import { invoke } from '@tauri-apps/api/core';

const TAURI_RUNTIME_ERROR =
  'Hyditor desktop APIs are unavailable in this browser tab. Open and use the Hyditor desktop window instead.';

function hasTauriInternals(): boolean {
  if (typeof window === 'undefined') {
    return true;
  }

  const internals = (window as Window & { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__;
  return typeof internals?.invoke === 'function';
}

export function assertTauriRuntime(): void {
  if (!hasTauriInternals()) {
    throw new Error(TAURI_RUNTIME_ERROR);
  }
}

export async function tauriInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  assertTauriRuntime();
  return invoke<T>(command, args);
}
