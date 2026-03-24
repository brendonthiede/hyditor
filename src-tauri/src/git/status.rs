use git2::{DiffOptions, Repository, StatusOptions};
use serde::Serialize;
use std::path::Path;

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

fn normalize_repo_relative_path(path: &str) -> String {
    path.replace('\\', "/")
}

fn normalize_line_endings(content: &str) -> String {
    content.replace("\r\n", "\n").replace('\r', "\n")
}

fn read_index_text_for_path(repo: &Repository, path: &str) -> Option<String> {
    let index = repo.index().ok()?;
    let entry = index.get_path(Path::new(path), 0)?;
    let blob = repo.find_blob(entry.id).ok()?;
    let text = std::str::from_utf8(blob.content()).ok()?;
    Some(text.to_string())
}

fn read_workdir_text_for_path(repo: &Repository, path: &str) -> Option<String> {
    let workdir = repo.workdir()?;
    std::fs::read_to_string(workdir.join(path)).ok()
}

pub(crate) fn is_line_ending_only_diff(repo: &Repository, path: &str) -> bool {
    let normalized_path = normalize_repo_relative_path(path);
    let index_text = match read_index_text_for_path(repo, &normalized_path) {
        Some(content) => content,
        None => return false,
    };
    let workdir_text = match read_workdir_text_for_path(repo, &normalized_path) {
        Some(content) => content,
        None => return false,
    };

    if index_text == workdir_text {
        return false;
    }

    normalize_line_endings(&index_text) == normalize_line_endings(&workdir_text)
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
            && (is_whitespace_only_diff(&repo, &path)
                || is_line_ending_only_diff(&repo, &path));
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

/// Return the content of a file as it exists in HEAD.
/// For untracked files (no HEAD entry), returns an empty string.
#[tauri::command]
pub fn git_file_head_content(repo_path: String, file_path: String) -> Result<String, String> {
    let repo = Repository::open(&repo_path).map_err(|e| format!("failed to open repo: {e}"))?;

    let head = match repo.head() {
        Ok(h) => h,
        Err(_) => return Ok(String::new()), // No commits yet
    };

    let tree = head
        .peel_to_tree()
        .map_err(|e| format!("failed to peel HEAD to tree: {e}"))?;

    let entry = match tree.get_path(Path::new(&file_path)) {
        Ok(e) => e,
        Err(_) => return Ok(String::new()), // File doesn't exist in HEAD (untracked/new)
    };

    let blob = repo
        .find_blob(entry.id())
        .map_err(|e| format!("failed to read blob: {e}"))?;

    let content = std::str::from_utf8(blob.content())
        .map_err(|_| "file is binary or not valid UTF-8".to_string())?;

    Ok(content.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_line_endings_converts_crlf_and_cr_to_lf() {
        assert_eq!(normalize_line_endings("a\r\nb\rc\n"), "a\nb\nc\n");
    }

    #[test]
    fn normalize_repo_relative_path_converts_backslashes() {
        assert_eq!(
            normalize_repo_relative_path("content\\posts\\test.md"),
            "content/posts/test.md"
        );
    }

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
