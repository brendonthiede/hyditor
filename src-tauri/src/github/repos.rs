use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct RepoInfo {
    pub owner: String,
    pub name: String,
    pub default_branch: String,
    pub description: Option<String>,
}

#[tauri::command]
pub async fn list_repos() -> Result<Vec<RepoInfo>, String> {
    Ok(vec![])
}
