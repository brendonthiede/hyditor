use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct DeviceFlowStart {
    pub verification_uri: String,
    pub user_code: String,
    pub device_code: String,
    pub interval: u64,
}

#[tauri::command]
pub async fn start_device_flow() -> Result<DeviceFlowStart, String> {
    Ok(DeviceFlowStart {
        verification_uri: "https://github.com/login/device".to_string(),
        user_code: "HYDI-TOR1".to_string(),
        device_code: "pending-device-code".to_string(),
        interval: 5,
    })
}

#[tauri::command]
pub async fn poll_for_token(_device_code: String) -> Result<String, String> {
    Err("authorization_pending".to_string())
}
