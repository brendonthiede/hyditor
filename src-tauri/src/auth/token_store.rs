use base64::Engine;
use keyring::Entry;
use rand::rngs::OsRng;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use tauri::Manager;
use tauri_plugin_stronghold::stronghold::Stronghold;

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

/// In-memory token cache.  Reading from the Stronghold snapshot is the most
/// expensive operation in the auth path (key derivation + file I/O +
/// decryption).  By caching the `StoredToken` after the first successful read,
/// subsequent calls skip Stronghold entirely.  The cache is invalidated
/// whenever the token is written or deleted so Stronghold is re-read on the
/// next access.
static TOKEN_CACHE: OnceLock<Mutex<Option<StoredToken>>> = OnceLock::new();

fn token_cache() -> &'static Mutex<Option<StoredToken>> {
    TOKEN_CACHE.get_or_init(|| Mutex::new(None))
}

fn get_cached_token() -> Option<StoredToken> {
    token_cache().lock().ok().and_then(|guard| guard.clone())
}

fn set_cached_token(token: &StoredToken) {
    if let Ok(mut guard) = token_cache().lock() {
        *guard = Some(token.clone());
    }
}

fn clear_cached_token() {
    if let Ok(mut guard) = token_cache().lock() {
        *guard = None;
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredToken {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: Option<i64>,
}

const STRONGHOLD_SNAPSHOT: &str = "auth.stronghold";
const LEGACY_STRONGHOLD_KEY: &str = "stronghold.key";
/// Backup key file alongside the snapshot.  Used as a fallback when the OS
/// keychain is unavailable (e.g. locked session, missing secret-service daemon,
/// or a keyring crate backend that silently drops writes).  The file is written
/// with 0600 permissions so only the owning user can read it.  It is created
/// whenever new key material is generated and kept in sync with the keychain.
const BACKUP_KEY_FILE: &str = "auth.key";
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
    backup_key_path: PathBuf,
}

fn resolve_vault_paths(base_dir: &Path) -> VaultPaths {
    VaultPaths {
        snapshot_path: base_dir.join(STRONGHOLD_SNAPSHOT),
        legacy_key_path: base_dir.join(LEGACY_STRONGHOLD_KEY),
        backup_key_path: base_dir.join(BACKUP_KEY_FILE),
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

/// Persist key material to the local backup file with owner-only permissions.
fn save_backup_key(paths: &VaultPaths, material: &[u8]) {
    match fs::write(&paths.backup_key_path, material) {
        Ok(()) => {
            // Restrict to owner read/write only (0600).
            #[cfg(unix)]
            {
                let _ = fs::set_permissions(
                    &paths.backup_key_path,
                    fs::Permissions::from_mode(0o600),
                );
            }
            eprintln!("[Keychain] Saved key material backup file");
        }
        Err(err) => {
            eprintln!("[Keychain] Warning: failed to write backup key file: {err}");
        }
    }
}

/// Load key material from the local backup file.
fn load_backup_key(paths: &VaultPaths) -> Option<Vec<u8>> {
    if !paths.backup_key_path.exists() {
        return None;
    }
    match fs::read(&paths.backup_key_path) {
        Ok(data) if !data.is_empty() => {
            eprintln!("[Keychain] Loaded key material from backup file");
            Some(data)
        }
        _ => None,
    }
}

fn load_or_create_key_material(paths: &VaultPaths) -> Result<Vec<u8>, String> {
    // Fast path: in-memory cache populated after first successful read.
    if let Some(existing) = KEY_MATERIAL_CACHE.get() {
        return Ok(existing.clone());
    }

    let entry = keychain_entry()?;

    // 1. Try the OS keychain (most secure path).
    match entry.get_password() {
        Ok(existing) => {
            let material = decode_key_material(&existing)?;
            eprintln!("[Keychain] Loaded key material from OS keychain");
            let _ = KEY_MATERIAL_CACHE.set(material.clone());
            return Ok(material);
        }
        Err(keyring::Error::NoEntry) => {
            eprintln!("[Keychain] No keychain entry found; trying backup file");
        }
        Err(err) => {
            // The keychain daemon may be locked or unavailable.  Fall through
            // to the backup file rather than surfacing a hard error to the user.
            eprintln!("[Keychain] get_password error ({err}); trying backup file");
        }
    }

    // 2. Fall back to the local backup key file.  This covers the common case
    //    where the OS keychain is present but doesn't surface a persistent entry
    //    across sessions (e.g. GNOME Keyring not unlocked at startup, or the
    //    keyring crate backend silently dropping writes on some distros).
    if let Some(material) = load_backup_key(paths) {
        // Best-effort re-population of the keychain so future reads are faster.
        let encoded = base64::engine::general_purpose::STANDARD.encode(&material);
        match entry.set_password(&encoded) {
            Ok(()) => eprintln!("[Keychain] Restored key material to OS keychain from backup"),
            Err(err) => eprintln!("[Keychain] Could not restore to OS keychain: {err}"),
        }
        let _ = KEY_MATERIAL_CACHE.set(material.clone());
        return Ok(material);
    }

    // 3. Migrate from the legacy raw key file (pre-keychain installs).
    if let Ok(Some(legacy)) = load_legacy_key(&paths.legacy_key_path) {
        eprintln!("[Keychain] Migrating legacy key file to keychain + backup");
        let encoded = base64::engine::general_purpose::STANDARD.encode(&legacy);
        let _ = entry.set_password(&encoded);
        save_backup_key(paths, &legacy);
        let _ = fs::remove_file(&paths.legacy_key_path);
        let _ = KEY_MATERIAL_CACHE.set(legacy.clone());
        return Ok(legacy);
    }

    // 4. No existing key found anywhere — generate fresh key material and
    //    persist it to both the keychain and the backup file.  This is a
    //    one-time cost on first install (or after a full sign-out+key-clear).
    eprintln!("[Keychain] Generating new key material");
    let mut material = vec![0u8; 32];
    OsRng.fill_bytes(&mut material);

    let encoded = base64::engine::general_purpose::STANDARD.encode(&material);
    match entry.set_password(&encoded) {
        Ok(()) => eprintln!("[Keychain] Saved new key material to OS keychain"),
        Err(err) => eprintln!("[Keychain] Warning: could not save to OS keychain ({err}); relying on backup file"),
    }
    // Always write the backup file so subsequent startups can recover the key
    // even when the OS keychain is unavailable.
    save_backup_key(paths, &material);

    let _ = KEY_MATERIAL_CACHE.set(material.clone());
    Ok(material)
}

fn open_stronghold(paths: &VaultPaths) -> Result<Stronghold, String> {
    let key_material = load_or_create_key_material(paths)?;
    let key = derive_stronghold_key(&key_material);

    let t0 = Instant::now();
    let result = match Stronghold::new(&paths.snapshot_path, key.clone()) {
        Ok(stronghold) => Ok(stronghold),
        Err(err) => {
            let error_message = err.to_string();
            if should_reset_snapshot(&error_message) {
                if paths.snapshot_path.exists() {
                    if let Err(remove_err) = fs::remove_file(&paths.snapshot_path) {
                        eprintln!("[Stronghold] Warning: failed to remove corrupted snapshot: {remove_err}");
                    }
                }
                // Don't retry Stronghold::new() here — it would cost another
                // full key-derivation cycle (~23s in debug).  Return an error
                // and let the caller treat it as "no token".
                eprintln!("[Stronghold] Corrupted snapshot removed (took {:.3}s); caller should treat as empty", t0.elapsed().as_secs_f64());
                return Err("stronghold_snapshot_corrupted".to_string());
            }

            Err(format!("failed to open stronghold snapshot: {error_message}"))
        }
    };
    eprintln!("[Stronghold] open() took {:.3}s", t0.elapsed().as_secs_f64());
    result
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
    // Fast path: return the in-memory cached token if available.
    if let Some(cached) = get_cached_token() {
        return Ok(Some(cached));
    }

    // No snapshot file on disk → no token has ever been stored.  Skip the
    // expensive Stronghold::new() call entirely (key-derivation + file I/O).
    if !paths.snapshot_path.exists() {
        eprintln!("[Stronghold] snapshot does not exist, skipping open");
        return Ok(None);
    }

    // Skip obviously-corrupt snapshots (e.g. zero-byte leftover files).
    match fs::metadata(&paths.snapshot_path) {
        Ok(meta) if meta.len() == 0 => {
            eprintln!("[Stronghold] snapshot is empty (0 bytes), removing");
            let _ = fs::remove_file(&paths.snapshot_path);
            return Ok(None);
        }
        Err(_) => {
            eprintln!("[Stronghold] cannot stat snapshot, skipping open");
            return Ok(None);
        }
        _ => {}
    }

    let t0 = Instant::now();
    let stronghold = match open_stronghold(paths) {
        Ok(s) => s,
        Err(ref e) if e == "stronghold_snapshot_corrupted" => {
            // Corrupted snapshot was already removed by open_stronghold.
            // Treat as "no stored token" so UI shows sign-in screen.
            eprintln!("[Stronghold] get_stored_token_with_paths: corrupted snapshot, returning None");
            return Ok(None);
        }
        Err(e) => return Err(e),
    };
    let client = load_client(&stronghold)?;
    let stored = client
        .store()
        .get(STRONGHOLD_TOKEN_KEY.as_bytes())
        .map_err(|err| format!("failed to read token from stronghold: {err}"))?;

    let result = match stored {
        Some(bytes) => serde_json::from_slice::<StoredToken>(&bytes)
            .map(Some)
            .map_err(|err| format!("failed to decode token: {err}"))?,
        None => None,
    };

    // Populate the cache so subsequent reads skip Stronghold entirely.
    if let Some(ref token) = result {
        set_cached_token(token);
    }

    eprintln!(
        "[Stronghold] get_stored_token_with_paths took {:.3}s (cache miss)",
        t0.elapsed().as_secs_f64()
    );
    Ok(result)
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

    // Update the in-memory cache so subsequent reads are instant.
    set_cached_token(&token);
    Ok(())
}

fn sign_out_with_paths(paths: &VaultPaths) -> Result<(), String> {
    // Invalidate the token cache first so no stale token can be returned.
    clear_cached_token();

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
    let t0 = Instant::now();
    let Some(stored) = get_stored_token(app)? else {
        eprintln!("[Stronghold] get_access_token (no token) took {:.3}s", t0.elapsed().as_secs_f64());
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
    let t0 = Instant::now();
    // get_access_token already calls get_stored_token internally, so we call it
    // directly and map its "not authenticated" error to Ok(None) instead of
    // performing the redundant double-open that was here before.
    let result = match get_access_token(&app).await {
        Ok(token) => Ok(Some(token)),
        Err(err) if err == "Not authenticated. Sign in with GitHub first." => Ok(None),
        Err(err) => Err(err),
    };
    eprintln!("[Stronghold] get_token took {:.3}s", t0.elapsed().as_secs_f64());
    result
}

#[tauri::command]
pub fn sign_out(app: AppHandle) -> Result<(), String> {
    let paths = app_vault_paths(&app)?;
    sign_out_with_paths(&paths)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::MutexGuard;
    use tempfile::TempDir;

    /// Mutex that serializes integration tests which share the process-global
    /// `TOKEN_CACHE`.  Without this, parallel test threads race on
    /// `clear_cached_token` / `set_cached_token` and produce sporadic failures.
    static INTEGRATION_LOCK: Mutex<()> = Mutex::new(());

    /// Pre-populate `KEY_MATERIAL_CACHE` with deterministic test bytes so that
    /// no integration test ever reaches the OS keychain.
    fn ensure_test_key_material() {
        let _ = KEY_MATERIAL_CACHE.set(vec![42u8; 32]);
    }

    /// Acquire the integration lock, set up key material, and clear the token
    /// cache.  Returns the lock guard (must be held for the test's lifetime),
    /// a temp dir, and vault paths.
    fn setup_integration() -> (MutexGuard<'static, ()>, TempDir, VaultPaths) {
        let guard = INTEGRATION_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        ensure_test_key_material();
        clear_cached_token();
        let dir = TempDir::new().expect("temp dir should be created");
        let paths = resolve_vault_paths(dir.path());
        (guard, dir, paths)
    }

    fn temp_paths() -> (TempDir, VaultPaths) {
        let dir = TempDir::new().expect("temp dir should be created");
        let paths = resolve_vault_paths(dir.path());
        (dir, paths)
    }

    fn sample_token() -> StoredToken {
        StoredToken {
            access_token: "test_access_token".to_string(),
            refresh_token: Some("test_refresh_token".to_string()),
            expires_at: Some(9999999999),
        }
    }

    // ── Pure / unit tests (no Stronghold, no keychain) ──────────────

    #[test]
    fn stored_token_serialization_works() {
        let token = sample_token();

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
        assert!(paths.backup_key_path.to_string_lossy().ends_with("auth.key"));
    }

    #[test]
    fn token_cache_set_get_clear() {
        let _guard = INTEGRATION_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        clear_cached_token();

        assert!(get_cached_token().is_none(), "cache should start empty");

        let token = sample_token();
        set_cached_token(&token);

        let cached = get_cached_token().expect("cache should return a token");
        assert_eq!(cached.access_token, "test_access_token");

        clear_cached_token();
        assert!(get_cached_token().is_none(), "cache should be empty after clear");
    }

    // ── Integration tests ─────────────────────────────────────────
    //
    // These exercise the full Stronghold encrypt/decrypt path (file I/O
    // + NCKey memory protection).  The Cargo profile override
    // `[profile.dev.package."*"] opt-level = 2` keeps each operation
    // under ~2 s even in debug builds, so the suite runs in CI without
    // needing --ignored.
    //
    // An INTEGRATION_LOCK mutex serializes tests that share the
    // process-global TOKEN_CACHE so they are safe with any
    // --test-threads value.

    #[test]
    fn open_stronghold_creates_fresh_snapshot() {
        let (_guard, _dir, paths) = setup_integration();

        assert!(!paths.snapshot_path.exists(), "snapshot should not exist yet");
        let stronghold = open_stronghold(&paths).expect("open should succeed");
        let _client = load_client(&stronghold).expect("load client should succeed");
        stronghold.save().expect("save should succeed");
        assert!(paths.snapshot_path.exists(), "snapshot should exist after save");
    }

    #[test]
    fn set_and_get_stored_token_works() {
        let (_guard, _dir, paths) = setup_integration();

        let token = sample_token();
        set_token_with_paths(&paths, token.clone()).expect("set should succeed");

        // Clear cache so the next read goes through Stronghold.
        clear_cached_token();

        let retrieved = get_stored_token_with_paths(&paths).expect("get should succeed");
        assert!(retrieved.is_some());
        let stored = retrieved.unwrap();
        assert_eq!(stored.access_token, "test_access_token");
        assert_eq!(stored.refresh_token, Some("test_refresh_token".to_string()));
        assert_eq!(stored.expires_at, Some(9999999999));
    }

    #[test]
    fn sign_out_clears_token() {
        let (_guard, _dir, paths) = setup_integration();

        let token = StoredToken {
            access_token: "temp_token".to_string(),
            refresh_token: None,
            expires_at: None,
        };
        set_token_with_paths(&paths, token).expect("set should succeed");

        sign_out_with_paths(&paths).expect("sign out should succeed");

        let result = get_stored_token_with_paths(&paths).expect("get should succeed");
        assert!(result.is_none(), "token should be cleared after sign out");
    }

    #[test]
    fn get_stored_token_returns_none_when_empty() {
        let (_guard, _dir, paths) = setup_integration();

        let result = get_stored_token_with_paths(&paths).expect("get should succeed");
        assert!(result.is_none());
    }

    #[test]
    fn cached_read_skips_stronghold() {
        let (_guard, _dir, paths) = setup_integration();

        let token = sample_token();
        set_token_with_paths(&paths, token).expect("set should succeed");

        // set_token_with_paths already caches the token.
        let first = get_stored_token_with_paths(&paths)
            .expect("first get should succeed")
            .expect("token should exist");
        assert_eq!(first.access_token, "test_access_token");

        // Delete the snapshot file behind Stronghold's back.
        // A second read must still succeed from the in-memory cache.
        if paths.snapshot_path.exists() {
            fs::remove_file(&paths.snapshot_path).expect("remove snapshot should succeed");
        }

        let second = get_stored_token_with_paths(&paths)
            .expect("cached get should succeed")
            .expect("cached token should exist");
        assert_eq!(second.access_token, first.access_token);
    }

    #[test]
    fn overwrite_token_updates_cache() {
        let (_guard, _dir, paths) = setup_integration();

        let first = StoredToken {
            access_token: "first_token".to_string(),
            refresh_token: None,
            expires_at: None,
        };
        set_token_with_paths(&paths, first).expect("first set should succeed");

        let read1 = get_stored_token_with_paths(&paths)
            .expect("get should succeed")
            .expect("token should exist");
        assert_eq!(read1.access_token, "first_token");

        let second = StoredToken {
            access_token: "second_token".to_string(),
            refresh_token: Some("new_refresh".to_string()),
            expires_at: Some(1234567890),
        };
        set_token_with_paths(&paths, second).expect("second set should succeed");

        let read2 = get_stored_token_with_paths(&paths)
            .expect("get should succeed")
            .expect("token should exist");
        assert_eq!(read2.access_token, "second_token");
        assert_eq!(read2.refresh_token, Some("new_refresh".to_string()));
        assert_eq!(read2.expires_at, Some(1234567890));
    }

    #[test]
    fn sign_out_then_set_round_trip() {
        let (_guard, _dir, paths) = setup_integration();

        let token = sample_token();
        set_token_with_paths(&paths, token).expect("set should succeed");
        sign_out_with_paths(&paths).expect("sign out should succeed");

        let new_token = StoredToken {
            access_token: "new_access".to_string(),
            refresh_token: None,
            expires_at: None,
        };
        set_token_with_paths(&paths, new_token).expect("re-set should succeed");

        clear_cached_token();
        let result = get_stored_token_with_paths(&paths)
            .expect("get should succeed")
            .expect("token should exist");
        assert_eq!(result.access_token, "new_access");
    }

    #[test]
    fn corrupt_snapshot_is_recovered() {
        let (_guard, _dir, paths) = setup_integration();

        let token = sample_token();
        set_token_with_paths(&paths, token).expect("set should succeed");
        clear_cached_token();

        // Corrupt the snapshot file.
        fs::write(&paths.snapshot_path, b"this is not a valid stronghold snapshot")
            .expect("writing corrupt data should succeed");

        // open_stronghold detects corruption, removes the file, and returns
        // a sentinel error (avoids a second expensive key-derivation cycle).
        let result = open_stronghold(&paths);
        assert!(result.is_err(), "open should return sentinel error for corruption");
        assert_eq!(
            result.err().unwrap(),
            "stronghold_snapshot_corrupted",
            "error should be the corruption sentinel"
        );
        assert!(!paths.snapshot_path.exists(), "corrupt snapshot should be deleted");

        // get_stored_token_with_paths catches the sentinel and returns None.
        let stored = get_stored_token_with_paths(&paths).expect("get should succeed");
        assert!(stored.is_none(), "token should be gone after corruption recovery");
    }

    #[test]
    fn load_client_creates_client_on_fresh_stronghold() {
        let (_guard, _dir, paths) = setup_integration();

        let stronghold = open_stronghold(&paths).expect("open should succeed");
        let client = load_client(&stronghold);
        assert!(client.is_ok(), "load_client should create a client on a fresh vault");
    }

    #[test]
    fn load_client_reuses_existing_client() {
        let (_guard, _dir, paths) = setup_integration();

        let stronghold = open_stronghold(&paths).expect("open should succeed");

        let _first = load_client(&stronghold).expect("first load should succeed");
        let _second = load_client(&stronghold).expect("second load should succeed");
    }

    #[test]
    fn get_token_returns_valid_unexpired_token() {
        let (_guard, _dir, paths) = setup_integration();

        let future_time = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64
            + 3600;

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

    #[test]
    fn get_token_returns_none_when_no_token_stored() {
        let (_guard, _dir, paths) = setup_integration();

        let stored = get_stored_token_with_paths(&paths).expect("get_stored_token should work");
        assert!(stored.is_none());
    }

    #[test]
    fn token_without_expiry_is_returned() {
        let (_guard, _dir, paths) = setup_integration();

        let token = StoredToken {
            access_token: "no_expiry_token".to_string(),
            refresh_token: None,
            expires_at: None,
        };
        set_token_with_paths(&paths, token).expect("set should succeed");

        clear_cached_token();
        let result = get_stored_token_with_paths(&paths)
            .expect("get should succeed")
            .expect("token should exist");
        assert_eq!(result.access_token, "no_expiry_token");
        assert!(result.expires_at.is_none());
    }

    #[test]
    fn multiple_vaults_are_independent() {
        let _guard = INTEGRATION_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        ensure_test_key_material();
        clear_cached_token();

        let dir_a = TempDir::new().unwrap();
        let paths_a = resolve_vault_paths(dir_a.path());

        let dir_b = TempDir::new().unwrap();
        let paths_b = resolve_vault_paths(dir_b.path());

        let token_a = StoredToken {
            access_token: "token_a".to_string(),
            refresh_token: None,
            expires_at: None,
        };
        set_token_with_paths(&paths_a, token_a).expect("set A should succeed");

        // Clear cache so vault B reads from its own Stronghold.
        clear_cached_token();
        let result_b = get_stored_token_with_paths(&paths_b).expect("get B should succeed");
        assert!(result_b.is_none(), "vault B should be empty");

        // Reading vault A again (after cache clear) should return its token.
        clear_cached_token();
        let result_a = get_stored_token_with_paths(&paths_a)
            .expect("get A should succeed")
            .expect("vault A should have a token");
        assert_eq!(result_a.access_token, "token_a");
    }
}
