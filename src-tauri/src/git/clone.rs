use git2::Repository;

#[tauri::command]
pub fn clone_repo(owner: String, name: String, path: String) -> Result<String, String> {
    let repo_url = format!("https://github.com/{owner}/{name}.git");
    let target = std::path::Path::new(&path).join(owner).join(name);

    if target.exists() {
        return Ok(target.to_string_lossy().to_string());
    }

    std::fs::create_dir_all(target.parent().ok_or_else(|| "invalid clone target".to_string())?)
        .map_err(|e| format!("failed to create clone dir: {e}"))?;

    Repository::clone(&repo_url, &target).map_err(|e| format!("clone failed: {e}"))?;

    Ok(target.to_string_lossy().to_string())
}
