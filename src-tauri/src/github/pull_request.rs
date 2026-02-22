use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct PullRequestInfo {
    pub number: u64,
    pub title: String,
    pub state: String,
    pub url: String,
}

#[tauri::command]
pub async fn create_pr(
    _owner: String,
    _repo: String,
    _head: String,
    _base: String,
    _title: String,
    _body: String,
) -> Result<PullRequestInfo, String> {
    Err("create_pr not implemented yet".to_string())
}

#[tauri::command]
pub async fn list_prs(_owner: String, _repo: String) -> Result<Vec<PullRequestInfo>, String> {
    Ok(vec![])
}
