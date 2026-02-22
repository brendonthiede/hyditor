import { writable } from 'svelte/store';
import { startDeviceFlow } from '$lib/tauri/auth';

type AuthState = {
  status: 'signed_out' | 'pending' | 'authenticated';
  userCode?: string;
  verificationUri?: string;
};

export const authState = writable<AuthState>({ status: 'signed_out' });

export async function beginAuth(): Promise<void> {
  authState.set({ status: 'pending' });
  const flow = await startDeviceFlow();
  authState.set({
    status: 'authenticated',
    userCode: flow.user_code,
    verificationUri: flow.verification_uri
  });
}
