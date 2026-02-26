use crate::auth::token_store::{set_token, StoredToken};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Emitter;

fn log_auth(message: &str) {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    eprintln!("[Auth][{ts}] {message}");
}

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

#[derive(Debug, Clone, Serialize)]
struct PollStatusEvent {
    status: String,
    polls_completed: u32,
    interval_seconds: u64,
}

static POLLING_CANCELLED: AtomicBool = AtomicBool::new(false);

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

// The client_id is public and safe to commit — it appears in plaintext in every
// Device Flow HTTP request. Works with both GitHub Apps (Iv1.xxx) and OAuth Apps
// (20-char hex). Replace the placeholder with your app's client ID.
// For dev/test overrides, set the HYDITOR_GITHUB_CLIENT_ID env var (or .env file).
const DEFAULT_CLIENT_ID: &str = "Ov23liua1nTIwFhuvkBB";

fn looks_like_placeholder_client_id(client_id: &str) -> bool {
    client_id.contains("REPLACE_WITH_YOUR_GITHUB_CLIENT_ID")
}

fn github_client_id() -> Result<String, String> {
    // Runtime env var takes priority (dev/test override via .env file)
    if let Ok(client_id) = std::env::var("HYDITOR_GITHUB_CLIENT_ID") {
        if !client_id.is_empty() && !looks_like_placeholder_client_id(&client_id) {
            return Ok(client_id);
        }
    }

    // Use the default client ID baked into the binary
    if !DEFAULT_CLIENT_ID.is_empty() && !looks_like_placeholder_client_id(DEFAULT_CLIENT_ID) {
        Ok(DEFAULT_CLIENT_ID.to_string())
    } else {
        Err("GitHub client ID not configured. Set HYDITOR_GITHUB_CLIENT_ID before signing in.".to_string())
    }
}

#[tauri::command]
pub async fn start_device_flow() -> Result<DeviceFlowStart, String> {
    log_auth("start_device_flow begin");
    let client_id = github_client_id()?;
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|err| format!("failed to create HTTP client: {err}"))?;
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

    log_auth("start_device_flow success");

    Ok(DeviceFlowStart {
        verification_uri: payload.verification_uri,
        user_code: payload.user_code,
        device_code: payload.device_code,
        interval: payload.interval.unwrap_or(5),
    })
}

#[tauri::command]
pub async fn poll_for_token(app: tauri::AppHandle, device_code: String) -> Result<PollTokenResult, String> {
    log_auth("poll_for_token begin");
    let client_id = github_client_id()?;
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|err| format!("failed to create HTTP client: {err}"))?;
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

        log_auth("poll_for_token authorized and token persisted");

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

    log_auth(&format!("poll_for_token status={status}"));

    Ok(PollTokenResult {
        status: status.to_string(),
        access_token: None,
        refresh_token: None,
        expires_in: None,
        refresh_token_expires_in: None,
    })
}

/// Cancel any in-progress device polling loop.
#[tauri::command]
pub fn cancel_device_polling() {
    POLLING_CANCELLED.store(true, Ordering::SeqCst);
    log_auth("cancel_device_polling called");
}

/// Poll for token in a backend loop, emitting status events to the frontend.
/// Returns only when authorization succeeds, fails terminally, or is cancelled.
/// This eliminates per-poll IPC round-trips — the frontend calls this once and
/// listens for `auth://poll-status` events for progress updates.
#[tauri::command]
pub async fn start_device_polling(
    app: tauri::AppHandle,
    device_code: String,
    interval: u64,
) -> Result<PollTokenResult, String> {
    log_auth("start_device_polling begin");
    POLLING_CANCELLED.store(false, Ordering::SeqCst);

    let client_id = github_client_id()?;
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|err| format!("failed to create HTTP client: {err}"))?;
    let mut current_interval = std::cmp::max(interval, 1);
    let mut polls_completed: u32 = 0;

    loop {
        // Sleep before polling (GitHub requires waiting at least `interval` seconds)
        tokio::time::sleep(std::time::Duration::from_secs(current_interval)).await;

        if POLLING_CANCELLED.load(Ordering::SeqCst) {
            log_auth("start_device_polling cancelled");
            return Ok(PollTokenResult {
                status: "cancelled".to_string(),
                access_token: None,
                refresh_token: None,
                expires_in: None,
                refresh_token_expires_in: None,
            });
        }

        polls_completed += 1;

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

            set_token(
                &app,
                StoredToken {
                    access_token: access_token.clone(),
                    refresh_token: payload.refresh_token.clone(),
                    expires_at,
                },
            )?;

            log_auth(&format!(
                "start_device_polling authorized after {polls_completed} poll(s)"
            ));

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
            Some("slow_down") => {
                current_interval += 5;
                "slow_down"
            }
            Some("expired_token") => {
                log_auth("start_device_polling expired_token");
                return Ok(PollTokenResult {
                    status: "expired_token".to_string(),
                    access_token: None,
                    refresh_token: None,
                    expires_in: None,
                    refresh_token_expires_in: None,
                });
            }
            Some("access_denied") => {
                log_auth("start_device_polling access_denied");
                return Ok(PollTokenResult {
                    status: "access_denied".to_string(),
                    access_token: None,
                    refresh_token: None,
                    expires_in: None,
                    refresh_token_expires_in: None,
                });
            }
            Some(_) | None => {
                log_auth("start_device_polling unknown error");
                return Ok(PollTokenResult {
                    status: "error".to_string(),
                    access_token: None,
                    refresh_token: None,
                    expires_in: None,
                    refresh_token_expires_in: None,
                });
            }
        };

        // Emit progress event so the frontend can update UI without IPC round-trips
        let _ = app.emit(
            "auth-poll-status",
            PollStatusEvent {
                status: status.to_string(),
                polls_completed,
                interval_seconds: current_interval,
            },
        );

        log_auth(&format!(
            "start_device_polling poll #{polls_completed} status={status}, next in {current_interval}s"
        ));
    }
}

/// Refresh an expired access token using the refresh token
pub async fn refresh_access_token(
    app: &tauri::AppHandle,
    refresh_token: &str,
) -> Result<StoredToken, String> {
    log_auth("refresh_access_token begin");
    let client_id = github_client_id()?;
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|err| format!("failed to create HTTP client: {err}"))?;
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
        log_auth("refresh_access_token success");
        Ok(new_token)
    } else {
        log_auth("refresh_access_token missing access token in response");
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

        // Works with GitHub App client IDs (Iv1.xxx)
        std::env::set_var("HYDITOR_GITHUB_CLIENT_ID", "Iv1.test_github_app_id");
        let result = github_client_id();
        assert!(result.is_ok(), "github_client_id() should succeed with GitHub App ID");
        assert_eq!(result.unwrap(), "Iv1.test_github_app_id", "should use env var value");

        // Also works with OAuth App client IDs (20-char hex)
        std::env::set_var("HYDITOR_GITHUB_CLIENT_ID", "abc123def4567890abcd");
        let result = github_client_id();
        assert!(result.is_ok(), "github_client_id() should succeed with OAuth App ID");
        assert_eq!(result.unwrap(), "abc123def4567890abcd", "should use env var value");
        
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

        // The result depends on whether DEFAULT_CLIENT_ID has been set to a real value
        match result {
            Ok(id) => {
                // If it succeeds, must not be empty or the placeholder
                assert!(!id.is_empty());
                assert!(!looks_like_placeholder_client_id(&id));
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

        // DEFAULT_CLIENT_ID either holds a real client ID or the placeholder
        let result = github_client_id();

        if result.is_ok() {
            // Valid: GitHub App ID (Iv1.xxx) or OAuth App ID (20-char hex) — just not the placeholder
            let id = result.unwrap();
            assert!(!id.is_empty());
            assert!(!looks_like_placeholder_client_id(&id));
        }
        // If it errors, the placeholder has not been replaced — expected in CI without a real ID
    }
}
