pub mod auth;
pub mod fs;
pub mod git;
pub mod github;
pub mod preview;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_stronghold::Builder::new(|_pass| vec![]).build())
        .invoke_handler(tauri::generate_handler![
            auth::device_flow::start_device_flow,
            auth::device_flow::poll_for_token,
            auth::token_store::get_token,
            auth::token_store::sign_out,
            github::repos::list_repos,
            github::pull_request::create_pr,
            github::pull_request::list_prs,
            git::clone::clone_repo,
            git::status::git_status,
            git::status::git_diff_file,
            git::commit::git_stage,
            git::commit::git_unstage,
            git::commit::git_commit,
            git::push::git_push,
            git::branch::create_branch,
            git::branch::list_branches,
            git::branch::switch_branch,
            fs::scoped::read_tree,
            fs::scoped::read_file_scoped,
            fs::scoped::write_file_scoped,
            preview::jekyll::start_jekyll,
            preview::jekyll::stop_jekyll
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
