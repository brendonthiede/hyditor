use once_cell::sync::Lazy;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone)]
pub struct StoredToken {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: Option<i64>,
}

static TOKEN: Lazy<Mutex<Option<StoredToken>>> = Lazy::new(|| Mutex::new(None));

pub fn get_stored_token() -> Result<Option<StoredToken>, String> {
    let token = TOKEN
        .lock()
        .map_err(|_| "failed to lock token store".to_string())?;
    Ok(token.clone())
}

pub fn set_token(token: StoredToken) -> Result<(), String> {
    let mut current = TOKEN
        .lock()
        .map_err(|_| "failed to lock token store".to_string())?;
    *current = Some(token);
    Ok(())
}

#[tauri::command]
pub async fn get_token() -> Result<Option<String>, String> {
    let token = get_stored_token()?;
    
    if let Some(stored) = token {
        // Check if token is expired or will expire in the next 60 seconds
        if let Some(expires_at) = stored.expires_at {
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(|_| "failed to get current time".to_string())?
                .as_secs() as i64;
            
            // If token expires within 60 seconds, try to refresh
            if expires_at - now < 60 {
                if let Some(refresh_token) = stored.refresh_token {
                    // Try to refresh the token
                    match crate::auth::device_flow::refresh_access_token(&refresh_token).await {
                        Ok(new_token) => return Ok(Some(new_token.access_token)),
                        Err(_) => {
                            // If refresh fails, return the existing token anyway
                            // (it might still work for a few more seconds)
                            return Ok(Some(stored.access_token));
                        }
                    }
                }
            }
        }
        
        Ok(Some(stored.access_token))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub fn sign_out() -> Result<(), String> {
    let mut token = TOKEN
        .lock()
        .map_err(|_| "failed to lock token store".to_string())?;
    *token = None;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_and_get_stored_token_works() {
        sign_out().expect("cleanup should work");
        
        let token = StoredToken {
            access_token: "test_access_token".to_string(),
            refresh_token: Some("test_refresh_token".to_string()),
            expires_at: Some(9999999999),
        };

        set_token(token.clone()).expect("set should succeed");
        let retrieved = get_stored_token().expect("get should succeed");

        assert!(retrieved.is_some());
        let stored = retrieved.unwrap();
        assert_eq!(stored.access_token, "test_access_token");
        assert_eq!(stored.refresh_token, Some("test_refresh_token".to_string()));
        assert_eq!(stored.expires_at, Some(9999999999));
    }

    #[test]
    fn sign_out_clears_token() {
        let token = StoredToken {
            access_token: "temp_token".to_string(),
            refresh_token: None,
            expires_at: None,
        };
        set_token(token).expect("set should succeed");

        sign_out().expect("sign out should succeed");

        let result = get_stored_token().expect("get should succeed");
        assert!(result.is_none());
    }

    #[test]
    fn get_stored_token_returns_none_when_empty() {
        sign_out().expect("cleanup should work");
        let result = get_stored_token().expect("get should succeed");
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn get_token_returns_valid_unexpired_token() {
        sign_out().expect("cleanup should work");
        
        let future_time = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64
            + 3600; // 1 hour from now

        let token = StoredToken {
            access_token: "valid_token".to_string(),
            refresh_token: None,
            expires_at: Some(future_time),
        };
        set_token(token).expect("set should succeed");

        let result = get_token().await.expect("get_token should succeed");
        assert_eq!(result, Some("valid_token".to_string()));
    }

    #[tokio::test]
    async fn get_token_returns_none_when_no_token_stored() {
        // Clear any previous state
        let _ = sign_out();
        
        // Double-check the token is cleared
        let stored = get_stored_token().expect("get_stored_token should work");
        if stored.is_some() {
            // If other tests left state, clear it and verify
            sign_out().expect("cleanup should work");
        }
        
        let result = get_token().await.expect("get_token should succeed");
        assert!(result.is_none(), "Expected None but got {:?}", result);
    }
}
