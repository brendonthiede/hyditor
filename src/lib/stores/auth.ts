import { writable } from 'svelte/store';
import { writeText as writeClipboardText } from '@tauri-apps/plugin-clipboard-manager';
import {
  getToken,
  pollForToken,
  signOut,
  startDeviceFlow
} from '$lib/tauri/auth';
import { extractAuthExpiredMessage } from '$lib/utils/authErrors';
import { toErrorMessage } from '$lib/utils/errors';

type AuthState = {
  status: 'loading' | 'signed_out' | 'pending' | 'authenticated' | 'error';
  userCode?: string;
  verificationUri?: string;
  message?: string;
  pollStatus?: string;
};

export const authState = writable<AuthState>({ status: 'loading' });

let activePoll: AbortController | null = null;

// toErrorMessage imported from '$lib/utils/errors'

export function requireReauthentication(message?: string): void {
  activePoll?.abort();
  activePoll = null;
  authState.set({
    status: 'error',
    message: message ?? 'GitHub session expired. Sign in again to continue.'
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  let currentIntervalMs = Math.max(intervalSeconds, 1) * 1000;
  let pollCount = 0;

  while (!signal.aborted) {
    // Countdown timer between polls
    const intervalSec = currentIntervalMs / 1000;
    for (let remaining = intervalSec; remaining > 0; remaining--) {
      if (signal.aborted) return;
      authState.update((current) => {
        if (current.status !== 'pending') return current;
        const countdownText = pollCount === 0
          ? `Checking in ${remaining}s…`
          : `Waiting for authorization — next check in ${remaining}s (poll #${pollCount})`;
        return { ...current, pollStatus: countdownText };
      });
      await sleep(1000);
    }
    if (signal.aborted) return;

    pollCount++;
    authState.update((current) => {
      if (current.status !== 'pending') return current;
      return { ...current, pollStatus: `Checking GitHub… (poll #${pollCount})` };
    });

    const result = await pollForToken(deviceCode);

    if (result.status === 'authorized') {
      // Token was already stored by the backend's poll_for_token — no
      // redundant getToken() call needed (that was the old 44s bottleneck).
      authState.set({ status: 'authenticated' });
      return;
    }

    if (result.status === 'slow_down') {
      currentIntervalMs += 5000;
    } else if (result.status === 'access_denied') {
      authState.set({ status: 'error', message: 'Authorization was denied in GitHub.' });
      return;
    } else if (result.status === 'expired_token') {
      authState.set({ status: 'error', message: 'Authorization code expired. Start again.' });
      return;
    } else if (result.status !== 'authorization_pending') {
      authState.set({ status: 'error', message: 'Authentication failed. Please try again.' });
      return;
    }
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
  await signOut();
  authState.set({ status: 'signed_out' });
}
