use git2::{IndexAddOption, Repository, Signature};

#[tauri::command]
pub fn git_stage(repo_path: String, files: Vec<String>) -> Result<(), String> {
    let repo = Repository::open(repo_path).map_err(|e| format!("failed to open repo: {e}"))?;
    let mut index = repo.index().map_err(|e| format!("failed to open index: {e}"))?;

    if files.is_empty() {
        index
            .add_all(["*"].iter(), IndexAddOption::DEFAULT, None)
            .map_err(|e| format!("failed to stage files: {e}"))?;
    } else {
        for file in files {
            index
                .add_path(std::path::Path::new(&file))
                .map_err(|e| format!("failed to stage {file}: {e}"))?;
        }
    }

    index
        .write()
        .map_err(|e| format!("failed to write index: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn git_unstage(repo_path: String, files: Vec<String>) -> Result<(), String> {
    if files.is_empty() {
        return Ok(());
    }

    let repo = Repository::open(repo_path).map_err(|e| format!("failed to open repo: {e}"))?;
    let head_target = repo
        .head()
        .ok()
        .and_then(|head| head.peel(git2::ObjectType::Commit).ok());

    repo.reset_default(head_target.as_ref(), files.iter())
        .map_err(|e| format!("failed to unstage files: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn git_commit(repo_path: String, message: String) -> Result<String, String> {
    if message.trim().is_empty() {
        return Err("commit message cannot be empty".to_string());
    }

    let repo = Repository::open(repo_path).map_err(|e| format!("failed to open repo: {e}"))?;
    let mut index = repo.index().map_err(|e| format!("failed to open index: {e}"))?;
    index
        .write()
        .map_err(|e| format!("failed to write index: {e}"))?;

    let tree_id = index.write_tree().map_err(|e| format!("write tree failed: {e}"))?;
    let tree = repo.find_tree(tree_id).map_err(|e| format!("find tree failed: {e}"))?;

    let signature = Signature::now("Hyditor", "noreply@hyditor.local")
        .map_err(|e| format!("signature failed: {e}"))?;

    let head = repo.head().ok().and_then(|h| h.target());
    let commit_id = if let Some(head_id) = head {
        let parent = repo
            .find_commit(head_id)
            .map_err(|e| format!("find parent commit failed: {e}"))?;
        if parent.tree_id() == tree.id() {
            return Err("nothing staged to commit".to_string());
        }
        repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            &message,
            &tree,
            &[&parent],
        )
        .map_err(|e| format!("commit failed: {e}"))?
    } else {
        if tree.is_empty() {
            return Err("nothing staged to commit".to_string());
        }
        repo.commit(Some("HEAD"), &signature, &signature, &message, &tree, &[])
            .map_err(|e| format!("initial commit failed: {e}"))?
    };

    Ok(commit_id.to_string())
}
