use crate::git::commit::{git_commit, git_stage};
use crate::git::push::git_push;

/// Publish changed files in one atomic operation: stage → commit → push.
///
/// If staging or commit fails, the operation stops and the error is returned.
/// If push fails after a successful commit, the error message includes the
/// commit hash so the user knows their changes are committed locally.
#[tauri::command]
pub async fn git_publish(
    app: tauri::AppHandle,
    repo_path: String,
    files: Vec<String>,
    message: String,
) -> Result<String, String> {
    // Step 1: Stage the specified files
    git_stage(repo_path.clone(), files)?;

    // Step 2: Commit
    let commit_id = git_commit(repo_path.clone(), message)?;

    // Step 3: Push
    git_push(app, repo_path).await.map_err(|e| {
        format!(
            "Changes committed ({}) but push failed: {}",
            &commit_id[..7.min(commit_id.len())],
            e
        )
    })?;

    Ok(commit_id)
}
