use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LastSession {
    pub owner: String,
    pub name: String,
    #[serde(alias = "default_branch")]
    pub last_branch: String,
    pub last_file: Option<String>,
}

fn session_file_path() -> Result<PathBuf, String> {
    let data_dir =
        dirs::data_dir().ok_or_else(|| "failed to resolve app data directory".to_string())?;
    Ok(data_dir.join("hyditor").join("last_session.json"))
}

#[tauri::command]
pub fn save_last_session(
    owner: String,
    name: String,
    last_branch: String,
    last_file: Option<String>,
) -> Result<(), String> {
    let session = LastSession {
        owner,
        name,
        last_branch,
        last_file,
    };
    let path = session_file_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("failed to create session dir: {e}"))?;
    }
    let json = serde_json::to_string_pretty(&session)
        .map_err(|e| format!("failed to serialize session: {e}"))?;
    fs::write(&path, json).map_err(|e| format!("failed to write session file: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn load_last_session() -> Result<Option<LastSession>, String> {
    let path = session_file_path()?;
    if !path.exists() {
        return Ok(None);
    }
    let json =
        fs::read_to_string(&path).map_err(|e| format!("failed to read session file: {e}"))?;
    let session: LastSession =
        serde_json::from_str(&json).map_err(|e| format!("failed to parse session file: {e}"))?;
    Ok(Some(session))
}

#[tauri::command]
pub fn clear_last_session() -> Result<(), String> {
    let path = session_file_path()?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("failed to remove session file: {e}"))?;
    }
    Ok(())
}
