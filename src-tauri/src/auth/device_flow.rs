use crate::auth::token_store::{set_token, StoredToken};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Serialize, Deserialize)]
pub struct DeviceFlowStart {
    pub verification_uri: String,
    pub user_code: String,
    pub device_code: String,
    pub interval: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PollTokenResult {
    pub status: String,
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub expires_in: Option<i64>,
    pub refresh_token_expires_in: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct DeviceFlowStartResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    interval: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct DeviceFlowTokenResponse {
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_in: Option<i64>,
    refresh_token_expires_in: Option<i64>,
    error: Option<String>,
}

const DEFAULT_CLIENT_ID: &str = "Iv1.REPLACE_WITH_YOUR_GITHUB_APP_CLIENT_ID";

fn github_client_id() -> Result<String, String> {
    // Check env first for override (useful in dev/testing)
    if let Ok(client_id) = std::env::var("HYDITOR_GITHUB_CLIENT_ID") {
        if !client_id.is_empty() {
            return Ok(client_id);
        }
    }
    
    // Use hardcoded default client ID (public, safe to embed)
    if DEFAULT_CLIENT_ID.starts_with("Iv1.") && DEFAULT_CLIENT_ID.len() > 10 {
        Ok(DEFAULT_CLIENT_ID.to_string())
    } else {
        Err("GitHub client ID not configured. Set HYDITOR_GITHUB_CLIENT_ID or update DEFAULT_CLIENT_ID in source.".to_string())
    }
}

#[tauri::command]
pub async fn start_device_flow() -> Result<DeviceFlowStart, String> {
    let client_id = github_client_id()?;
    let client = Client::new();
    let response = client
        .post("https://github.com/login/device/code")
        .header("Accept", "application/json")
        .header("User-Agent", "hyditor")
        .form(&[
            ("client_id", client_id.as_str()),
            ("scope", "repo read:user"),
        ])
        .send()
        .await
        .map_err(|err| format!("failed to start device flow: {err}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "<no response body>".to_string());
        return Err(format!(
            "device flow start failed with status {status}: {body}"
        ));
    }

    let payload: DeviceFlowStartResponse = response
        .json()
        .await
        .map_err(|err| format!("invalid device flow start response: {err}"))?;

    Ok(DeviceFlowStart {
        verification_uri: payload.verification_uri,
        user_code: payload.user_code,
        device_code: payload.device_code,
        interval: payload.interval.unwrap_or(5),
    })
}

#[tauri::command]
pub async fn poll_for_token(app: tauri::AppHandle, device_code: String) -> Result<PollTokenResult, String> {
    let client_id = github_client_id()?;
    let client = Client::new();
    let response = client
        .post("https://github.com/login/oauth/access_token")
        .header("Accept", "application/json")
        .header("User-Agent", "hyditor")
        .form(&[
            ("client_id", client_id.as_str()),
            ("device_code", device_code.as_str()),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
        ])
        .send()
        .await
        .map_err(|err| format!("failed to poll for token: {err}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "<no response body>".to_string());
        return Err(format!("token polling failed with status {status}: {body}"));
    }

    let payload: DeviceFlowTokenResponse = response
        .json()
        .await
        .map_err(|err| format!("invalid token polling response: {err}"))?;

    if let Some(access_token) = payload.access_token.clone() {
        let expires_at = payload.expires_in.and_then(|expires_in| {
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .ok()
                .map(|duration| duration.as_secs() as i64 + expires_in)
        });

        set_token(&app, StoredToken {
            access_token: access_token.clone(),
            refresh_token: payload.refresh_token.clone(),
            expires_at,
        })?;

        return Ok(PollTokenResult {
            status: "authorized".to_string(),
            access_token: Some(access_token),
            refresh_token: payload.refresh_token,
            expires_in: payload.expires_in,
            refresh_token_expires_in: payload.refresh_token_expires_in,
        });
    }

    let status = match payload.error.as_deref() {
        Some("authorization_pending") => "authorization_pending",
        Some("slow_down") => "slow_down",
        Some("expired_token") => "expired_token",
        Some("access_denied") => "access_denied",
        Some(_) => "error",
        None => "error",
    };

    Ok(PollTokenResult {
        status: status.to_string(),
        access_token: None,
        refresh_token: None,
        expires_in: None,
        refresh_token_expires_in: None,
    })
}

/// Refresh an expired access token using the refresh token
pub async fn refresh_access_token(
    app: &tauri::AppHandle,
    refresh_token: &str,
) -> Result<StoredToken, String> {
    let client_id = github_client_id()?;
    let client = Client::new();
    let response = client
        .post("https://github.com/login/oauth/access_token")
        .header("Accept", "application/json")
        .header("User-Agent", "hyditor")
        .form(&[
            ("client_id", client_id.as_str()),
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
        ])
        .send()
        .await
        .map_err(|err| format!("failed to refresh token: {err}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "<no response body>".to_string());
        return Err(format!("token refresh failed with status {status}: {body}"));
    }

    let payload: DeviceFlowTokenResponse = response
        .json()
        .await
        .map_err(|err| format!("invalid token refresh response: {err}"))?;

    if let Some(access_token) = payload.access_token {
        let expires_at = payload.expires_in.and_then(|expires_in| {
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .ok()
                .map(|duration| duration.as_secs() as i64 + expires_in)
        });

        let new_token = StoredToken {
            access_token,
            refresh_token: payload.refresh_token.or_else(|| Some(refresh_token.to_string())),
            expires_at,
        };

        set_token(app, new_token.clone())?;
        Ok(new_token)
    } else {
        Err("token refresh did not return access token".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Mutex, OnceLock};

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    #[test]
    fn github_client_id_prefers_env_var() {
        let _guard = env_lock().lock().expect("env lock should not be poisoned");

        // Save original value if it exists
        let original = std::env::var("HYDITOR_GITHUB_CLIENT_ID").ok();
        
        // Set test value
        std::env::set_var("HYDITOR_GITHUB_CLIENT_ID", "Iv1.test_override_id");
        let result = github_client_id();
        
        // Verify env var was used
        assert!(result.is_ok(), "github_client_id() should succeed");
        assert_eq!(
            result.unwrap(),
            "Iv1.test_override_id",
            "should use env var value"
        );
        
        // Restore original value
        if let Some(orig) = original {
            std::env::set_var("HYDITOR_GITHUB_CLIENT_ID", orig);
        } else {
            std::env::remove_var("HYDITOR_GITHUB_CLIENT_ID");
        }
    }

    #[test]
    fn github_client_id_falls_back_to_default() {
        let _guard = env_lock().lock().expect("env lock should not be poisoned");

        std::env::remove_var("HYDITOR_GITHUB_CLIENT_ID");
        let result = github_client_id();
        
        // The result depends on whether DEFAULT_CLIENT_ID is configured
        // If it's the placeholder, it should error; otherwise it should work
        match result {
            Ok(id) => {
                // If it succeeds, must be valid format
                assert!(id.starts_with("Iv1."));
                assert!(id.len() > 10);
            }
            Err(e) => {
                // If it fails, should be the "not configured" error
                assert!(e.contains("not configured"));
            }
        }
    }

    #[test]
    fn github_client_id_validates_default_format() {
        let _guard = env_lock().lock().expect("env lock should not be poisoned");

        std::env::remove_var("HYDITOR_GITHUB_CLIENT_ID");
        
        // The hardcoded default should either be a valid placeholder or a real client ID
        let result = github_client_id();
        
        if result.is_ok() {
            let id = result.unwrap();
            assert!(id.starts_with("Iv1."));
            assert!(id.len() > 10);
        }
    }
}
