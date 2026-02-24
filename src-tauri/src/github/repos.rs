use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::auth::token_store::{auth_expired_error, clear_stored_token, get_access_token};

fn log_repos(message: &str) {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    eprintln!("[Repos][{ts}] {message}");
}

#[derive(Debug, serde::Deserialize)]
struct GithubRepoOwner {
    login: String,
}

#[derive(Debug, serde::Deserialize)]
struct GithubRepo {
    owner: GithubRepoOwner,
    name: String,
    default_branch: String,
    description: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct RepoInfo {
    pub owner: String,
    pub name: String,
    pub default_branch: String,
    pub description: Option<String>,
}

fn parse_next_link(link_header: &str) -> Option<String> {
    for part in link_header.split(',') {
        let segment = part.trim();
        if !segment.contains("rel=\"next\"") {
            continue;
        }

        let start = segment.find('<')?;
        let end = segment.find('>')?;
        return Some(segment[start + 1..end].to_string());
    }

    None
}

fn is_auth_failure_status(status: reqwest::StatusCode, body: &str) -> bool {
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return true;
    }

    status == reqwest::StatusCode::FORBIDDEN && body.to_ascii_lowercase().contains("bad credentials")
}

#[tauri::command]
pub async fn list_repos(app: tauri::AppHandle) -> Result<Vec<RepoInfo>, String> {
    log_repos("list_repos start");
    let token = get_access_token(&app).await?;
    let client = reqwest::Client::new();

    let mut repos: Vec<RepoInfo> = Vec::new();
    let mut next_url = Some(
        "https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member"
            .to_string(),
    );
    let mut page_count = 0;

    while let Some(url) = next_url {
        page_count += 1;
        if page_count > 10 {
            log_repos("page limit reached, stopping pagination at 10 pages");
            break;
        }

        log_repos(&format!("fetching page {page_count}: {url}"));

        let response = client
            .get(&url)
            .header("Accept", "application/vnd.github+json")
            .header("Authorization", format!("Bearer {token}"))
            .header("User-Agent", "hyditor")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .send()
            .await
            .map_err(|err| format!("failed to list repositories: {err}"))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "<no response body>".to_string());

            if is_auth_failure_status(status, &body) {
                let _ = clear_stored_token(&app);
                log_repos(&format!("auth failure status={status}"));
                return Err(auth_expired_error(
                    "GitHub session expired while loading repositories. Sign in again.",
                ));
            }

            return Err(format!("list repos failed with status {status}: {body}"));
        }

        let link_header = response
            .headers()
            .get("link")
            .and_then(|value| value.to_str().ok())
            .map(str::to_string);

        let page: Vec<GithubRepo> = response
            .json()
            .await
            .map_err(|err| format!("invalid list repos response: {err}"))?;

        repos.extend(page.into_iter().map(|repo| RepoInfo {
            owner: repo.owner.login,
            name: repo.name,
            default_branch: repo.default_branch,
            description: repo.description,
        }));

        log_repos(&format!("accumulated repos={}", repos.len()));

        next_url = link_header.and_then(|value| parse_next_link(&value));
    }

    repos.sort_by(|a, b| {
        let left = format!("{}/{}", a.owner.to_lowercase(), a.name.to_lowercase());
        let right = format!("{}/{}", b.owner.to_lowercase(), b.name.to_lowercase());
        left.cmp(&right)
    });

    log_repos(&format!("list_repos complete total={}", repos.len()));

    Ok(repos)
}
