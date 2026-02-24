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

fn command_exists(name: &str) -> bool {
    Command::new("sh")
        .arg("-c")
        .arg(format!("command -v {name} >/dev/null 2>&1"))
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn wait_for_preview_ready() -> Result<(), String> {
    let addr: SocketAddr = format!("{PREVIEW_HOST}:{PREVIEW_PORT}")
        .parse()
        .map_err(|err| format!("invalid preview address: {err}"))?;

    let start = Instant::now();
    while start.elapsed() < PREVIEW_BOOT_TIMEOUT {
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

fn start_jekyll_process(repo_path: &Path) -> Result<Child, String> {
    let gemfile_exists = repo_path.join("Gemfile").exists();
    let use_bundle = gemfile_exists && command_exists("bundle");
    let has_jekyll = command_exists("jekyll");

    if !use_bundle && !has_jekyll {
        return Err(
            "Jekyll is not installed. Install Ruby/Jekyll (or Bundler with a Gemfile) to use Full Preview."
                .to_string(),
        );
    }

    let mut command = if use_bundle {
        let mut cmd = Command::new("bundle");
        cmd.args([
            "exec",
            "jekyll",
            "serve",
            "--host",
            PREVIEW_HOST,
            "--port",
            "4000",
            "--livereload",
        ]);
        cmd
    } else {
        let mut cmd = Command::new("jekyll");
        cmd.args([
            "serve",
            "--host",
            PREVIEW_HOST,
            "--port",
            "4000",
            "--livereload",
        ]);
        cmd
    };

    command
        .current_dir(repo_path)
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    command
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

    match wait_for_preview_ready() {
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
