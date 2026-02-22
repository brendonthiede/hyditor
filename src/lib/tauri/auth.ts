import { invoke } from '@tauri-apps/api/core';

export type DeviceFlowStart = {
  verification_uri: string;
  user_code: string;
  device_code: string;
  interval: number;
};

export async function startDeviceFlow(): Promise<DeviceFlowStart> {
  return invoke<DeviceFlowStart>('start_device_flow');
}

export async function signOut(): Promise<void> {
  await invoke('sign_out');
}
