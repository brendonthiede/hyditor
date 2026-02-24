use crate::auth::token_store::{auth_expired_error, clear_stored_token, get_access_token};
use git2::{build::RepoBuilder, Cred, ErrorCode, FetchOptions, RemoteCallbacks, Repository};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::Emitter;
use tokio::time::timeout;

fn log_clone(message: &str) {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    eprintln!("[Clone][{ts}] {message}");
}

fn default_clone_base() -> Result<PathBuf, String> {
    let cache_dir = dirs::cache_dir().ok_or_else(|| "failed to resolve cache directory".to_string())?;
    Ok(cache_dir.join("hyditor").join("repos"))
}

fn resolve_clone_base(path: Option<String>) -> Result<PathBuf, String> {
    match path {
        Some(value) if !value.trim().is_empty() => Ok(PathBuf::from(value)),
        _ => default_clone_base(),
    }
}

fn is_git_auth_failure(error: &git2::Error) -> bool {
    if error.code() == ErrorCode::Auth {
        return true;
    }

    let message = error.message().to_ascii_lowercase();
    message.contains("authentication")
        || message.contains("credentials")
        || message.contains("unauthorized")
        || message.contains("http 401")
}

#[derive(Debug, Serialize, Clone)]
struct CloneProgress {
    owner: String,
    name: String,
    received_objects: usize,
    total_objects: usize,
    indexed_objects: usize,
    received_bytes: usize,
    percent: f64,
}

#[tauri::command]
pub async fn clone_repo(
    app: tauri::AppHandle,
    owner: String,
    name: String,
    path: Option<String>,
) -> Result<String, String> {
    log_clone(&format!("start owner={owner} repo={name}"));
    let token = get_access_token(&app).await?;
    let repo_url = format!("https://github.com/{owner}/{name}.git");
    let base = resolve_clone_base(path)?;
    let target = Path::new(&base).join(&owner).join(&name);

    if target.exists() {
        log_clone(&format!("target already exists path={}", target.to_string_lossy()));
        Repository::open(&target)
            .map_err(|e| format!("clone target exists but is not a git repo: {e}"))?;
        return Ok(target.to_string_lossy().to_string());
    }

    std::fs::create_dir_all(target.parent().ok_or_else(|| "invalid clone target".to_string())?)
        .map_err(|e| format!("failed to create clone dir: {e}"))?;

    let app_handle = app.clone();
    let repo_url_clone = repo_url.clone();
    let target_clone = target.clone();
    let token_clone = token.clone();
    let owner_clone = owner.clone();
    let name_clone = name.clone();

    let clone_task = tauri::async_runtime::spawn_blocking(move || {
        let timeout_hit = Arc::new(AtomicBool::new(false));
        let clone_deadline = Instant::now();
        let last_emit = Arc::new(Mutex::new(Instant::now()));
        let last_progress = Arc::new(Mutex::new(Instant::now()));

        let mut callbacks = RemoteCallbacks::new();
        callbacks.credentials(move |_url, username_from_url, _allowed_types| {
            let username = username_from_url.unwrap_or("x-access-token");
            Cred::userpass_plaintext(username, &token_clone)
        });

        let timeout_flag = Arc::clone(&timeout_hit);
        let emit_handle = app_handle.clone();
        let emit_owner = owner_clone.clone();
        let emit_name = name_clone.clone();
        let emit_last = Arc::clone(&last_emit);
        let progress_last = Arc::clone(&last_progress);
        
        callbacks.transfer_progress(move |_stats| {
            let now = Instant::now();
            let elapsed = clone_deadline.elapsed();
            
            // Check hard 5-minute limit
            if elapsed > Duration::from_secs(300) {
                log_clone(&format!("timeout hit after {:?}", elapsed));
                timeout_flag.store(true, Ordering::Relaxed);
                return false;
            }
            
            // Check for stalled progress (no transfer callback in 30 seconds)
            if let Ok(mut last) = progress_last.lock() {
                if now.duration_since(*last) > Duration::from_secs(30) {
                    log_clone(&format!("no progress for 30s, aborting (elapsed: {:?})", elapsed));
                    timeout_flag.store(true, Ordering::Relaxed);
                    return false;
                }
                *last = now;
            }
            
            // Emit progress every 500ms
            if let Ok(mut last) = emit_last.lock() {
                if now.duration_since(*last) >= Duration::from_millis(500) {
                    let total = _stats.total_objects();
                    let received = _stats.received_objects();
                    let percent = if total > 0 {
                        (received as f64 / total as f64) * 100.0
                    } else {
                        0.0
                    };

                    let payload = CloneProgress {
                        owner: emit_owner.clone(),
                        name: emit_name.clone(),
                        received_objects: received,
                        total_objects: total,
                        indexed_objects: _stats.indexed_objects(),
                        received_bytes: _stats.received_bytes(),
                        percent,
                    };

                    let _ = emit_handle.emit("clone_progress", payload);
                    *last = now;
                }
            }

            true
        });

        let mut fetch_options = FetchOptions::new();
        fetch_options.remote_callbacks(callbacks);
        fetch_options.depth(1);

        let mut builder = RepoBuilder::new();
        builder.fetch_options(fetch_options);

        let result = builder.clone(&repo_url_clone, &target_clone).map_err(|error| {
            if timeout_hit.load(Ordering::Relaxed) {
                return "clone timed out after 5 minutes. Try again or clone a smaller repo.".to_string();
            }

            if is_git_auth_failure(&error) {
                let _ = clear_stored_token(&app_handle);
                return auth_expired_error("GitHub session expired while cloning. Sign in again.");
            }

            log_clone(&format!("error: {error}"));
            format!("clone failed: {error}")
        });
        
        if let Err(ref e) = result {
            log_clone(&format!("failed after {:?}: {e}", clone_deadline.elapsed()));
        } else {
            log_clone(&format!("completed in {:?}", clone_deadline.elapsed()));
        }
        
        result
    });

    match timeout(Duration::from_secs(300), clone_task).await {
        Ok(join_result) => {
            join_result
                .map_err(|_| "clone task crashed".to_string())??;
        }
        Err(_) => {
            let _ = std::fs::remove_dir_all(&target);
            log_clone("tokio timeout fired after 5 minutes");
            return Err("clone timed out after 5 minutes. Try again or clone a smaller repo.".to_string());
        }
    }

    Ok(target.to_string_lossy().to_string())
}
