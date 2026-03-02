pub mod auth;
pub mod fs;
pub mod git;
pub mod github;
pub mod preview;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_stronghold::Builder::new(|_pass| vec![]).build());

    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(tauri_plugin_mcp_bridge::init());
    }

    builder
        .invoke_handler(tauri::generate_handler![
            auth::device_flow::start_device_flow,
            auth::device_flow::poll_for_token,
            auth::device_flow::start_device_polling,
            auth::device_flow::cancel_device_polling,
            auth::token_store::get_token,
            auth::token_store::sign_out,
            github::repos::list_repos,
            git::clone::clone_repo,
            git::status::git_status,
            git::status::git_diff_file,
            git::commit::git_stage,
            git::commit::git_commit,
            git::commit::git_revert_files,
            git::publish::git_publish,
            git::push::git_push,
            git::branch::list_branches,
            git::branch::switch_branch,
            fs::scoped::read_tree,
            fs::scoped::read_file_scoped,
            fs::scoped::write_file_scoped,
            fs::scoped::search_repo_files,
            fs::session::save_last_session,
            fs::session::load_last_session,
            fs::session::clear_last_session,
            preview::jekyll::start_jekyll,
            preview::jekyll::stop_jekyll,
            preview::jekyll::read_preview_log_tail,
            preview::jekyll::get_preview_log_directory
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
