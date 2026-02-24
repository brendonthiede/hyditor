import { writable } from 'svelte/store';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { writeText as writeClipboardText } from '@tauri-apps/plugin-clipboard-manager';
import {
  cancelDevicePolling,
  getToken,
  signOut,
  startDeviceFlow,
  startDevicePolling,
  type PollStatusEvent
} from '$lib/tauri/auth';
import { extractAuthExpiredMessage } from '$lib/utils/authErrors';

type AuthState = {
  status: 'loading' | 'signed_out' | 'pending' | 'authenticated' | 'error';
  userCode?: string;
  verificationUri?: string;
  message?: string;
  pollStatus?: string;
};

export const authState = writable<AuthState>({ status: 'loading' });

let activePoll: AbortController | null = null;

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim().length > 0) {
    return error;
  }

  if (error && typeof error === 'object' && 'message' in error) {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === 'string' && maybeMessage.trim().length > 0) {
      return maybeMessage;
    }
  }

  return fallback;
}

export function requireReauthentication(message?: string): void {
  activePoll?.abort();
  activePoll = null;
  cancelDevicePolling().catch(() => {});
  authState.set({
    status: 'error',
    message: message ?? 'GitHub session expired. Sign in again to continue.'
  });
}

async function copyToClipboard(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  await writeClipboardText(text);
}

async function runPolling(
  deviceCode: string,
  intervalSeconds: number,
  signal: AbortSignal
): Promise<void> {
  // Listen for backend status events to update the UI during polling
  let unlisten: UnlistenFn | null = null;
  try {
    unlisten = await listen<PollStatusEvent>('auth://poll-status', (event) => {
      authState.update((current) => {
        if (current.status !== 'pending') return current;
        const { status, polls_completed, interval_seconds } = event.payload;
        return {
          ...current,
          pollStatus: `${status} (poll #${polls_completed}, next in ${interval_seconds}s)`
        };
      });
    });
  } catch {
    // Event listening failed; polling still works, just no intermediate status updates
  }

  // Cancel backend polling if the frontend abort signal fires
  const onAbort = () => {
    cancelDevicePolling().catch(() => {});
  };
  signal.addEventListener('abort', onAbort);

  try {
    // Single IPC call — the Rust backend handles the polling loop internally
    const result = await startDevicePolling(deviceCode, intervalSeconds);

    if (signal.aborted) return;

    if (result.status === 'authorized') {
      // Token was already stored by the backend — no redundant getToken() call needed
      authState.set({ status: 'authenticated' });
      return;
    }

    if (result.status === 'cancelled') {
      return; // Silently handled (user started a new flow or navigated away)
    }

    if (result.status === 'access_denied') {
      authState.set({ status: 'error', message: 'Authorization was denied in GitHub.' });
      return;
    }

    if (result.status === 'expired_token') {
      authState.set({ status: 'error', message: 'Authorization code expired. Start again.' });
      return;
    }

    authState.set({ status: 'error', message: 'Authentication failed. Please try again.' });
  } finally {
    signal.removeEventListener('abort', onAbort);
    unlisten?.();
  }
}

/** Read the current snapshot of the auth store (synchronous). */
function currentAuthStatus(): AuthState['status'] {
  let status: AuthState['status'] = 'loading';
  authState.subscribe((s) => (status = s.status))();
  return status;
}

export async function loadAuthState(): Promise<void> {
  try {
    const token = await getToken();

    // Guard: if the user already started a sign-in flow (or completed it)
    // while we were waiting for Stronghold, don't overwrite their state.
    const current = currentAuthStatus();
    if (current === 'pending' || current === 'authenticated') {
      return;
    }

    if (token) {
      authState.set({ status: 'authenticated' });
    } else {
      authState.set({ status: 'signed_out' });
    }
  } catch (error) {
    // Same guard after an error – don't clobber an active flow.
    const current = currentAuthStatus();
    if (current === 'pending' || current === 'authenticated') {
      return;
    }

    const message = toErrorMessage(error, 'Session expired. Use local sign-out and sign in again.');
    const authExpiredMessage = extractAuthExpiredMessage(message);
    if (authExpiredMessage) {
      requireReauthentication(authExpiredMessage);
      return;
    }

    authState.set({
      status: 'error',
      message
    });
  }
}

export async function beginAuth(): Promise<void> {
  activePoll?.abort();
  activePoll = new AbortController();
  // Cancel any backend polling from a previous flow
  cancelDevicePolling().catch(() => {});

  authState.set({ status: 'pending' });

  try {
    const flow = await startDeviceFlow();

    let codeCopied = false;
    try {
      await copyToClipboard(flow.user_code);
      codeCopied = true;
    } catch {
      // Clipboard write failed; user will need to copy the code manually
    }

    authState.set({
      status: 'pending',
      userCode: flow.user_code,
      verificationUri: flow.verification_uri,
      message: codeCopied
        ? 'Code copied to clipboard. Open the link above and paste it to sign in.'
        : 'Copy the code above, open the link, and paste it to sign in.',
      pollStatus: 'starting'
    });

    await runPolling(flow.device_code, flow.interval, activePoll.signal);
  } catch (error) {
    authState.set({
      status: 'error',
      message: toErrorMessage(error, 'Failed to start authentication.')
    });
  }
}

export async function logOut(): Promise<void> {
  activePoll?.abort();
  activePoll = null;
  cancelDevicePolling().catch(() => {});
  await signOut();
  authState.set({ status: 'signed_out' });
}
