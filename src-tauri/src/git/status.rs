use git2::{DiffOptions, Repository, StatusOptions};
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct GitStatusEntry {
    pub path: String,
    pub status: String,
    pub staged: bool,
    pub unstaged: bool,
    pub untracked: bool,
    pub whitespace_only: bool,
}

/// Returns true if the only differences between the index and the working tree
/// for `path` are whitespace changes (equivalent to `git diff -w -- <path>`
/// producing no output).
pub(crate) fn is_whitespace_only_diff(repo: &Repository, path: &str) -> bool {
    let mut opts = DiffOptions::new();
    opts.pathspec(path);
    opts.ignore_whitespace(true);
    match repo.diff_index_to_workdir(None, Some(&mut opts)) {
        Ok(diff) => diff.deltas().count() == 0,
        Err(_) => false,
    }
}

fn derive_status_label(flags: git2::Status) -> String {
    if flags.is_wt_new() {
        return "untracked".to_string();
    }
    if flags.is_index_new() {
        return "added".to_string();
    }
    if flags.is_index_deleted() || flags.is_wt_deleted() {
        return "deleted".to_string();
    }
    if flags.is_index_renamed() || flags.is_wt_renamed() {
        return "renamed".to_string();
    }
    if flags.is_index_modified() || flags.is_wt_modified() {
        return "modified".to_string();
    }
    if flags.is_conflicted() {
        return "conflicted".to_string();
    }
    "changed".to_string()
}

#[tauri::command]
pub fn git_status(repo_path: String) -> Result<Vec<GitStatusEntry>, String> {
    let repo = Repository::open(repo_path).map_err(|e| format!("failed to open repo: {e}"))?;
    let mut options = StatusOptions::new();
    options
        .include_untracked(true)
        .include_unmodified(false)
        .recurse_untracked_dirs(true)
        .renames_head_to_index(true)
        .renames_index_to_workdir(true);

    let statuses = repo
        .statuses(Some(&mut options))
        .map_err(|e| format!("failed to read status: {e}"))?;

    let mut result = Vec::new();
    for status in statuses.iter() {
        let flags = status.status();
        let path = status.path().unwrap_or_default().to_string();
        let unstaged = flags.intersects(
            git2::Status::WT_MODIFIED
                | git2::Status::WT_DELETED
                | git2::Status::WT_RENAMED
                | git2::Status::WT_TYPECHANGE,
        );
        // A file is whitespace-only when it has unstaged working-tree
        // modifications that all disappear when whitespace is ignored.
        let whitespace_only = unstaged
            && flags.is_wt_modified()
            && is_whitespace_only_diff(&repo, &path);
        result.push(GitStatusEntry {
            path,
            status: derive_status_label(flags),
            staged: flags.intersects(
                git2::Status::INDEX_NEW
                    | git2::Status::INDEX_MODIFIED
                    | git2::Status::INDEX_DELETED
                    | git2::Status::INDEX_RENAMED
                    | git2::Status::INDEX_TYPECHANGE,
            ),
            unstaged,
            untracked: flags.is_wt_new(),
            whitespace_only,
        });
    }

    Ok(result)
}

#[tauri::command]
pub fn git_diff_file(repo_path: String, file_path: String) -> Result<String, String> {
    let repo = Repository::open(repo_path).map_err(|e| format!("failed to open repo: {e}"))?;
    let mut opts = DiffOptions::new();
    opts.pathspec(file_path);

    let diff = repo
        .diff_index_to_workdir(None, Some(&mut opts))
        .map_err(|e| format!("failed to compute diff: {e}"))?;

    let mut output = String::new();
    diff.print(git2::DiffFormat::Patch, |_delta, _hunk, line| {
        output.push_str(&String::from_utf8_lossy(line.content()));
        true
    })
    .map_err(|e| format!("failed to print diff: {e}"))?;

    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derive_status_label_untracked() {
        assert_eq!(derive_status_label(git2::Status::WT_NEW), "untracked");
    }

    #[test]
    fn derive_status_label_added() {
        assert_eq!(derive_status_label(git2::Status::INDEX_NEW), "added");
    }

    #[test]
    fn derive_status_label_deleted_from_index() {
        assert_eq!(derive_status_label(git2::Status::INDEX_DELETED), "deleted");
    }

    #[test]
    fn derive_status_label_deleted_from_worktree() {
        assert_eq!(derive_status_label(git2::Status::WT_DELETED), "deleted");
    }

    #[test]
    fn derive_status_label_renamed_index() {
        assert_eq!(derive_status_label(git2::Status::INDEX_RENAMED), "renamed");
    }

    #[test]
    fn derive_status_label_renamed_worktree() {
        assert_eq!(derive_status_label(git2::Status::WT_RENAMED), "renamed");
    }

    #[test]
    fn derive_status_label_modified_index() {
        assert_eq!(
            derive_status_label(git2::Status::INDEX_MODIFIED),
            "modified"
        );
    }

    #[test]
    fn derive_status_label_modified_worktree() {
        assert_eq!(derive_status_label(git2::Status::WT_MODIFIED), "modified");
    }

    #[test]
    fn derive_status_label_conflicted() {
        assert_eq!(derive_status_label(git2::Status::CONFLICTED), "conflicted");
    }

    #[test]
    fn derive_status_label_fallback_changed() {
        // INDEX_TYPECHANGE doesn't match any earlier branch → fallback to "changed"
        assert_eq!(
            derive_status_label(git2::Status::INDEX_TYPECHANGE),
            "changed"
        );
    }

    #[test]
    fn derive_status_label_untracked_takes_priority_over_modified() {
        // WT_NEW should win when combined with other flags
        let flags = git2::Status::WT_NEW | git2::Status::WT_MODIFIED;
        assert_eq!(derive_status_label(flags), "untracked");
    }

    #[test]
    fn derive_status_label_added_takes_priority_over_modified() {
        let flags = git2::Status::INDEX_NEW | git2::Status::INDEX_MODIFIED;
        assert_eq!(derive_status_label(flags), "added");
    }
}
