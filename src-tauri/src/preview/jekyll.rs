use once_cell::sync::Lazy;
use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// Windows creation flag: run the child process without creating a visible
/// console window.  Prevents PowerShell / taskkill from flashing a window
/// when launched from the GUI app.
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const PREVIEW_HOST: &str = "127.0.0.1";
const PREVIEW_BOOT_TIMEOUT: Duration = Duration::from_secs(60);
const PREVIEW_LOG_FILE_NAME: &str = "preview.log";
const PREVIEW_TEMP_CONFIG_DIR_NAME: &str = "preview-config";
const PREVIEW_TEMP_CONFIG_PREFIX: &str = "preview-override-";

/// URL to the Jekyll prerequisites guide in the project README.
const JEKYLL_SETUP_GUIDE: &str =
    "https://github.com/brendonthiede/hyditor/blob/main/docs/jekyll-prerequisites.md";

/// Build a user-facing error message that includes a link to the setup guide.
fn jekyll_setup_error(detail: &str) -> String {
    format!(
        "{detail}\n\nFor setup instructions, see: {JEKYLL_SETUP_GUIDE}"
    )
}

/// Find a free TCP port by binding to port 0 and letting the OS assign one.
fn find_free_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|err| format!("failed to find a free port: {err}"))?;
    let port = listener
        .local_addr()
        .map_err(|err| format!("failed to read assigned port: {err}"))?
        .port();
    // Dropping the listener releases the port so Jekyll can bind to it.
    drop(listener);
    Ok(port)
}

struct ActiveJekyll {
    child: Child,
    repo_path: PathBuf,
    port: u16,
    temp_config_path: Option<PathBuf>,
    livereload_enabled: bool,
}

struct StartedJekyll {
    child: Child,
    temp_config_path: Option<PathBuf>,
}

#[derive(Debug, Serialize)]
pub struct JekyllStartResult {
    pub preview_url: String,
    pub livereload_enabled: bool,
}

static ACTIVE_JEKYLL: Lazy<Mutex<Option<ActiveJekyll>>> = Lazy::new(|| Mutex::new(None));

fn resolve_preview_log_path() -> Option<PathBuf> {
    let mut base = dirs::data_local_dir().or_else(dirs::cache_dir)?;
    base.push("hyditor");
    base.push("logs");
    base.push(PREVIEW_LOG_FILE_NAME);
    Some(base)
}

fn resolve_preview_temp_config_dir() -> Option<PathBuf> {
    let mut base = dirs::cache_dir().or_else(dirs::data_local_dir)?;
    base.push("hyditor");
    base.push(PREVIEW_TEMP_CONFIG_DIR_NAME);
    Some(base)
}

fn append_preview_log(message: &str) {
    let Some(path) = resolve_preview_log_path() else {
        return;
    };

    let Some(parent) = path.parent() else {
        return;
    };

    if fs::create_dir_all(parent).is_err() {
        return;
    }

    let mut file = match OpenOptions::new().create(true).append(true).open(path) {
        Ok(file) => file,
        Err(_) => return,
    };

    let _ = writeln!(file, "{message}");
}

fn read_log_tail_from_path(path: &Path, max_lines: usize) -> Result<String, String> {
    if max_lines == 0 {
        return Ok(String::new());
    }

    if !path.exists() {
        return Ok(String::new());
    }

    let content = fs::read_to_string(path)
        .map_err(|err| format!("failed to read preview log file: {err}"))?;

    let mut lines: Vec<&str> = content.lines().rev().take(max_lines).collect();
    lines.reverse();
    Ok(lines.join("\n"))
}

fn log_preview(message: &str) {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let line = format!("[Preview][{ts}] {message}");
    eprintln!("{line}");
    append_preview_log(&line);
}

fn spawn_stream_logger<R>(stream: R, stream_name: &'static str)
where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        let reader = BufReader::new(stream);
        for line in reader.lines() {
            match line {
                Ok(line) if !line.trim().is_empty() => {
                    log_preview(&format!("[jekyll {stream_name}] {line}"));
                }
                Ok(_) => {}
                Err(err) => {
                    log_preview(&format!("failed reading Jekyll {stream_name}: {err}"));
                    break;
                }
            }
        }
    });
}

fn attach_jekyll_output_logging(child: &mut Child) {
    if let Some(stdout) = child.stdout.take() {
        spawn_stream_logger(stdout, "stdout");
    }

    if let Some(stderr) = child.stderr.take() {
        spawn_stream_logger(stderr, "stderr");
    }
}

fn wait_for_preview_ready(child: &mut Child, port: u16) -> Result<(), String> {
    let addr: SocketAddr = format!("{PREVIEW_HOST}:{port}")
        .parse()
        .map_err(|err| format!("invalid preview address: {err}"))?;

    let start = Instant::now();
    while start.elapsed() < PREVIEW_BOOT_TIMEOUT {
        match child.try_wait() {
            Ok(Some(status)) => {
                return Err(jekyll_setup_error(&format!(
                    "Jekyll process exited unexpectedly (status: {status}). \
                     Check that all required gems are installed (`bundle install`) \
                     and that Jekyll can build your site."
                )));
            }
            Ok(None) => {}
            Err(err) => {
                return Err(format!("failed to check Jekyll process status: {err}"));
            }
        }

        match TcpStream::connect_timeout(&addr, Duration::from_millis(400)) {
            Ok(_) => return Ok(()),
            Err(_) => thread::sleep(Duration::from_millis(300)),
        }
    }

    Err("Jekyll preview did not become ready in time.".to_string())
}

fn kill_process(child: &mut Child) -> io::Result<()> {
    if child.try_wait()?.is_some() {
        return Ok(());
    }

    // On Windows, `child.kill()` only terminates the immediate process
    // (powershell.exe), leaving the Jekyll subprocess running.  Use
    // `taskkill /F /T /PID` to kill the entire process tree.
    #[cfg(target_os = "windows")]
    {
        let pid = child.id();
        let _ = Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }

    #[cfg(not(target_os = "windows"))]
    {
        child.kill()?;
    }

    let _ = child.wait();
    Ok(())
}

fn cleanup_temp_config(path: Option<&Path>) {
    let Some(path) = path else {
        return;
    };

    match fs::remove_file(path) {
        Ok(()) => log_preview(&format!("removed temporary preview config {}", path.display())),
        Err(err) if err.kind() == io::ErrorKind::NotFound => {}
        Err(err) => log_preview(&format!("failed to remove temporary preview config {}: {err}", path.display())),
    }
}

fn cleanup_stale_temp_configs() {
    let Some(dir) = resolve_preview_temp_config_dir() else {
        return;
    };

    let entries = match fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return,
        Err(err) => {
            log_preview(&format!(
                "failed to read preview temp config directory {}: {err}",
                dir.display()
            ));
            return;
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };

        if !name.starts_with(PREVIEW_TEMP_CONFIG_PREFIX) || !name.ends_with(".yml") {
            continue;
        }

        cleanup_temp_config(Some(path.as_path()));
    }
}

fn shell_quote(value: &str) -> String {
    #[cfg(target_os = "windows")]
    {
        format!("'{}'", value.replace('\'', "''"))
    }

    #[cfg(not(target_os = "windows"))]
    {
        format!("'{}'", value.replace('\'', "'\\''"))
    }
}

fn create_temp_preview_config(repo_path: &Path, port: u16) -> Result<(PathBuf, String), String> {
    let temp_dir = resolve_preview_temp_config_dir()
        .ok_or_else(|| "failed to resolve preview temp config directory".to_string())?;
    fs::create_dir_all(&temp_dir)
        .map_err(|err| format!("failed to create preview temp config directory: {err}"))?;

    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let file_name = format!("{PREVIEW_TEMP_CONFIG_PREFIX}{port}-{ts}.yml");
    let file_path = temp_dir.join(&file_name);

    #[cfg(target_os = "windows")]
    let baseurl = "/";
    #[cfg(not(target_os = "windows"))]
    let baseurl = "";

    let content = format!("baseurl: \"{baseurl}\"\n");
    fs::write(&file_path, content)
        .map_err(|err| format!("failed to write preview temp config: {err}"))?;

    let override_str = file_path.to_string_lossy().to_string();
    let config_flag = if repo_path.join("_config.yml").exists() {
        let base_config = repo_path.join("_config.yml").to_string_lossy().to_string();
        format!("--config {}", shell_quote(&format!("{base_config},{override_str}")))
    } else {
        format!("--config {}", shell_quote(&override_str))
    };

    log_preview(&format!(
        "created temporary preview config {}",
        file_path.display()
    ));
    Ok((file_path, config_flag))
}


/// Run a shell command via the platform-appropriate shell.
///
/// On Unix this uses `bash -l -c` so that login-shell profile scripts
/// (rbenv, rvm, etc.) are sourced.  On Windows this uses
/// `powershell.exe -NonInteractive -Command` which loads the user's
/// PowerShell profile (where Ruby version managers or custom PATH
/// additions may be configured), matching the Unix login-shell behaviour.
/// The `CREATE_NO_WINDOW` flag prevents a console window from flashing.
fn shell_command(cmd: &str) -> Command {
    #[cfg(target_os = "windows")]
    {
        let mut c = Command::new("powershell.exe");
        c.args(["-NonInteractive", "-Command", cmd]);
        c.creation_flags(CREATE_NO_WINDOW);
        c
    }

    #[cfg(not(target_os = "windows"))]
    {
        let mut c = Command::new("bash");
        c.args(["-l", "-c", cmd]);
        c
    }
}

fn shell_command_exists(name: &str) -> bool {
    #[cfg(target_os = "windows")]
    let check_cmd = format!("Get-Command {name} -ErrorAction SilentlyContinue");

    #[cfg(not(target_os = "windows"))]
    let check_cmd = format!("command -v {name} >/dev/null 2>&1");

    shell_command(&check_cmd)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn run_bundle_install(repo_path: &Path, force_ruby_platform: bool) -> Result<(), (String, String)> {
    let mut cmd = shell_command("bundle install");
    cmd.current_dir(repo_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if force_ruby_platform {
        cmd.env("BUNDLE_FORCE_RUBY_PLATFORM", "1");
    }
    let output = cmd
        .output()
        .map_err(|err| {
            let msg = jekyll_setup_error(&format!("Failed to run `bundle install`: {err}"));
            (msg.clone(), msg)
        })?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let combined = format!("{stdout}{stderr}");

    for line in combined.lines() {
        if !line.trim().is_empty() {
            log_preview(&format!("[bundle install] {line}"));
        }
    }

    if !stderr.is_empty() {
        eprint!("{stderr}");
    }

    Err((combined, format!("{}", output.status)))
}

fn bundle_install(repo_path: &Path) -> Result<(), String> {
    log_preview("running bundle install");

    let (combined, exit_status) = match run_bundle_install(repo_path, false) {
        Ok(()) => return Ok(()),
        Err(pair) => pair,
    };

    // On Windows, wdm 0.1.x fails to compile with Ruby 3.2+.  Retry with
    // BUNDLE_FORCE_RUBY_PLATFORM=1 which tells Bundler to skip platform-
    // conditional gems like wdm (used only for native file-system watching
    // that Hyditor does not need).
    #[cfg(target_os = "windows")]
    if combined.contains("wdm") && combined.contains("Failed to build gem native extension") {
        log_preview(
            "wdm native extension build failed; retrying bundle install \
             with BUNDLE_FORCE_RUBY_PLATFORM=1 to skip it",
        );
        if run_bundle_install(repo_path, true).is_ok() {
            log_preview("bundle install succeeded after skipping wdm");
            return Ok(());
        }
    }

    // Detect version-manager "command not found" patterns (rbenv, rvm, asdf, etc.)
    if combined.contains("command not found") {
        return Err(jekyll_setup_error(
            "Bundler is not available for the current Ruby version. \
             Ensure the correct Ruby version is installed and that `gem install bundler` \
             has been run."
        ));
    }

    Err(jekyll_setup_error(&format!(
        "`bundle install` failed (exit {}).\n{}",
        exit_status,
        combined.trim()
    )))
}

fn start_jekyll_process(repo_path: &Path, port: u16, livereload_enabled: bool) -> Result<StartedJekyll, String> {
    let gemfile_exists = repo_path.join("Gemfile").exists();
    let has_bundle = shell_command_exists("bundle");
    let use_bundle = gemfile_exists && has_bundle;
    let has_jekyll = shell_command_exists("jekyll");

    if !use_bundle && !has_jekyll {
        // Neither bundle nor jekyll is usable — give targeted guidance.
        let detail = if gemfile_exists && !has_bundle {
            "This repository has a Gemfile but Bundler is not installed (or the \
             required Ruby version is not active). Install Ruby and run \
             `gem install bundler` to enable Full Preview."
        } else {
            "Jekyll is not installed. Install Ruby and Jekyll (or Bundler with \
             a Gemfile) to use Full Preview."
        };
        return Err(jekyll_setup_error(detail));
    }

    if use_bundle {
        bundle_install(repo_path)?;
    }

    let livereload_port = find_free_port()?;
    let (temp_config_path, config_flag) = create_temp_preview_config(repo_path, port)?;
    log_preview(&format!(
        "current launch temp config path: {}",
        temp_config_path.display()
    ));

    let jekyll_args = if livereload_enabled {
        format!(
            "serve --host {PREVIEW_HOST} --port {port} {config_flag} --drafts --future --unpublished --livereload --livereload-port {livereload_port}"
        )
    } else {
        format!("serve --host {PREVIEW_HOST} --port {port} {config_flag} --drafts --future --unpublished")
    };
    let shell_cmd = if use_bundle {
        format!("bundle exec jekyll {jekyll_args}")
    } else {
        format!("jekyll {jekyll_args}")
    };

    log_preview(&format!("shell command: {shell_cmd}"));

    let mut child = shell_command(&shell_cmd)
        .current_dir(repo_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| {
            cleanup_temp_config(Some(temp_config_path.as_path()));
            jekyll_setup_error(&format!("Failed to launch Jekyll preview process: {err}"))
        })?;

    attach_jekyll_output_logging(&mut child);
    Ok(StartedJekyll {
        child,
        temp_config_path: Some(temp_config_path),
    })
}

#[tauri::command]
pub async fn start_jekyll(repo_path: String) -> Result<JekyllStartResult, String> {
    // Offload all blocking work (bundle install, process spawn, TCP polling)
    // to a background thread so the Tauri IPC handler stays free and the
    // window remains responsive while Jekyll boots.
    tokio::task::spawn_blocking(move || start_jekyll_blocking(repo_path))
        .await
        .map_err(|err| format!("Jekyll startup task failed: {err}"))?
}

fn start_jekyll_blocking(repo_path: String) -> Result<JekyllStartResult, String> {
    let repo_path = PathBuf::from(repo_path);
    if !repo_path.exists() {
        return Err("Repository path does not exist.".to_string());
    }

    {
        let mut active = ACTIVE_JEKYLL
            .lock()
            .map_err(|_| "failed to lock preview state".to_string())?;

        if let Some(state) = active.as_mut() {
            if state.repo_path == repo_path {
                if state.child.try_wait().map_err(|err| format!("failed checking Jekyll process: {err}"))?.is_none() {
                    log_preview("reusing existing Jekyll process");
                    return Ok(JekyllStartResult {
                        preview_url: format!("http://{PREVIEW_HOST}:{}", state.port),
                        livereload_enabled: state.livereload_enabled,
                    });
                }
            }

            let _ = kill_process(&mut state.child);
            cleanup_temp_config(state.temp_config_path.as_deref());
            *active = None;
        }

        cleanup_stale_temp_configs();
    }

    let port = find_free_port()?;
    log_preview(&format!(
        "starting Jekyll for {} on port {port}",
        repo_path.to_string_lossy()
    ));
    let StartedJekyll {
        mut child,
        temp_config_path,
    } = start_jekyll_process(&repo_path, port, true)?;

    match wait_for_preview_ready(&mut child, port) {
        Ok(_) => {
            let preview_url = format!("http://{PREVIEW_HOST}:{port}");
            let mut active = ACTIVE_JEKYLL
                .lock()
                .map_err(|_| "failed to lock preview state".to_string())?;
            *active = Some(ActiveJekyll {
                child,
                repo_path,
                port,
                temp_config_path,
                livereload_enabled: true,
            });
            log_preview(&format!("Jekyll preview ready at {preview_url}"));
            Ok(JekyllStartResult {
                preview_url,
                livereload_enabled: true,
            })
        }
        Err(primary_err) => {
            let _ = kill_process(&mut child);
            cleanup_temp_config(temp_config_path.as_deref());

            #[cfg(target_os = "windows")]
            let should_retry_without_livereload = primary_err.contains("exited unexpectedly")
                || primary_err.contains("did not become ready in time");
            #[cfg(not(target_os = "windows"))]
            let should_retry_without_livereload = false;

            if should_retry_without_livereload {
                log_preview("initial Jekyll launch with livereload failed; retrying without livereload");

                let StartedJekyll {
                    mut child,
                    temp_config_path,
                } = start_jekyll_process(&repo_path, port, false)?;

                match wait_for_preview_ready(&mut child, port) {
                    Ok(_) => {
                        let preview_url = format!("http://{PREVIEW_HOST}:{port}");
                        let mut active = ACTIVE_JEKYLL
                            .lock()
                            .map_err(|_| "failed to lock preview state".to_string())?;
                        *active = Some(ActiveJekyll {
                            child,
                            repo_path,
                            port,
                            temp_config_path,
                            livereload_enabled: false,
                        });
                        log_preview(&format!(
                            "Jekyll preview ready at {preview_url} (livereload disabled fallback)"
                        ));
                        return Ok(JekyllStartResult {
                            preview_url,
                            livereload_enabled: false,
                        });
                    }
                    Err(fallback_err) => {
                        let _ = kill_process(&mut child);
                        cleanup_temp_config(temp_config_path.as_deref());
                        log_preview(&format!(
                            "Jekyll fallback without livereload failed: {fallback_err}"
                        ));
                        return Err(fallback_err);
                    }
                }
            }

            log_preview(&format!("Jekyll failed to become ready: {primary_err}"));
            Err(primary_err)
        }
    }
}

#[tauri::command]
pub fn stop_jekyll() -> Result<(), String> {
    let mut active = ACTIVE_JEKYLL
        .lock()
        .map_err(|_| "failed to lock preview state".to_string())?;

    if let Some(state) = active.as_mut() {
        kill_process(&mut state.child)
            .map_err(|err| format!("failed to stop Jekyll preview process: {err}"))?;
        cleanup_temp_config(state.temp_config_path.as_deref());
    }

    *active = None;
    log_preview("Jekyll preview stopped");
    Ok(())
}

#[tauri::command]
pub fn read_preview_log_tail(lines: Option<usize>) -> Result<String, String> {
    let max_lines = lines.unwrap_or(50).clamp(1, 500);
    let Some(path) = resolve_preview_log_path() else {
        return Err("failed to resolve preview log path".to_string());
    };
    read_log_tail_from_path(&path, max_lines)
}

#[tauri::command]
pub fn get_preview_log_directory() -> Result<String, String> {
    let Some(path) = resolve_preview_log_path() else {
        return Err("failed to resolve preview log path".to_string());
    };

    let dir = path
        .parent()
        .ok_or_else(|| "failed to resolve preview log directory".to_string())?;
    Ok(dir.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn find_free_port_returns_nonzero() {
        let port = find_free_port().expect("should find a free port");
        assert_ne!(port, 0, "port should be nonzero");
    }

    #[test]
    fn find_free_port_returns_unique_ports() {
        let p1 = find_free_port().unwrap();
        let p2 = find_free_port().unwrap();
        // While not strictly guaranteed, getting different ports from two
        // consecutive calls is extremely likely when no other allocation
        // is happening on the same ports.
        assert_ne!(p1, p2, "consecutive calls should return different ports");
    }

    #[test]
    fn stop_without_active_process_is_ok() {
        stop_jekyll().expect("stop should succeed without an active process");
    }

    #[test]
    fn start_jekyll_rejects_nonexistent_path() {
        let result = start_jekyll_blocking("/definitely/not/a/real/repo/path".to_string());
        assert!(result.is_err());
        assert!(
            result.unwrap_err().contains("does not exist"),
            "should indicate the path does not exist"
        );
    }

    #[test]
    fn preview_host_constant() {
        assert_eq!(PREVIEW_HOST, "127.0.0.1");
    }

    #[test]
    fn read_log_tail_returns_last_lines() {
        let temp = tempfile::tempdir().expect("temp dir should create");
        let log_path = temp.path().join("preview.log");
        std::fs::write(&log_path, "a\nb\nc\nd\n").expect("write should succeed");

        let tail = read_log_tail_from_path(&log_path, 2).expect("tail should read");
        assert_eq!(tail, "c\nd");
    }

    #[test]
    fn read_log_tail_missing_file_returns_empty() {
        let temp = tempfile::tempdir().expect("temp dir should create");
        let log_path = temp.path().join("missing.log");

        let tail = read_log_tail_from_path(&log_path, 50).expect("tail should read");
        assert!(tail.is_empty());
    }

    #[test]
    fn temp_config_dir_name_constant_is_stable() {
        assert_eq!(PREVIEW_TEMP_CONFIG_DIR_NAME, "preview-config");
    }
}
