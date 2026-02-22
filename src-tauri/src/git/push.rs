#[tauri::command]
pub fn git_push(_repo_path: String) -> Result<(), String> {
    Err("push is not yet configured with authenticated remote credentials".to_string())
}
