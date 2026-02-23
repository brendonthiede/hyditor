import { invoke } from '@tauri-apps/api/core';

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

export async function startDeviceFlow(): Promise<DeviceFlowStart> {
  return invoke<DeviceFlowStart>('start_device_flow');
}

export async function pollForToken(deviceCode: string): Promise<PollTokenResult> {
  return invoke<PollTokenResult>('poll_for_token', { deviceCode });
}

export async function getToken(): Promise<string | null> {
  return invoke<string | null>('get_token');
}

export async function signOut(): Promise<void> {
  await invoke('sign_out');
}
