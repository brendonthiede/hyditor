use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use walkdir::WalkDir;

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

const API_KEY_FILE: &str = "gemini_api_key";
const MODEL_FILE: &str = "gemini_model";
const GEMINI_API_BASE: &str = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL: &str = "gemini-2.5-flash";
const MAX_CONTEXT_BYTES: usize = 500_000;

/// Models available for selection in the UI.
const AVAILABLE_MODELS: &[&str] = &[
    "gemini-2.5-flash",
    "gemini-2.0-flash-lite",
    "gemini-2.0-flash",
    "gemini-1.5-flash",
    "gemini-1.5-pro",
];

// ── Gemini API types ────────────────────────────────────────────────

#[derive(Serialize)]
struct GeminiRequest {
    contents: Vec<GeminiContent>,
    #[serde(rename = "systemInstruction", skip_serializing_if = "Option::is_none")]
    system_instruction: Option<GeminiContent>,
}

#[derive(Serialize, Deserialize, Clone)]
struct GeminiContent {
    role: String,
    parts: Vec<GeminiPart>,
}

#[derive(Serialize, Deserialize, Clone)]
struct GeminiPart {
    text: String,
}

#[derive(Deserialize)]
struct GeminiResponse {
    candidates: Option<Vec<GeminiCandidate>>,
    error: Option<GeminiError>,
}

#[derive(Deserialize)]
struct GeminiCandidate {
    content: Option<GeminiCandidateContent>,
}

#[derive(Deserialize)]
struct GeminiCandidateContent {
    parts: Option<Vec<GeminiPart>>,
}

#[derive(Deserialize)]
struct GeminiError {
    message: String,
}

// ── Conversation types returned to the frontend ─────────────────────

#[derive(Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub role: String,   // "user" or "model"
    pub content: String,
}

// ── Key management ──────────────────────────────────────────────────

fn api_key_path(app: &AppHandle) -> Result<PathBuf, String> {
    let base_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?;
    fs::create_dir_all(&base_dir)
        .map_err(|e| format!("failed to create app data dir: {e}"))?;
    Ok(base_dir.join(API_KEY_FILE))
}

#[tauri::command]
pub async fn save_gemini_api_key(app: AppHandle, api_key: String) -> Result<(), String> {
    let key = api_key.trim().to_string();
    if key.is_empty() {
        return Err("API key cannot be empty".to_string());
    }

    let path = api_key_path(&app)?;
    fs::write(&path, &key).map_err(|e| format!("failed to save API key: {e}"))?;

    // Restrict file permissions on Unix
    #[cfg(unix)]
    {
        let perms = std::fs::Permissions::from_mode(0o600);
        fs::set_permissions(&path, perms)
            .map_err(|e| format!("failed to set key file permissions: {e}"))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn get_gemini_api_key(app: AppHandle) -> Result<Option<String>, String> {
    let path = api_key_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let key = fs::read_to_string(&path)
        .map_err(|e| format!("failed to read API key: {e}"))?
        .trim()
        .to_string();
    if key.is_empty() {
        return Ok(None);
    }
    Ok(Some(key))
}

#[tauri::command]
pub async fn clear_gemini_api_key(app: AppHandle) -> Result<(), String> {
    let path = api_key_path(&app)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("failed to remove API key: {e}"))?;
    }
    Ok(())
}

// ── Model selection ─────────────────────────────────────────────────

fn model_path(app: &AppHandle) -> Result<PathBuf, String> {
    let base_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?;
    Ok(base_dir.join(MODEL_FILE))
}

#[tauri::command]
pub async fn get_gemini_model(app: AppHandle) -> Result<String, String> {
    let path = model_path(&app)?;
    if path.exists() {
        let model = fs::read_to_string(&path)
            .map_err(|e| format!("failed to read model setting: {e}"))?
            .trim()
            .to_string();
        if !model.is_empty() {
            return Ok(model);
        }
    }
    Ok(DEFAULT_MODEL.to_string())
}

#[tauri::command]
pub async fn set_gemini_model(app: AppHandle, model: String) -> Result<(), String> {
    let path = model_path(&app)?;
    fs::write(&path, model.trim()).map_err(|e| format!("failed to save model setting: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn list_gemini_models() -> Result<Vec<String>, String> {
    Ok(AVAILABLE_MODELS.iter().map(|s| s.to_string()).collect())
}

// ── Repo context gathering ──────────────────────────────────────────

/// Collects text content of all relevant files in the repo as a single context
/// string, capped at MAX_CONTEXT_BYTES to fit within API limits.
fn gather_repo_context(repo_path: &str) -> Result<String, String> {
    let repo = std::path::Path::new(repo_path)
        .canonicalize()
        .map_err(|e| format!("invalid repo path: {e}"))?;

    let text_extensions: std::collections::HashSet<&str> = [
        "md", "markdown", "html", "htm", "css", "scss", "sass", "js", "ts",
        "json", "yml", "yaml", "toml", "xml", "svg", "txt", "rb", "py",
        "sh", "bash", "liquid", "njk", "ejs",
    ]
    .into_iter()
    .collect();

    let ignore_dirs: std::collections::HashSet<&str> = [
        ".git", ".github", ".vscode", "node_modules", "vendor", ".bundle",
        "_site", ".sass-cache", ".jekyll-cache", ".jekyll-metadata",
    ]
    .into_iter()
    .collect();

    let mut context = String::new();
    let mut total_bytes = 0usize;

    for entry in WalkDir::new(&repo)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            e.file_name()
                .to_str()
                .map(|s| !ignore_dirs.contains(s))
                .unwrap_or(true)
        })
        .filter_map(|e| e.ok())
    {
        if entry.file_type().is_dir() {
            continue;
        }

        let path = entry.path();
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");

        // Also include extensionless config files like Gemfile, _config.yml
        let filename = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");

        let is_config = matches!(
            filename,
            "Gemfile" | "Gemfile.lock" | "_config.yml" | "_config.yaml"
                | "package.json" | "Rakefile" | "Makefile"
        );

        if !is_config && !text_extensions.contains(ext) {
            continue;
        }

        let relative = path
            .strip_prefix(&repo)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/");

        if let Ok(content) = fs::read_to_string(path) {
            let header = format!("\n--- FILE: {} ---\n", relative);
            let segment_len = header.len() + content.len();

            if total_bytes + segment_len > MAX_CONTEXT_BYTES {
                // Include partial or skip to stay within budget
                let remaining = MAX_CONTEXT_BYTES.saturating_sub(total_bytes + header.len());
                if remaining > 100 {
                    context.push_str(&header);
                    context.push_str(&content[..remaining.min(content.len())]);
                    context.push_str("\n[truncated]");
                }
                break;
            }

            context.push_str(&header);
            context.push_str(&content);
            total_bytes += segment_len;
        }
    }

    Ok(context)
}

// ── Chat command ────────────────────────────────────────────────────

#[tauri::command]
pub async fn gemini_chat(
    app: AppHandle,
    repo_path: String,
    messages: Vec<ChatMessage>,
    include_repo_context: bool,
    model: Option<String>,
    current_file: Option<String>,
    current_file_content: Option<String>,
) -> Result<ChatMessage, String> {
    let api_key = get_gemini_api_key(app.clone()).await?
        .ok_or_else(|| "Gemini API key not configured. Please set your API key first.".to_string())?;

    let model_name = match model {
        Some(m) if !m.trim().is_empty() => m.trim().to_string(),
        _ => get_gemini_model(app).await?,
    };

    // Build system instruction with repo context
    let mut system_text = String::from(
        "You are a helpful AI assistant integrated into Hyditor, a desktop editor for Jekyll sites on GitHub Pages.\n\n\
         ## Your Role\n\
         You help users understand, edit, and improve their Jekyll website. You can:\n\
         - Answer questions about Jekyll, Liquid templates, YAML front matter, Markdown, HTML/CSS/JS\n\
         - Suggest improvements to content, layout, styling, and configuration\n\
         - Create new pages, posts, includes, or layouts\n\
         - Debug build issues and configuration problems\n\n\
         ## File Modifications\n\
         When the user asks you to modify or create a file, output the COMPLETE updated file contents inside \
         a specially tagged fenced code block like this:\n\n\
         ```file:path/to/file.md\n\
         <complete file contents here>\n\
         ```\n\n\
         IMPORTANT rules for file modifications:\n\
         - Always use the relative path from the repository root (e.g. `_posts/2024-01-01-hello.md`, not an absolute path)\n\
         - Include the COMPLETE file contents, not just the changed parts — the entire file will be replaced\n\
         - You may output multiple file blocks in one response if changes span multiple files\n\
         - If the user is asking about the currently open file, use that file's path\n\
         - Briefly explain what you changed and why, outside the file block\n\n\
         ## Response Style\n\
         - Use markdown formatting for explanations\n\
         - Be concise but thorough\n\
         - When you show file modifications, put your explanation before or after the file block, not inside it"
    );

    if include_repo_context {
        let context = gather_repo_context(&repo_path)?;
        if !context.is_empty() {
            system_text.push_str("\n\nHere are the files in the user's Jekyll site repository:\n");
            system_text.push_str(&context);
        }
    }

    if let (Some(file), Some(content)) = (&current_file, &current_file_content) {
        system_text.push_str(&format!(
            "\n\n## Currently Open File\nThe user currently has `{}` open in the editor:\n```\n{}\n```",
            file, content
        ));
    }

    let system_instruction = GeminiContent {
        role: "user".to_string(),
        parts: vec![GeminiPart { text: system_text }],
    };

    // Convert chat history to Gemini format
    let contents: Vec<GeminiContent> = messages
        .iter()
        .map(|m| GeminiContent {
            role: m.role.clone(),
            parts: vec![GeminiPart {
                text: m.content.clone(),
            }],
        })
        .collect();

    let request_body = GeminiRequest {
        contents,
        system_instruction: Some(system_instruction),
    };

    let url = format!("{}/{}:generateContent?key={}", GEMINI_API_BASE, model_name, api_key);

    let client = Client::new();
    let response = client
        .post(&url)
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Failed to call Gemini API: {e}"))?;

    let status = response.status();
    let body: GeminiResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Gemini response: {e}"))?;

    if let Some(err) = body.error {
        let msg = err.message;
        if msg.contains("quota") || msg.contains("limit: 0") {
            return Err(format!(
                "Gemini API quota error: {}\n\nIf the limit shown is 0, your API key may not have free-tier access. \
                 Create a new key at https://aistudio.google.com/apikey — AI Studio keys include free-tier quota automatically.",
                msg
            ));
        }
        return Err(format!("Gemini API error: {}", msg));
    }

    if !status.is_success() {
        return Err(format!("Gemini API returned status {status}"));
    }

    let reply_text = body
        .candidates
        .and_then(|c| c.into_iter().next())
        .and_then(|c| c.content)
        .and_then(|c| c.parts)
        .and_then(|p| p.into_iter().next())
        .map(|p| p.text)
        .unwrap_or_else(|| "No response from Gemini.".to_string());

    Ok(ChatMessage {
        role: "model".to_string(),
        content: reply_text,
    })
}
