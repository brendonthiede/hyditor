use base64::{engine::general_purpose, Engine as _};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

#[derive(Debug, Serialize)]
pub struct TreeEntry {
    pub path: String,
    pub is_dir: bool,
}

fn validate_scoped_path(path: &Path) -> Result<PathBuf, String> {
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("failed to resolve path: {e}"))?;
    Ok(canonical)
}

#[tauri::command]
pub fn read_tree(repo_path: String) -> Result<Vec<TreeEntry>, String> {
    let repo = validate_scoped_path(Path::new(&repo_path))?;
    let mut entries = Vec::new();

    for entry in WalkDir::new(&repo)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            e.file_name()
                .to_str()
                .map(|s| !matches!(s, ".git" | ".github" | ".vscode"))
                .unwrap_or(true)
        })
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if path == repo {
            continue;
        }
        let relative = path
            .strip_prefix(&repo)
            .map_err(|e| format!("strip prefix failed: {e}"))?
            .to_string_lossy()
            .replace('\\', "/");
        entries.push(TreeEntry {
            path: relative,
            is_dir: entry.file_type().is_dir(),
        });
    }

    Ok(entries)
}

#[tauri::command]
pub fn read_file_scoped(path: String) -> Result<String, String> {
    let path = validate_scoped_path(Path::new(&path))?;
    fs::read_to_string(path).map_err(|e| format!("failed to read file: {e}"))
}

#[tauri::command]
pub fn read_file_base64(path: String) -> Result<String, String> {
    let path = validate_scoped_path(Path::new(&path))?;
    let bytes = fs::read(&path).map_err(|e| format!("failed to read file: {e}"))?;
    Ok(general_purpose::STANDARD.encode(&bytes))
}

#[tauri::command]
pub fn export_file(src_path: String, dest_path: String) -> Result<(), String> {
    let src = std::path::Path::new(&src_path);
    let dest = std::path::Path::new(&dest_path);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("failed to create destination directory: {e}"))?;
    }
    fs::copy(src, dest).map_err(|e| format!("failed to export file: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn copy_file_into_repo(src_path: String, dest_dir: String) -> Result<String, String> {
    let src = std::path::Path::new(&src_path);
    let file_name = src
        .file_name()
        .ok_or_else(|| "source path has no file name".to_string())?;
    let dest = std::path::Path::new(&dest_dir).join(file_name);
    fs::copy(src, &dest).map_err(|e| format!("failed to copy file: {e}"))?;
    Ok(file_name.to_string_lossy().to_string())
}

#[tauri::command]
pub fn write_file_scoped(path: String, content: String) -> Result<(), String> {
    let target = PathBuf::from(path);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("failed to create parent dirs: {e}"))?;
    }
    fs::write(target, content).map_err(|e| format!("failed to write file: {e}"))
}

#[derive(Debug, Serialize, Clone)]
pub struct SearchMatch {
    pub line: usize,
    pub content: String,
}

#[derive(Debug, Serialize)]
pub struct FileSearchResult {
    pub file: String,
    pub matches: Vec<SearchMatch>,
}

/// File extensions treated as binary – skipped during content search.
const BINARY_EXTS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "ico", "webp", "bmp", "tiff", "avif",
    "woff", "woff2", "ttf", "eot", "otf",
    "zip", "tar", "gz", "bz2", "br", "7z", "rar",
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
    "exe", "bin", "o", "so", "dylib", "a",
    "mp4", "mp3", "mov", "avi", "wav", "ogg", "flac", "mid",
    "pyc", "class", "wasm",
];

/// Maximum total matched lines returned across all files.
const MAX_TOTAL_MATCHES: usize = 500;

/// Maximum single-file size (bytes) eligible for content search (1 MiB).
const MAX_FILE_BYTES: u64 = 1_048_576;

/// Search all text files under `repo_path` for lines containing `query`
/// (case-insensitive).  Returns up to `MAX_TOTAL_MATCHES` matched lines
/// grouped by file.
#[tauri::command]
pub fn search_repo_files(repo_path: String, query: String) -> Result<Vec<FileSearchResult>, String> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return Ok(vec![]);
    }

    let repo = validate_scoped_path(Path::new(&repo_path))?;
    let mut results: Vec<FileSearchResult> = Vec::new();
    let mut total = 0usize;

    'walk: for entry in WalkDir::new(&repo)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            e.file_name()
                .to_str()
                .map(|s| !matches!(s, ".git" | ".github" | ".vscode"))
                .unwrap_or(true)
        })
        .filter_map(|e| e.ok())
    {
        if entry.file_type().is_dir() {
            continue;
        }

        let path = entry.path();

        // Skip known-binary extensions
        let is_binary = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|ext| BINARY_EXTS.contains(&ext.to_lowercase().as_str()))
            .unwrap_or(false);
        if is_binary {
            continue;
        }

        // Skip files larger than the limit
        if entry.metadata().map(|m| m.len()).unwrap_or(0) > MAX_FILE_BYTES {
            continue;
        }

        // Skip non-UTF-8 files silently
        let text = match fs::read_to_string(path) {
            Ok(t) => t,
            Err(_) => continue,
        };

        let relative = path
            .strip_prefix(&repo)
            .map_err(|e| format!("strip prefix failed: {e}"))?
            .to_string_lossy()
            .replace('\\', "/");

        let file_matches: Vec<SearchMatch> = text
            .lines()
            .enumerate()
            .filter(|(_, line)| line.to_lowercase().contains(&q))
            .map(|(i, line)| SearchMatch {
                line: i + 1,
                content: line.trim_end().to_string(),
            })
            .collect();

        if !file_matches.is_empty() {
            total += file_matches.len();
            results.push(FileSearchResult {
                file: relative,
                matches: file_matches,
            });
            if total >= MAX_TOTAL_MATCHES {
                break 'walk;
            }
        }
    }

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn validate_scoped_path_rejects_nonexistent_path() {
        let result = validate_scoped_path(Path::new("/definitely/not/a/real/path"));
        assert!(result.is_err());
    }

    #[test]
    fn read_tree_returns_nested_entries() {
        let root = tempdir().expect("temp dir should be created");
        let nested_dir = root.path().join("_posts");
        fs::create_dir_all(&nested_dir).expect("nested dir should be created");
        fs::write(nested_dir.join("entry.md"), "# test").expect("test file should be written");

        let entries = read_tree(root.path().to_string_lossy().to_string()).expect("tree should be read");
        let paths: Vec<String> = entries.into_iter().map(|entry| entry.path).collect();

        assert!(paths.contains(&"_posts".to_string()));
        assert!(paths.contains(&"_posts/entry.md".to_string()));
    }

    #[test]
    fn read_tree_excludes_dot_git_directory() {
        let root = tempdir().expect("temp dir should be created");
        let git_dir = root.path().join(".git");
        fs::create_dir_all(git_dir.join("objects")).expect(".git/objects should be created");
        fs::write(git_dir.join("HEAD"), "ref: refs/heads/main").expect("HEAD should be written");
        fs::write(git_dir.join("objects/pack"), "").expect("pack file should be written");
        let posts_dir = root.path().join("_posts");
        fs::create_dir_all(&posts_dir).expect("_posts should be created");
        fs::write(posts_dir.join("entry.md"), "# test").expect("entry should be written");

        let entries = read_tree(root.path().to_string_lossy().to_string()).expect("tree should be read");
        let paths: Vec<String> = entries.iter().map(|e| e.path.clone()).collect();

        assert!(paths.contains(&"_posts".to_string()));
        assert!(paths.contains(&"_posts/entry.md".to_string()));
        assert!(!paths.iter().any(|p| p.starts_with(".git")), "no .git entries should appear: {:?}", paths);
    }

    #[test]
    fn read_tree_excludes_dot_github_and_dot_vscode_directories() {
        let root = tempdir().expect("temp dir should be created");
        // Create directories that should be excluded
        fs::create_dir_all(root.path().join(".github").join("workflows")).expect(".github/workflows should be created");
        fs::write(root.path().join(".github").join("workflows").join("ci.yml"), "").expect("ci.yml should be written");
        fs::create_dir_all(root.path().join(".vscode")).expect(".vscode should be created");
        fs::write(root.path().join(".vscode").join("settings.json"), "{}").expect("settings.json should be written");
        // Create a normal post that should be included
        let posts_dir = root.path().join("_posts");
        fs::create_dir_all(&posts_dir).expect("_posts should be created");
        fs::write(posts_dir.join("entry.md"), "# test").expect("entry should be written");

        let entries = read_tree(root.path().to_string_lossy().to_string()).expect("tree should be read");
        let paths: Vec<String> = entries.iter().map(|e| e.path.clone()).collect();

        assert!(paths.contains(&"_posts".to_string()), "_posts should be present");
        assert!(!paths.iter().any(|p| p.starts_with(".github")), "no .github entries should appear: {:?}", paths);
        assert!(!paths.iter().any(|p| p.starts_with(".vscode")), "no .vscode entries should appear: {:?}", paths);
    }

    #[test]
    fn write_then_read_file_roundtrip_works() {
        let root = tempdir().expect("temp dir should be created");
        let file_path = root.path().join("notes").join("draft.md");
        let content = "hello hyditor".to_string();

        write_file_scoped(file_path.to_string_lossy().to_string(), content.clone())
            .expect("write should succeed");
        let read = read_file_scoped(file_path.to_string_lossy().to_string()).expect("read should succeed");

        assert_eq!(read, content);
    }

    // --- search_repo_files ---

    #[test]
    fn search_repo_files_empty_query_returns_empty() {
        let root = tempdir().expect("temp dir should be created");
        fs::write(root.path().join("file.md"), "hello world").expect("write should succeed");

        let results = search_repo_files(root.path().to_string_lossy().to_string(), "".to_string())
            .expect("search should succeed");
        assert!(results.is_empty(), "empty query should return no results");
    }

    #[test]
    fn search_repo_files_whitespace_query_returns_empty() {
        let root = tempdir().expect("temp dir should be created");
        fs::write(root.path().join("file.md"), "hello world").expect("write should succeed");

        let results = search_repo_files(root.path().to_string_lossy().to_string(), "   ".to_string())
            .expect("search should succeed");
        assert!(results.is_empty(), "whitespace query should return no results");
    }

    #[test]
    fn search_repo_files_finds_matching_line() {
        let root = tempdir().expect("temp dir should be created");
        fs::write(root.path().join("page.md"), "line one\nHello World\nline three")
            .expect("write should succeed");

        let results = search_repo_files(root.path().to_string_lossy().to_string(), "hello".to_string())
            .expect("search should succeed");

        assert_eq!(results.len(), 1, "should find one file");
        assert_eq!(results[0].file, "page.md");
        assert_eq!(results[0].matches.len(), 1, "should find one matching line");
        assert_eq!(results[0].matches[0].line, 2);
        assert_eq!(results[0].matches[0].content, "Hello World");
    }

    #[test]
    fn search_repo_files_is_case_insensitive() {
        let root = tempdir().expect("temp dir should be created");
        fs::write(root.path().join("doc.md"), "HYDITOR is great").expect("write should succeed");

        let results = search_repo_files(root.path().to_string_lossy().to_string(), "hyditor".to_string())
            .expect("search should succeed");

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].matches[0].content, "HYDITOR is great");
    }

    #[test]
    fn search_repo_files_skips_binary_extensions() {
        let root = tempdir().expect("temp dir should be created");
        fs::write(root.path().join("image.png"), "findme inside binary").expect("write should succeed");
        fs::write(root.path().join("doc.md"), "findme in markdown").expect("write should succeed");

        let results = search_repo_files(root.path().to_string_lossy().to_string(), "findme".to_string())
            .expect("search should succeed");

        assert_eq!(results.len(), 1, "should only find the markdown file");
        assert_eq!(results[0].file, "doc.md");
    }

    #[test]
    fn search_repo_files_skips_dot_git_directory() {
        let root = tempdir().expect("temp dir should be created");
        let git_dir = root.path().join(".git");
        fs::create_dir_all(&git_dir).expect("create dir should succeed");
        fs::write(git_dir.join("config"), "findme in git config").expect("write should succeed");
        fs::write(root.path().join("readme.md"), "findme in readme").expect("write should succeed");

        let results = search_repo_files(root.path().to_string_lossy().to_string(), "findme".to_string())
            .expect("search should succeed");

        assert_eq!(results.len(), 1, "should not search .git directory");
        assert_eq!(results[0].file, "readme.md");
    }

    #[test]
    fn search_repo_files_finds_multiple_matches_across_files() {
        let root = tempdir().expect("temp dir should be created");
        let sub = root.path().join("posts");
        fs::create_dir_all(&sub).expect("create dir should succeed");
        fs::write(root.path().join("a.md"), "target word here").expect("write should succeed");
        fs::write(sub.join("b.md"), "another target line\nno match\ntarget again")
            .expect("write should succeed");

        let results = search_repo_files(root.path().to_string_lossy().to_string(), "target".to_string())
            .expect("search should succeed");

        assert_eq!(results.len(), 2, "should find matches in two files");
        let total_matches: usize = results.iter().map(|r| r.matches.len()).sum();
        assert_eq!(total_matches, 3, "should find 3 total matching lines");
    }

    #[test]
    fn search_repo_files_reports_correct_line_numbers() {
        let root = tempdir().expect("temp dir should be created");
        fs::write(root.path().join("test.txt"), "no\nno\nyes match\nno\nyes another match")
            .expect("write should succeed");

        let results = search_repo_files(root.path().to_string_lossy().to_string(), "yes".to_string())
            .expect("search should succeed");

        assert_eq!(results.len(), 1);
        let lines: Vec<usize> = results[0].matches.iter().map(|m| m.line).collect();
        assert_eq!(lines, vec![3, 5], "line numbers should be 1-based");
    }
}
