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
                .map(|s| s != ".git")
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
            .to_string();
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
pub fn write_file_scoped(path: String, content: String) -> Result<(), String> {
    let target = PathBuf::from(path);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("failed to create parent dirs: {e}"))?;
    }
    fs::write(target, content).map_err(|e| format!("failed to write file: {e}"))
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
    fn write_then_read_file_roundtrip_works() {
        let root = tempdir().expect("temp dir should be created");
        let file_path = root.path().join("notes").join("draft.md");
        let content = "hello hyditor".to_string();

        write_file_scoped(file_path.to_string_lossy().to_string(), content.clone())
            .expect("write should succeed");
        let read = read_file_scoped(file_path.to_string_lossy().to_string()).expect("read should succeed");

        assert_eq!(read, content);
    }
}
