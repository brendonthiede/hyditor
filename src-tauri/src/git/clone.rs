use crate::auth::token_store::get_access_token;
use git2::{build::RepoBuilder, Cred, FetchOptions, RemoteCallbacks, Repository};
use std::path::{Path, PathBuf};

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

#[tauri::command]
pub async fn clone_repo(
    app: tauri::AppHandle,
    owner: String,
    name: String,
    path: Option<String>,
) -> Result<String, String> {
    let token = get_access_token(&app).await?;
    let repo_url = format!("https://github.com/{owner}/{name}.git");
    let base = resolve_clone_base(path)?;
    let target = Path::new(&base).join(owner).join(name);

    if target.exists() {
        Repository::open(&target)
            .map_err(|e| format!("clone target exists but is not a git repo: {e}"))?;
        return Ok(target.to_string_lossy().to_string());
    }

    std::fs::create_dir_all(target.parent().ok_or_else(|| "invalid clone target".to_string())?)
        .map_err(|e| format!("failed to create clone dir: {e}"))?;

    let mut callbacks = RemoteCallbacks::new();
    callbacks.credentials(move |_url, username_from_url, _allowed_types| {
        let username = username_from_url.unwrap_or("x-access-token");
        Cred::userpass_plaintext(username, &token)
    });

    let mut fetch_options = FetchOptions::new();
    fetch_options.remote_callbacks(callbacks);
    fetch_options.depth(1);

    let mut builder = RepoBuilder::new();
    builder.fetch_options(fetch_options);

    builder
        .clone(&repo_url, &target)
        .map_err(|e| format!("clone failed: {e}"))?;

    Ok(target.to_string_lossy().to_string())
}
