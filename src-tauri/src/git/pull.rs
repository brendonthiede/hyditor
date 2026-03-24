use crate::auth::token_store::{auth_expired_error, clear_stored_token, get_access_token};
use git2::{AnnotatedCommit, Cred, ErrorCode, FetchOptions, RemoteCallbacks, Repository};

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

/// Fetch from origin and fast-forward merge the current branch.
/// Returns a human-readable summary of what happened.
#[tauri::command]
pub async fn git_pull(app: tauri::AppHandle, repo_path: String) -> Result<String, String> {
    let token = get_access_token(&app).await?;

    let repo =
        Repository::open(&repo_path).map_err(|e| format!("failed to open repo: {e}"))?;

    let head = repo
        .head()
        .map_err(|e| format!("failed to resolve HEAD: {e}"))?;
    let branch_name = head
        .shorthand()
        .ok_or_else(|| "failed to determine current branch".to_string())?
        .to_string();

    // Fetch from origin
    let mut callbacks = RemoteCallbacks::new();
    callbacks.credentials(move |_url, username_from_url, _allowed_types| {
        let username = username_from_url.unwrap_or("x-access-token");
        Cred::userpass_plaintext(username, &token)
    });

    let mut fetch_options = FetchOptions::new();
    fetch_options.remote_callbacks(callbacks);

    let mut remote = repo
        .find_remote("origin")
        .map_err(|e| format!("failed to find origin remote: {e}"))?;

    remote
        .fetch(&[&branch_name], Some(&mut fetch_options), None)
        .map_err(|error| {
            if is_git_auth_failure(&error) {
                let _ = clear_stored_token(&app);
                return auth_expired_error(
                    "GitHub session expired while fetching. Sign in again.",
                );
            }
            format!("fetch failed: {error}")
        })?;

    // Find the fetched commit
    let fetch_head = repo
        .find_reference(&format!("refs/remotes/origin/{branch_name}"))
        .map_err(|e| format!("failed to find remote tracking branch: {e}"))?;

    let fetch_commit: AnnotatedCommit<'_> = repo
        .reference_to_annotated_commit(&fetch_head)
        .map_err(|e| format!("failed to resolve fetched commit: {e}"))?;

    // Determine merge analysis
    let (analysis, _preference) = repo
        .merge_analysis(&[&fetch_commit])
        .map_err(|e| format!("merge analysis failed: {e}"))?;

    if analysis.is_up_to_date() {
        return Ok("Already up to date.".to_string());
    }

    if analysis.is_fast_forward() {
        // Fast-forward: move the branch ref and checkout
        let target_oid = fetch_commit.id();
        let refname = format!("refs/heads/{branch_name}");
        let mut reference = repo
            .find_reference(&refname)
            .map_err(|e| format!("failed to find branch ref: {e}"))?;
        reference
            .set_target(target_oid, "hyditor: fast-forward pull")
            .map_err(|e| format!("failed to update branch ref: {e}"))?;
        repo.set_head(&refname)
            .map_err(|e| format!("failed to set HEAD: {e}"))?;
        repo.checkout_head(Some(
            git2::build::CheckoutBuilder::new().force(),
        ))
        .map_err(|e| format!("failed to checkout after pull: {e}"))?;

        return Ok("Pulled latest changes.".to_string());
    }

    // Non-fast-forward: we don't attempt a real merge to avoid conflicts
    Err(
        "Pull requires a merge (the local and remote branches have diverged). \
         Please use a full Git client to resolve this."
            .to_string(),
    )
}
