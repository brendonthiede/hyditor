import { writable } from 'svelte/store';
import { getToken, pollForToken, signOut, startDeviceFlow } from '$lib/tauri/auth';
import { extractAuthExpiredMessage } from '$lib/utils/authErrors';

type AuthState = {
  status: 'signed_out' | 'pending' | 'authenticated' | 'error';
  userCode?: string;
  verificationUri?: string;
  message?: string;
  pollStatus?: string;
};

export const authState = writable<AuthState>({ status: 'signed_out' });

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
  authState.set({
    status: 'error',
    message: message ?? 'GitHub session expired. Sign in again to continue.'
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runPolling(deviceCode: string, intervalSeconds: number, signal: AbortSignal): Promise<void> {
  let currentIntervalMs = Math.max(intervalSeconds, 1) * 1000;

  while (!signal.aborted) {
    const result = await pollForToken(deviceCode);

    authState.update((current) => {
      if (current.status !== 'pending') {
        return current;
      }

      return {
        ...current,
        pollStatus: result.status
      };
    });

    if (result.status === 'authorized') {
      try {
        const token = await getToken();
        if (token) {
          authState.set({ status: 'authenticated' });
          return;
        }

        authState.set({
          status: 'error',
          message: 'Authentication succeeded but token storage failed. Clear local session and sign in again.'
        });
        return;
      } catch (error) {
        authState.set({
          status: 'error',
          message: toErrorMessage(error, 'Failed to verify stored token. Sign in again.')
        });
        return;
      }
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

    await sleep(currentIntervalMs);
  }
}

export async function loadAuthState(): Promise<void> {
  try {
    const token = await getToken();
    if (token) {
      authState.set({ status: 'authenticated' });
    } else {
      authState.set({ status: 'signed_out' });
    }
  } catch (error) {
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
    authState.set({
      status: 'pending',
      userCode: flow.user_code,
      verificationUri: flow.verification_uri,
      message: 'Complete authorization in GitHub to finish signing in.',
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
