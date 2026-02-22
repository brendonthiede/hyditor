use git2::{DiffOptions, Repository, StatusOptions};
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct GitStatusEntry {
    pub path: String,
    pub status: String,
}

#[tauri::command]
pub fn git_status(repo_path: String) -> Result<Vec<GitStatusEntry>, String> {
    let repo = Repository::open(repo_path).map_err(|e| format!("failed to open repo: {e}"))?;
    let mut options = StatusOptions::new();
    options.include_untracked(true);

    let statuses = repo
        .statuses(Some(&mut options))
        .map_err(|e| format!("failed to read status: {e}"))?;

    let mut result = Vec::new();
    for status in statuses.iter() {
        let path = status.path().unwrap_or_default().to_string();
        result.push(GitStatusEntry {
            path,
            status: format!("{:?}", status.status()),
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
