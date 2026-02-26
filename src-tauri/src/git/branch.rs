use git2::{BranchType, Repository};

#[tauri::command]
pub fn list_branches(repo_path: String) -> Result<Vec<String>, String> {
    let repo = Repository::open(repo_path).map_err(|e| format!("failed to open repo: {e}"))?;
    let mut branches = Vec::new();

    for branch in repo
        .branches(Some(BranchType::Local))
        .map_err(|e| format!("failed to list branches: {e}"))?
    {
        let (branch, _) = branch.map_err(|e| format!("branch parse failed: {e}"))?;
        if let Some(name) = branch.name().map_err(|e| format!("branch name failed: {e}"))? {
            branches.push(name.to_string());
        }
    }

    Ok(branches)
}

#[tauri::command]
pub fn switch_branch(repo_path: String, branch_name: String) -> Result<(), String> {
    let repo = Repository::open(repo_path).map_err(|e| format!("failed to open repo: {e}"))?;
    let reference = format!("refs/heads/{branch_name}");
    repo.set_head(&reference)
        .map_err(|e| format!("failed to set HEAD: {e}"))?;
    repo.checkout_head(None)
        .map_err(|e| format!("failed to checkout branch: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::Signature;
    use std::fs;
    use tempfile::tempdir;

    /// Creates a temp repo with an initial commit so branches can be created.
    fn init_repo_with_commit() -> (tempfile::TempDir, String) {
        let root = tempdir().expect("temp dir should be created");
        let repo = Repository::init(root.path()).expect("repo should be created");

        // Create a file and commit it
        let file_path = root.path().join("README.md");
        fs::write(&file_path, "# Test").expect("file should be written");

        let mut index = repo.index().expect("index should be opened");
        index
            .add_path(std::path::Path::new("README.md"))
            .expect("file should be staged");
        index.write().expect("index should be written");

        let tree_id = index.write_tree().expect("tree should be written");
        let tree = repo.find_tree(tree_id).expect("tree should be found");
        let sig = Signature::now("Test", "test@test.com").expect("signature should be created");

        repo.commit(Some("HEAD"), &sig, &sig, "initial commit", &tree, &[])
            .expect("commit should succeed");

        let path_str = root.path().to_string_lossy().to_string();
        (root, path_str)
    }

    #[test]
    fn list_branches_returns_default_branch() {
        let (_root, path) = init_repo_with_commit();
        let branches = list_branches(path).expect("list should succeed");
        assert!(!branches.is_empty(), "should have at least one branch");
    }

    /// Helper: create a local branch using git2 directly (for test setup only).
    fn create_test_branch(repo_path: &str, name: &str) {
        let repo = Repository::open(repo_path).expect("repo should open");
        let head_commit = repo
            .head()
            .and_then(|h| h.peel_to_commit())
            .expect("HEAD should resolve");
        repo.branch(name, &head_commit, false)
            .expect("branch should be created");
    }

    #[test]
    fn switch_branch_works() {
        let (_root, path) = init_repo_with_commit();
        create_test_branch(&path, "dev");
        switch_branch(path.clone(), "dev".to_string()).expect("switch should succeed");

        let repo = Repository::open(&path).expect("repo should open");
        let head = repo.head().expect("HEAD should resolve");
        assert_eq!(
            head.shorthand().unwrap(),
            "dev",
            "HEAD should point to the new branch"
        );
    }
}
