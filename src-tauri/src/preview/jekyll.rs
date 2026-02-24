use once_cell::sync::Lazy;
use std::io;
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const PREVIEW_HOST: &str = "127.0.0.1";
const PREVIEW_PORT: u16 = 4000;
const PREVIEW_URL: &str = "http://127.0.0.1:4000";
const PREVIEW_BOOT_TIMEOUT: Duration = Duration::from_secs(60);

struct ActiveJekyll {
    child: Child,
    repo_path: PathBuf,
}

static ACTIVE_JEKYLL: Lazy<Mutex<Option<ActiveJekyll>>> = Lazy::new(|| Mutex::new(None));

fn log_preview(message: &str) {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    eprintln!("[Preview][{ts}] {message}");
}

fn wait_for_preview_ready(child: &mut Child) -> Result<(), String> {
    let addr: SocketAddr = format!("{PREVIEW_HOST}:{PREVIEW_PORT}")
        .parse()
        .map_err(|err| format!("invalid preview address: {err}"))?;

    let start = Instant::now();
    while start.elapsed() < PREVIEW_BOOT_TIMEOUT {
        match child.try_wait() {
            Ok(Some(status)) => {
                return Err(format!(
                    "Jekyll process exited unexpectedly (status: {status}). \
                     Check that all required gems are installed (`bundle install`) \
                     and that Jekyll can build your site."
                ));
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

    child.kill()?;
    let _ = child.wait();
    Ok(())
}

fn port_in_use() -> bool {
    let addr: SocketAddr = format!("{PREVIEW_HOST}:{PREVIEW_PORT}")
        .parse()
        .expect("static address is valid");
    TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok()
}

/// Kill any process currently bound to PREVIEW_PORT and wait for it to release
/// the port before returning.  This handles leftover Jekyll processes from
/// previous app sessions that are no longer tracked by ACTIVE_JEKYLL.
fn ensure_port_free() -> Result<(), String> {
    if !port_in_use() {
        return Ok(());
    }

    log_preview(&format!(
        "port {PREVIEW_PORT} is already in use — killing occupying process"
    ));

    // fuser -k sends SIGKILL to every process bound to the port.
    let _ = Command::new("bash")
        .args([
            "-c",
            &format!("fuser -k {PREVIEW_PORT}/tcp 2>/dev/null || true"),
        ])
        .status();

    // Wait up to 5 s for the port to be released.
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        thread::sleep(Duration::from_millis(200));
        if !port_in_use() {
            log_preview("port is now free");
            return Ok(());
        }
    }

    Err(format!(
        "Port {PREVIEW_PORT} is still in use after attempting to free it. \
         Kill the process manually and try again."
    ))
}

fn shell_command_exists(name: &str) -> bool {
    Command::new("bash")
        .args(["-l", "-c", &format!("command -v {name} >/dev/null 2>&1")])
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn bundle_install(repo_path: &Path) -> Result<(), String> {
    log_preview("running bundle install");
    let status = Command::new("bash")
        .args(["-l", "-c", "bundle install"])
        .current_dir(repo_path)
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .map_err(|err| format!("failed to run bundle install: {err}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "bundle install failed (status: {status}). \
             Check your Gemfile and Ruby installation."
        ))
    }
}

fn start_jekyll_process(repo_path: &Path) -> Result<Child, String> {
    let gemfile_exists = repo_path.join("Gemfile").exists();
    let use_bundle = gemfile_exists && shell_command_exists("bundle");
    let has_jekyll = shell_command_exists("jekyll");

    if !use_bundle && !has_jekyll {
        return Err(
            "Jekyll is not installed. Install Ruby/Jekyll (or Bundler with a Gemfile) to use Full Preview."
                .to_string(),
        );
    }

    if use_bundle {
        bundle_install(repo_path)?;
    }

    ensure_port_free()?;

    let jekyll_args = format!(
        "serve --host {PREVIEW_HOST} --port {PREVIEW_PORT} --baseurl \"\" --drafts --livereload"
    );
    let shell_cmd = if use_bundle {
        format!("bundle exec jekyll {jekyll_args}")
    } else {
        format!("jekyll {jekyll_args}")
    };

    log_preview(&format!("shell command: {shell_cmd}"));

    Command::new("bash")
        .args(["-l", "-c", &shell_cmd])
        .current_dir(repo_path)
        .stdout(Stdio::null())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|err| format!("failed to launch Jekyll preview process: {err}"))
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
                    return Ok(PREVIEW_URL.to_string());
                }
            }

            let _ = kill_process(&mut state.child);
            *active = None;
        }
    }

    log_preview(&format!("starting Jekyll for {}", repo_path.to_string_lossy()));
    let mut child = start_jekyll_process(&repo_path)?;

    match wait_for_preview_ready(&mut child) {
        Ok(_) => {
            let mut active = ACTIVE_JEKYLL
                .lock()
                .map_err(|_| "failed to lock preview state".to_string())?;
            *active = Some(ActiveJekyll { child, repo_path });
            log_preview("Jekyll preview ready");
            Ok(PREVIEW_URL.to_string())
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
    fn preview_url_constant_matches_expected() {
        assert_eq!(PREVIEW_URL, "http://127.0.0.1:4000");
    }

    #[test]
    fn stop_without_active_process_is_ok() {
        stop_jekyll().expect("stop should succeed without an active process");
    }
}
