use git2::{build::CheckoutBuilder, IndexAddOption, Repository, Signature};
use crate::git::status::is_whitespace_only_diff;

#[tauri::command]
pub fn git_stage(repo_path: String, files: Vec<String>) -> Result<(), String> {
    let repo = Repository::open(&repo_path).map_err(|e| format!("failed to open repo: {e}"))?;

    // Reject any attempts to stage files that only differ in whitespace.
    // The "stage all" path (files.is_empty()) bypasses this check because it
    // is not exposed in the UI and iterating every file would be expensive.
    if !files.is_empty() {
        let ws_only: Vec<&str> = files
            .iter()
            .filter(|f| is_whitespace_only_diff(&repo, f))
            .map(String::as_str)
            .collect();
        if !ws_only.is_empty() {
            return Err(format!(
                "cannot stage whitespace-only changes: {}",
                ws_only.join(", ")
            ));
        }
    }

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

/// Revert (discard) working-tree changes for the given files.
/// For tracked files this checks out the HEAD version; for untracked files it
/// removes them from disk.
#[tauri::command]
pub fn git_revert_files(repo_path: String, files: Vec<String>) -> Result<(), String> {
    if files.is_empty() {
        return Ok(());
    }

    let repo = Repository::open(&repo_path).map_err(|e| format!("failed to open repo: {e}"))?;

    // Separate tracked (modified/deleted) from new files.
    // New files include both unstaged (WT_NEW) and staged (INDEX_NEW).
    let mut tracked: Vec<&str> = Vec::new();
    let mut new_files: Vec<&str> = Vec::new();

    let statuses = {
        let mut opts = git2::StatusOptions::new();
        opts.include_untracked(true)
            .recurse_untracked_dirs(true);
        repo.statuses(Some(&mut opts))
            .map_err(|e| format!("failed to read status: {e}"))?
    };

    let new_file_set: std::collections::HashSet<String> = statuses
        .iter()
        .filter(|entry| {
            let status = entry.status();
            status.is_wt_new() || status.is_index_new()
        })
        .filter_map(|entry| entry.path().map(String::from))
        .collect();

    for file in &files {
        if new_file_set.contains(file.as_str()) {
            new_files.push(file);
        } else {
            tracked.push(file);
        }
    }

    // For tracked files: checkout from HEAD to restore them.
    if !tracked.is_empty() {
        let head = repo.head().map_err(|e| format!("failed to read HEAD: {e}"))?;
        let head_commit = head
            .peel_to_commit()
            .map_err(|e| format!("failed to peel HEAD: {e}"))?;
        let head_tree = head_commit
            .tree()
            .map_err(|e| format!("failed to read HEAD tree: {e}"))?;

        let mut checkout = CheckoutBuilder::new();
        checkout.force();
        for path in &tracked {
            checkout.path(*path);
        }

        repo.checkout_tree(head_tree.as_object(), Some(&mut checkout))
            .map_err(|e| format!("failed to revert files: {e}"))?;

        // Also reset the index for these files so they appear clean.
        let mut index = repo.index().map_err(|e| format!("failed to open index: {e}"))?;
        repo.reset_default(Some(head_commit.as_object()), tracked.iter())
            .map_err(|e| format!("failed to reset index: {e}"))?;
        index.write().map_err(|e| format!("failed to write index: {e}"))?;
    }

    // For new files: remove from index (if present) and delete from disk.
    if !new_files.is_empty() {
        let mut index = repo.index().map_err(|e| format!("failed to open index: {e}"))?;
        for path in &new_files {
            let _ = index.remove_path(std::path::Path::new(path));
        }
        index.write().map_err(|e| format!("failed to write index: {e}"))?;
    }

    for path in &new_files {
        let full_path = std::path::Path::new(&repo_path).join(path);
        if full_path.is_file() {
            std::fs::remove_file(&full_path)
                .map_err(|e| format!("failed to remove {path}: {e}"))?;
        } else if full_path.is_dir() {
            std::fs::remove_dir_all(&full_path)
                .map_err(|e| format!("failed to remove {path}: {e}"))?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn git_commit_rejects_empty_message() {
        let root = tempdir().expect("temp dir should be created");
        let repo = Repository::init(root.path()).expect("repo should be created");
        let result = git_commit(
            repo.path().parent().unwrap().to_string_lossy().to_string(),
            "".to_string(),
        );
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "commit message cannot be empty");
    }

    #[test]
    fn git_commit_rejects_whitespace_only_message() {
        let root = tempdir().expect("temp dir should be created");
        let repo = Repository::init(root.path()).expect("repo should be created");
        let result = git_commit(
            repo.path().parent().unwrap().to_string_lossy().to_string(),
            "   \n\t  ".to_string(),
        );
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "commit message cannot be empty");
    }

    #[test]
    fn git_commit_rejects_nothing_staged() {
        let root = tempdir().expect("temp dir should be created");
        Repository::init(root.path()).expect("repo should be created");
        let result = git_commit(
            root.path().to_string_lossy().to_string(),
            "initial commit".to_string(),
        );
        assert!(result.is_err());
        assert!(
            result.unwrap_err().contains("nothing staged to commit"),
            "should reject when nothing is staged"
        );
    }

    #[test]
    fn git_revert_files_removes_staged_new_file() {
        let root = tempdir().expect("temp dir should be created");
        let repo = Repository::init(root.path()).expect("repo should be created");
        let repo_path = root.path().to_string_lossy().to_string();

        let new_file = root.path().join("new.md");
        fs::write(&new_file, "draft content\n").expect("new file should be written");

        let mut index = repo.index().expect("index should open");
        index
            .add_path(std::path::Path::new("new.md"))
            .expect("staging new file should succeed");
        index.write().expect("index should write");

        git_revert_files(repo_path, vec!["new.md".to_string()])
            .expect("reverting staged new file should succeed");

        assert!(!new_file.exists(), "new file should be removed from disk");

        let mut opts = git2::StatusOptions::new();
        opts.include_untracked(true)
            .recurse_untracked_dirs(true)
            .include_unmodified(false);

        let statuses = repo
            .statuses(Some(&mut opts))
            .expect("status should be readable");
        let has_new_file = statuses
            .iter()
            .any(|entry| entry.path() == Some("new.md"));
        assert!(
            !has_new_file,
            "new file should not remain staged or untracked after revert"
        );
    }

    #[test]
    fn git_revert_files_restores_tracked_modified_file() {
        let root = tempdir().expect("temp dir should be created");
        let repo = Repository::init(root.path()).expect("repo should be created");
        let repo_path = root.path().to_string_lossy().to_string();

        let tracked_file = root.path().join("tracked.md");
        fs::write(&tracked_file, "original\n").expect("tracked file should be written");

        let mut index = repo.index().expect("index should open");
        index
            .add_path(std::path::Path::new("tracked.md"))
            .expect("staging tracked file should succeed");
        index.write().expect("index should write");

        let signature = Signature::now("Hyditor", "noreply@hyditor.local")
            .expect("signature should be created");
        let tree_id = index.write_tree().expect("tree should be written");
        let tree = repo.find_tree(tree_id).expect("tree should be found");
        repo.commit(Some("HEAD"), &signature, &signature, "initial", &tree, &[])
            .expect("initial commit should succeed");

        fs::write(&tracked_file, "modified\n").expect("tracked file should be modified");

        git_revert_files(repo_path, vec!["tracked.md".to_string()])
            .expect("reverting tracked file should succeed");

        let reverted = fs::read_to_string(&tracked_file).expect("tracked file should be readable");
        assert_eq!(
            reverted.trim_end_matches(['\r', '\n']),
            "original",
            "tracked file should be restored to HEAD content"
        );

        let mut opts = git2::StatusOptions::new();
        opts.include_untracked(true)
            .recurse_untracked_dirs(true)
            .include_unmodified(false);
        let statuses = repo
            .statuses(Some(&mut opts))
            .expect("status should be readable");
        assert_eq!(statuses.len(), 0, "repo should be clean after tracked revert");
    }

}
