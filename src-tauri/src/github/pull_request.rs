use serde::{Deserialize, Serialize};

use crate::auth::token_store::{auth_expired_error, clear_stored_token, get_access_token};

#[derive(Debug, Deserialize)]
struct GithubPullRequest {
    number: u64,
    title: String,
    state: String,
    html_url: String,
}

#[derive(Debug, Serialize)]
struct CreatePullRequestRequest {
    title: String,
    head: String,
    base: String,
    body: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PullRequestInfo {
    pub number: u64,
    pub title: String,
    pub state: String,
    pub url: String,
}

fn is_auth_failure_status(status: reqwest::StatusCode, body: &str) -> bool {
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return true;
    }

    status == reqwest::StatusCode::FORBIDDEN && body.to_ascii_lowercase().contains("bad credentials")
}

#[tauri::command]
pub async fn create_pr(
    app: tauri::AppHandle,
    owner: String,
    repo: String,
    head: String,
    base: String,
    title: String,
    body: String,
) -> Result<PullRequestInfo, String> {
    let token = get_access_token(&app).await?;
    let client = reqwest::Client::new();
    let url = format!("https://api.github.com/repos/{owner}/{repo}/pulls");

    let request = CreatePullRequestRequest {
        title,
        head,
        base,
        body,
    };

    let response = client
        .post(&url)
        .header("Accept", "application/vnd.github+json")
        .header("Authorization", format!("Bearer {token}"))
        .header("User-Agent", "hyditor")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .json(&request)
        .send()
        .await
        .map_err(|err| format!("failed to create pull request: {err}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "<no response body>".to_string());

        if is_auth_failure_status(status, &body) {
            let _ = clear_stored_token(&app);
            return Err(auth_expired_error(
                "GitHub session expired while creating a pull request. Sign in again.",
            ));
        }

        return Err(format!("create pull request failed with status {status}: {body}"));
    }

    let pr: GithubPullRequest = response
        .json()
        .await
        .map_err(|err| format!("invalid create pull request response: {err}"))?;

    Ok(PullRequestInfo {
        number: pr.number,
        title: pr.title,
        state: pr.state,
        url: pr.html_url,
    })
}

#[tauri::command]
pub async fn list_prs(app: tauri::AppHandle, owner: String, repo: String) -> Result<Vec<PullRequestInfo>, String> {
    let t0 = std::time::Instant::now();
    let token = get_access_token(&app).await?;
    eprintln!("[list_prs] get_access_token took {:.3}s", t0.elapsed().as_secs_f64());
    let client = reqwest::Client::new();
    let url = format!("https://api.github.com/repos/{owner}/{repo}/pulls?state=open&per_page=100");

    let response = client
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .header("Authorization", format!("Bearer {token}"))
        .header("User-Agent", "hyditor")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|err| format!("failed to list pull requests: {err}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "<no response body>".to_string());

        if is_auth_failure_status(status, &body) {
            let _ = clear_stored_token(&app);
            return Err(auth_expired_error(
                "GitHub session expired while listing pull requests. Sign in again.",
            ));
        }

        return Err(format!("list pull requests failed with status {status}: {body}"));
    }

    let pulls: Vec<GithubPullRequest> = response
        .json()
        .await
        .map_err(|err| format!("invalid list pull requests response: {err}"))?;

    let result: Vec<PullRequestInfo> = pulls
        .into_iter()
        .map(|pr| PullRequestInfo {
            number: pr.number,
            title: pr.title,
            state: pr.state,
            url: pr.html_url,
        })
        .collect();

    eprintln!("[list_prs] total took {:.3}s ({} PRs)", t0.elapsed().as_secs_f64(), result.len());
    Ok(result)
}