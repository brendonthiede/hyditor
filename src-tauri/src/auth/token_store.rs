use once_cell::sync::Lazy;
use std::sync::Mutex;

static TOKEN: Lazy<Mutex<Option<String>>> = Lazy::new(|| Mutex::new(None));

#[tauri::command]
pub fn get_token() -> Result<Option<String>, String> {
    let token = TOKEN
        .lock()
        .map_err(|_| "failed to lock token store".to_string())?;
    Ok(token.clone())
}

#[tauri::command]
pub fn sign_out() -> Result<(), String> {
    let mut token = TOKEN
        .lock()
        .map_err(|_| "failed to lock token store".to_string())?;
    *token = None;
    Ok(())
}
