use crate::auth::token_store::get_access_token;
use git2::{Cred, PushOptions, RemoteCallbacks, Repository};

#[tauri::command]
pub async fn git_push(app: tauri::AppHandle, repo_path: String) -> Result<(), String> {
    let token = get_access_token(&app).await?;
    let repo = Repository::open(repo_path).map_err(|e| format!("failed to open repo: {e}"))?;
    let mut remote = repo
        .find_remote("origin")
        .map_err(|e| format!("failed to find origin remote: {e}"))?;

    let head = repo
        .head()
        .map_err(|e| format!("failed to resolve HEAD: {e}"))?;
    let branch_name = head
        .shorthand()
        .ok_or_else(|| "failed to determine current branch".to_string())?
        .to_string();

    let mut callbacks = RemoteCallbacks::new();
    callbacks.credentials(move |_url, username_from_url, _allowed_types| {
        let username = username_from_url.unwrap_or("x-access-token");
        Cred::userpass_plaintext(username, &token)
    });

    let mut push_options = PushOptions::new();
    push_options.remote_callbacks(callbacks);

    let refspec = format!("refs/heads/{branch_name}:refs/heads/{branch_name}");
    remote
        .push(&[&refspec], Some(&mut push_options))
        .map_err(|e| format!("push failed: {e}"))?;

    Ok(())
}
