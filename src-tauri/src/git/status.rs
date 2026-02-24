use git2::{DiffOptions, Repository, StatusOptions};
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct GitStatusEntry {
    pub path: String,
    pub status: String,
    pub staged: bool,
    pub unstaged: bool,
    pub untracked: bool,
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
            unstaged: flags.intersects(
                git2::Status::WT_MODIFIED
                    | git2::Status::WT_DELETED
                    | git2::Status::WT_RENAMED
                    | git2::Status::WT_TYPECHANGE,
            ),
            untracked: flags.is_wt_new(),
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
