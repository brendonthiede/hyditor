use once_cell::sync::Lazy;
use std::io;
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
}

static ACTIVE_JEKYLL: Lazy<Mutex<Option<ActiveJekyll>>> = Lazy::new(|| Mutex::new(None));

fn log_preview(message: &str) {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    eprintln!("[Preview][{ts}] {message}");
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

fn bundle_install(repo_path: &Path) -> Result<(), String> {
    log_preview("running bundle install");
    let output = shell_command("bundle install")
        .current_dir(repo_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|err| jekyll_setup_error(&format!("Failed to run `bundle install`: {err}")))?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let combined = format!("{stdout}{stderr}");

    // Print captured output so it appears in the dev terminal for debugging.
    if !stderr.is_empty() {
        eprint!("{stderr}");
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
        output.status,
        stderr.trim()
    )))
}

fn start_jekyll_process(repo_path: &Path, port: u16) -> Result<Child, String> {
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
    let jekyll_args = format!(
        "serve --host {PREVIEW_HOST} --port {port} --baseurl \"\" --drafts --livereload --livereload-port {livereload_port}"
    );
    let shell_cmd = if use_bundle {
        format!("bundle exec jekyll {jekyll_args}")
    } else {
        format!("jekyll {jekyll_args}")
    };

    log_preview(&format!("shell command: {shell_cmd}"));

    shell_command(&shell_cmd)
        .current_dir(repo_path)
        .stdout(Stdio::null())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|err| jekyll_setup_error(&format!("Failed to launch Jekyll preview process: {err}")))
}

#[tauri::command]
pub fn start_jekyll(repo_path: String) -> Result<String, String> {
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
                    return Ok(format!("http://{PREVIEW_HOST}:{}", state.port));
                }
            }

            let _ = kill_process(&mut state.child);
            *active = None;
        }
    }

    let port = find_free_port()?;
    log_preview(&format!(
        "starting Jekyll for {} on port {port}",
        repo_path.to_string_lossy()
    ));
    let mut child = start_jekyll_process(&repo_path, port)?;

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
            });
            log_preview(&format!("Jekyll preview ready at {preview_url}"));
            Ok(preview_url)
        }
        Err(err) => {
            let _ = kill_process(&mut child);
            log_preview(&format!("Jekyll failed to become ready: {err}"));
            Err(err)
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
    }

    *active = None;
    log_preview("Jekyll preview stopped");
    Ok(())
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
        let result = start_jekyll("/definitely/not/a/real/repo/path".to_string());
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
}
