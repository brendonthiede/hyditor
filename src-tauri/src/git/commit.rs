use git2::{IndexAddOption, Repository, Signature};

#[tauri::command]
pub fn git_commit(repo_path: String, message: String, files: Vec<String>) -> Result<String, String> {
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

    let tree_id = index.write_tree().map_err(|e| format!("write tree failed: {e}"))?;
    let tree = repo.find_tree(tree_id).map_err(|e| format!("find tree failed: {e}"))?;

    let signature = Signature::now("Hyditor", "noreply@hyditor.local")
        .map_err(|e| format!("signature failed: {e}"))?;

    let head = repo.head().ok().and_then(|h| h.target());
    let commit_id = if let Some(head_id) = head {
        let parent = repo
            .find_commit(head_id)
            .map_err(|e| format!("find parent commit failed: {e}"))?;
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
        repo.commit(Some("HEAD"), &signature, &signature, &message, &tree, &[])
            .map_err(|e| format!("initial commit failed: {e}"))?
    };

    Ok(commit_id.to_string())
}
