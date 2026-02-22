use once_cell::sync::Lazy;
use std::sync::Mutex;

static ACTIVE_URL: Lazy<Mutex<Option<String>>> = Lazy::new(|| Mutex::new(None));

#[tauri::command]
pub fn start_jekyll(_repo_path: String) -> Result<String, String> {
    let url = "http://127.0.0.1:4000".to_string();
    let mut active = ACTIVE_URL
        .lock()
        .map_err(|_| "failed to lock preview state".to_string())?;
    *active = Some(url.clone());
    Ok(url)
}

#[tauri::command]
pub fn stop_jekyll() -> Result<(), String> {
    let mut active = ACTIVE_URL
        .lock()
        .map_err(|_| "failed to lock preview state".to_string())?;
    *active = None;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn start_sets_url_and_stop_clears_state() {
        let url = start_jekyll("/tmp/repo".to_string()).expect("start should succeed");
        assert_eq!(url, "http://127.0.0.1:4000");

        stop_jekyll().expect("stop should succeed");

        let guard = ACTIVE_URL.lock().expect("lock should be available");
        assert!(guard.is_none());
    }
}
