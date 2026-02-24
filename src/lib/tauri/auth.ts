import { tauriInvoke } from '$lib/tauri/runtime';

export type DeviceFlowStart = {
  verification_uri: string;
  user_code: string;
  device_code: string;
  interval: number;
};

export type PollTokenResult = {
  status: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
};

export type PollStatusEvent = {
  status: string;
  polls_completed: number;
  interval_seconds: number;
};

export async function startDeviceFlow(): Promise<DeviceFlowStart> {
  return tauriInvoke<DeviceFlowStart>('start_device_flow');
}

export async function pollForToken(deviceCode: string): Promise<PollTokenResult> {
  return tauriInvoke<PollTokenResult>('poll_for_token', { deviceCode });
}

/** Start backend-managed polling loop. Returns when auth completes, fails, or is cancelled. */
export async function startDevicePolling(
  deviceCode: string,
  interval: number
): Promise<PollTokenResult> {
  return tauriInvoke<PollTokenResult>('start_device_polling', { deviceCode, interval });
}

/** Cancel any in-progress backend polling loop. */
export async function cancelDevicePolling(): Promise<void> {
  await tauriInvoke('cancel_device_polling');
}

export async function getToken(): Promise<string | null> {
  return tauriInvoke<string | null>('get_token');
}

export async function signOut(): Promise<void> {
  await tauriInvoke('sign_out');
}
