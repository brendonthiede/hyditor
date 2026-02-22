use git2::{BranchType, Repository};

#[tauri::command]
pub fn create_branch(repo_path: String, branch_name: String) -> Result<(), String> {
    let repo = Repository::open(repo_path).map_err(|e| format!("failed to open repo: {e}"))?;
    let head_commit = repo
        .head()
        .and_then(|h| h.peel_to_commit())
        .map_err(|e| format!("failed to resolve HEAD: {e}"))?;

    repo.branch(&branch_name, &head_commit, false)
        .map_err(|e| format!("failed to create branch: {e}"))?;

    Ok(())
}

#[tauri::command]
pub fn list_branches(repo_path: String) -> Result<Vec<String>, String> {
    let repo = Repository::open(repo_path).map_err(|e| format!("failed to open repo: {e}"))?;
    let mut branches = Vec::new();

    for branch in repo
        .branches(Some(BranchType::Local))
        .map_err(|e| format!("failed to list branches: {e}"))?
    {
        let (branch, _) = branch.map_err(|e| format!("branch parse failed: {e}"))?;
        if let Some(name) = branch.name().map_err(|e| format!("branch name failed: {e}"))? {
            branches.push(name.to_string());
        }
    }

    Ok(branches)
}

#[tauri::command]
pub fn switch_branch(repo_path: String, branch_name: String) -> Result<(), String> {
    let repo = Repository::open(repo_path).map_err(|e| format!("failed to open repo: {e}"))?;
    let reference = format!("refs/heads/{branch_name}");
    repo.set_head(&reference)
        .map_err(|e| format!("failed to set HEAD: {e}"))?;
    repo.checkout_head(None)
        .map_err(|e| format!("failed to checkout branch: {e}"))?;
    Ok(())
}
