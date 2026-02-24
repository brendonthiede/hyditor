use base64::Engine;
use keyring::Entry;
use rand::rngs::OsRng;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use tauri::Manager;
use tauri_plugin_stronghold::stronghold::Stronghold;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredToken {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: Option<i64>,
}

const STRONGHOLD_SNAPSHOT: &str = "auth.stronghold";
const LEGACY_STRONGHOLD_KEY: &str = "stronghold.key";
const STRONGHOLD_CLIENT: &str = "hyditor-auth";
const STRONGHOLD_TOKEN_KEY: &str = "github_token";
const KEYCHAIN_SERVICE: &str = "io.github.brendonthiede.hyditor";
const KEYCHAIN_ACCOUNT: &str = "stronghold-master-key";
const STRONGHOLD_KEY_DERIVATION_CONTEXT: &[u8] = b"hyditor-stronghold-v1";
pub const AUTH_EXPIRED_PREFIX: &str = "AUTH_EXPIRED:";

static KEY_MATERIAL_CACHE: OnceLock<Vec<u8>> = OnceLock::new();

pub fn auth_expired_error(message: &str) -> String {
    format!("{AUTH_EXPIRED_PREFIX} {message}")
}

struct VaultPaths {
    snapshot_path: PathBuf,
    legacy_key_path: PathBuf,
}

fn resolve_vault_paths(base_dir: &Path) -> VaultPaths {
    VaultPaths {
        snapshot_path: base_dir.join(STRONGHOLD_SNAPSHOT),
        legacy_key_path: base_dir.join(LEGACY_STRONGHOLD_KEY),
    }
}

fn app_vault_paths(app: &AppHandle) -> Result<VaultPaths, String> {
    let base_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|err| format!("failed to resolve app data dir: {err}"))?;
    fs::create_dir_all(&base_dir)
        .map_err(|err| format!("failed to create app data dir: {err}"))?;
    Ok(resolve_vault_paths(&base_dir))
}

fn keychain_entry() -> Result<Entry, String> {
    Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
        .map_err(|err| format!("failed to initialize keychain entry: {err}"))
}

fn decode_key_material(encoded: &str) -> Result<Vec<u8>, String> {
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|err| format!("failed to decode keychain material: {err}"))?;

    if decoded.is_empty() {
        return Err("decoded keychain material is empty".to_string());
    }

    Ok(decoded)
}

fn load_legacy_key(path: &Path) -> Result<Option<Vec<u8>>, String> {
    if !path.exists() {
        return Ok(None);
    }

    let key = fs::read(path).map_err(|err| format!("failed to read legacy stronghold key: {err}"))?;
    if key.is_empty() {
        return Err("legacy stronghold key is empty".to_string());
    }

    Ok(Some(key))
}

fn derive_stronghold_key(material: &[u8]) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(material);
    hasher.update(STRONGHOLD_KEY_DERIVATION_CONTEXT);
    hasher.finalize().to_vec()
}

fn load_or_create_key_material(paths: &VaultPaths) -> Result<Vec<u8>, String> {
    if let Some(existing) = KEY_MATERIAL_CACHE.get() {
        return Ok(existing.clone());
    }

    let entry = keychain_entry()?;

    match entry.get_password() {
        Ok(existing) => {
            let material = decode_key_material(&existing)?;
            let _ = KEY_MATERIAL_CACHE.set(material.clone());
            Ok(material)
        }
        Err(keyring::Error::NoEntry) => {
            let material = match load_legacy_key(&paths.legacy_key_path)? {
                Some(legacy_key) => legacy_key,
                None => {
                    let mut random = vec![0u8; 32];
                    OsRng.fill_bytes(&mut random);
                    random
                }
            };

            let encoded = base64::engine::general_purpose::STANDARD.encode(&material);
            entry
                .set_password(&encoded)
                .map_err(|err| format!("failed to persist key material in keychain: {err}"))?;

            if paths.legacy_key_path.exists() {
                let _ = fs::remove_file(&paths.legacy_key_path);
            }

            let _ = KEY_MATERIAL_CACHE.set(material.clone());
            Ok(material)
        }
        Err(err) => Err(format!("failed to read key material from keychain: {err}")),
    }
}

fn open_stronghold(paths: &VaultPaths) -> Result<Stronghold, String> {
    let key_material = load_or_create_key_material(paths)?;
    let key = derive_stronghold_key(&key_material);

    match Stronghold::new(&paths.snapshot_path, key.clone()) {
        Ok(stronghold) => Ok(stronghold),
        Err(err) => {
            let error_message = err.to_string();
            if should_reset_snapshot(&error_message) {
                // Try to remove the corrupted file if it exists
                if paths.snapshot_path.exists() {
                    if let Err(remove_err) = fs::remove_file(&paths.snapshot_path) {
                        eprintln!("[Stronghold] Warning: failed to remove corrupted snapshot: {remove_err}");
                    }
                }
                // Retry with fresh snapshot
                eprintln!("[Stronghold] Recovering from corruption, retrying with fresh snapshot");
                return Stronghold::new(&paths.snapshot_path, key)
                    .map_err(|retry_err| format!("failed to open stronghold snapshot after reset: {retry_err}"));
            }

            Err(format!("failed to open stronghold snapshot: {error_message}"))
        }
    }
}

fn should_reset_snapshot(error_message: &str) -> bool {
    let lowered = error_message.to_ascii_lowercase();
    lowered.contains("decode/decrypt")
        || lowered.contains("badfilekey")
        || lowered.contains("invalid file")
        || lowered.contains("invalid snapshot")
}

fn load_client(stronghold: &Stronghold) -> Result<iota_stronghold::Client, String> {
    if let Ok(client) = stronghold.get_client(STRONGHOLD_CLIENT) {
        return Ok(client);
    }

    if stronghold.load_client(STRONGHOLD_CLIENT).is_ok() {
        return stronghold
            .get_client(STRONGHOLD_CLIENT)
            .map_err(|err| format!("failed to load stronghold client: {err}"));
    }

    stronghold
        .create_client(STRONGHOLD_CLIENT)
        .map_err(|err| format!("failed to create stronghold client: {err}"))
}

fn get_stored_token_with_paths(paths: &VaultPaths) -> Result<Option<StoredToken>, String> {
    let stronghold = open_stronghold(paths)?;
    let client = load_client(&stronghold)?;
    let stored = client
        .store()
        .get(STRONGHOLD_TOKEN_KEY.as_bytes())
        .map_err(|err| format!("failed to read token from stronghold: {err}"))?;

    match stored {
        Some(bytes) => serde_json::from_slice::<StoredToken>(&bytes)
            .map(Some)
            .map_err(|err| format!("failed to decode token: {err}")),
        None => Ok(None),
    }
}

fn set_token_with_paths(paths: &VaultPaths, token: StoredToken) -> Result<(), String> {
    let stronghold = open_stronghold(paths)?;
    let client = load_client(&stronghold)?;
    let data = serde_json::to_vec(&token)
        .map_err(|err| format!("failed to encode token: {err}"))?;

    client
        .store()
        .insert(STRONGHOLD_TOKEN_KEY.as_bytes().to_vec(), data, None)
        .map_err(|err| format!("failed to write token to stronghold: {err}"))?;

    stronghold
        .save()
        .map_err(|err| format!("failed to persist stronghold snapshot: {err}"))?;
    Ok(())
}

fn sign_out_with_paths(paths: &VaultPaths) -> Result<(), String> {
    let stronghold = open_stronghold(paths)?;
    let client = load_client(&stronghold)?;
    let _ = client
        .store()
        .delete(STRONGHOLD_TOKEN_KEY.as_bytes())
        .map_err(|err| format!("failed to delete token from stronghold: {err}"))?;
    stronghold
        .save()
        .map_err(|err| format!("failed to persist stronghold snapshot: {err}"))?;
    Ok(())
}

pub fn get_stored_token(app: &AppHandle) -> Result<Option<StoredToken>, String> {
    let paths = app_vault_paths(app)?;
    get_stored_token_with_paths(&paths)
}

pub fn set_token(app: &AppHandle, token: StoredToken) -> Result<(), String> {
    let paths = app_vault_paths(app)?;
    set_token_with_paths(&paths, token)
}

pub fn clear_stored_token(app: &AppHandle) -> Result<(), String> {
    let paths = app_vault_paths(app)?;
    sign_out_with_paths(&paths)
}

pub async fn get_access_token(app: &AppHandle) -> Result<String, String> {
    let Some(stored) = get_stored_token(app)? else {
        return Err("Not authenticated. Sign in with GitHub first.".to_string());
    };

    if let Some(expires_at) = stored.expires_at {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| "failed to get current time".to_string())?
            .as_secs() as i64;

        if expires_at - now < 60 {
            if let Some(refresh_token) = stored.refresh_token.clone() {
                match crate::auth::device_flow::refresh_access_token(app, &refresh_token).await {
                    Ok(new_token) => return Ok(new_token.access_token),
                    Err(_) => {
                        clear_stored_token(app)?;
                        return Err(auth_expired_error(
                            "Authentication expired. Local session was signed out. Sign in again.",
                        ));
                    }
                }
            }

            clear_stored_token(app)?;
            return Err(auth_expired_error(
                "Authentication expired. Local session was signed out. Sign in again.",
            ));
        }
    }

    Ok(stored.access_token)
}

#[tauri::command]
pub async fn get_token(app: AppHandle) -> Result<Option<String>, String> {
    if get_stored_token(&app)?.is_none() {
        return Ok(None);
    }

    get_access_token(&app).await.map(Some)
}

#[tauri::command]
pub fn sign_out(app: AppHandle) -> Result<(), String> {
    let paths = app_vault_paths(&app)?;
    sign_out_with_paths(&paths)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn temp_paths() -> (TempDir, VaultPaths) {
        let dir = TempDir::new().expect("temp dir should be created");
        let paths = resolve_vault_paths(dir.path());
        (dir, paths)
    }

    #[test]
    fn stored_token_serialization_works() {
        let token = StoredToken {
            access_token: "test_access_token".to_string(),
            refresh_token: Some("test_refresh_token".to_string()),
            expires_at: Some(9999999999),
        };

        // Verify serialization and deserialization works
        let encoded = serde_json::to_vec(&token).expect("encode should work");
        let decoded: StoredToken =
            serde_json::from_slice(&encoded).expect("decode should work");

        assert_eq!(decoded.access_token, "test_access_token");
        assert_eq!(decoded.refresh_token, Some("test_refresh_token".to_string()));
        assert_eq!(decoded.expires_at, Some(9999999999));
    }

    #[test]
    fn derive_stronghold_key_is_stable() {
        let material = vec![7u8; 32];
        let first = derive_stronghold_key(&material);
        let second = derive_stronghold_key(&material);

        assert_eq!(first, second, "derived key should be deterministic");
        assert_eq!(first.len(), 32, "derived key should be 32 bytes");
    }

    #[test]
    fn auth_expired_error_has_expected_prefix() {
        let message = auth_expired_error("GitHub session expired while loading repositories. Sign in again.");
        assert!(message.starts_with(AUTH_EXPIRED_PREFIX));
        assert!(message.contains("loading repositories"));
    }

    #[test]
    fn snapshot_reset_detection_matches_decode_errors() {
        assert!(should_reset_snapshot("invalid file failed to decode/decrypt age content BadFileKey"));
        assert!(should_reset_snapshot("invalid snapshot format"));
        assert!(!should_reset_snapshot("permission denied"));
    }

    #[test]
    fn vault_paths_are_correct() {
        let (_dir, paths) = temp_paths();
        assert!(paths.snapshot_path.to_string_lossy().ends_with("auth.stronghold"));
        assert!(paths.legacy_key_path.to_string_lossy().ends_with("stronghold.key"));
    }

    #[test]
    #[ignore = "integration test - requires Stronghold initialization"]
    fn set_and_get_stored_token_works() {
        let (_dir, paths) = temp_paths();
        sign_out_with_paths(&paths).expect("cleanup should work");
        
        let token = StoredToken {
            access_token: "test_access_token".to_string(),
            refresh_token: Some("test_refresh_token".to_string()),
            expires_at: Some(9999999999),
        };

        set_token_with_paths(&paths, token.clone()).expect("set should succeed");
        let retrieved = get_stored_token_with_paths(&paths).expect("get should succeed");

        assert!(retrieved.is_some());
        let stored = retrieved.unwrap();
        assert_eq!(stored.access_token, "test_access_token");
        assert_eq!(stored.refresh_token, Some("test_refresh_token".to_string()));
        assert_eq!(stored.expires_at, Some(9999999999));
    }

    #[test]
    #[ignore = "integration test - requires Stronghold initialization"]
    fn sign_out_clears_token() {
        let (_dir, paths) = temp_paths();
        let token = StoredToken {
            access_token: "temp_token".to_string(),
            refresh_token: None,
            expires_at: None,
        };
        set_token_with_paths(&paths, token).expect("set should succeed");

        sign_out_with_paths(&paths).expect("sign out should succeed");

        let result = get_stored_token_with_paths(&paths).expect("get should succeed");
        assert!(result.is_none());
    }

    #[test]
    #[ignore = "integration test - requires Stronghold initialization"]
    fn get_stored_token_returns_none_when_empty() {
        let (_dir, paths) = temp_paths();
        sign_out_with_paths(&paths).expect("cleanup should work");
        let result = get_stored_token_with_paths(&paths).expect("get should succeed");
        assert!(result.is_none());
    }

    #[tokio::test]
    #[ignore = "integration test - requires Stronghold initialization"]
    async fn get_token_returns_valid_unexpired_token() {
        let (_dir, paths) = temp_paths();
        sign_out_with_paths(&paths).expect("cleanup should work");
        
        let future_time = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64
            + 3600; // 1 hour from now

        let token = StoredToken {
            access_token: "valid_token".to_string(),
            refresh_token: None,
            expires_at: Some(future_time),
        };
        set_token_with_paths(&paths, token).expect("set should succeed");

        let result = get_stored_token_with_paths(&paths)
            .expect("get_stored_token should succeed")
            .map(|stored| stored.access_token);
        assert_eq!(result, Some("valid_token".to_string()));
    }

    #[tokio::test]
    #[ignore = "integration test - requires Stronghold initialization"]
    async fn get_token_returns_none_when_no_token_stored() {
        let (_dir, paths) = temp_paths();
        sign_out_with_paths(&paths).expect("cleanup should work");
        
        let stored = get_stored_token_with_paths(&paths).expect("get_stored_token should work");
        assert!(stored.is_none());
    }
}
