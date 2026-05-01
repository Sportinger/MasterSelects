//! Cross-platform utility functions

use std::path::{Path, PathBuf};

/// Apply CREATE_NO_WINDOW flag on Windows to prevent terminal popups.
/// Call this on any `tokio::process::Command` before `.output()` or `.spawn()`.
#[cfg(windows)]
pub fn no_window(cmd: &mut tokio::process::Command) -> &mut tokio::process::Command {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x08000000)
}

#[cfg(not(windows))]
pub fn no_window(cmd: &mut tokio::process::Command) -> &mut tokio::process::Command {
    cmd
}

/// Apply CREATE_NO_WINDOW flag on Windows for std::process::Command.
#[cfg(windows)]
pub fn no_window_std(cmd: &mut std::process::Command) -> &mut std::process::Command {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x08000000)
}

#[cfg(not(windows))]
pub fn no_window_std(cmd: &mut std::process::Command) -> &mut std::process::Command {
    cmd
}

/// Get the default download directory for videos
pub fn get_download_dir() -> PathBuf {
    let base = std::env::temp_dir();
    base.join("masterselects-downloads")
}

/// Get the default project root directory
/// Can be overridden via MASTERSELECTS_PROJECT_ROOT env var
pub fn get_project_root() -> PathBuf {
    if let Ok(custom) = std::env::var("MASTERSELECTS_PROJECT_ROOT") {
        let p = PathBuf::from(custom);
        if p.is_absolute() {
            return p;
        }
    }

    if let Some(docs) = dirs::document_dir() {
        return docs.join("MasterSelects");
    }

    // Fallback: home directory
    if let Some(home) = dirs::home_dir() {
        return home.join("MasterSelects");
    }

    PathBuf::from("MasterSelects")
}

/// Get allowed file serving prefixes (for security)
pub fn get_allowed_prefixes() -> Vec<PathBuf> {
    let mut prefixes = Vec::new();

    // User's Downloads folder (cross-platform)
    if let Some(downloads) = dirs::download_dir() {
        prefixes.push(downloads);
    }

    // Temp directory
    prefixes.push(std::env::temp_dir());

    // On Unix, also allow /tmp explicitly
    #[cfg(unix)]
    {
        prefixes.push(PathBuf::from("/tmp"));
    }

    // Documents directory (for project persistence)
    if let Some(docs) = dirs::document_dir() {
        prefixes.push(docs);
    }

    // MasterSelects project root (may be custom via env var)
    let project_root = get_project_root();
    if !prefixes.iter().any(|p| project_root.starts_with(p)) {
        prefixes.push(project_root);
    }

    // User's Videos folder (for media file serving)
    if let Some(videos) = dirs::video_dir() {
        prefixes.push(videos);
    }

    // User's Desktop (drag & drop sources)
    if let Some(desktop) = dirs::desktop_dir() {
        prefixes.push(desktop);
    }

    // NOTE: Home directory fallback intentionally removed for security.
    // Only explicit, scoped directories are allowed.

    prefixes
}

/// Check if a path contains path traversal segments
fn has_traversal_segments(path: &std::path::Path) -> bool {
    for component in path.components() {
        if let std::path::Component::ParentDir = component {
            return true;
        }
    }
    // Also check the raw string for encoded or sneaky ".." patterns
    let path_str = path.to_string_lossy();
    path_str.contains("..")
}

#[cfg(windows)]
fn normalized_components(path: &Path) -> Vec<String> {
    path.components()
        .map(|component| component.as_os_str().to_string_lossy().to_lowercase())
        .collect()
}

#[cfg(not(windows))]
fn normalized_components(path: &Path) -> Vec<String> {
    path.components()
        .map(|component| component.as_os_str().to_string_lossy().into_owned())
        .collect()
}

fn path_is_within_allowed_prefix(path: &Path, prefix: &Path) -> bool {
    let path_components = normalized_components(path);
    let prefix_components = normalized_components(prefix);

    path_components.len() >= prefix_components.len()
        && path_components
            .iter()
            .zip(prefix_components.iter())
            .all(|(path_component, prefix_component)| path_component == prefix_component)
}

fn canonicalize_existing_ancestor(path: &Path) -> Option<PathBuf> {
    if let Ok(canonical) = path.canonicalize() {
        return Some(canonical);
    }

    for ancestor in path.ancestors().skip(1) {
        if let Ok(canonical_ancestor) = ancestor.canonicalize() {
            let suffix = path.strip_prefix(ancestor).ok()?;
            return Some(canonical_ancestor.join(suffix));
        }
    }

    None
}

/// Check if a path is within allowed directories.
///
/// Rejects paths with `..` traversal segments and attempts path canonicalization
/// to prevent symlink or alias-based escapes. For new files or directories, it
/// canonicalizes the nearest existing ancestor and appends the missing suffix so
/// project roots can be created lazily under approved parent folders.
pub fn is_path_allowed_with_extra(path: &std::path::Path, extra_prefixes: &[PathBuf]) -> bool {
    if !path.is_absolute() {
        return false;
    }

    // Reject any path with traversal segments
    if has_traversal_segments(path) {
        return false;
    }

    let mut allowed = get_allowed_prefixes();
    allowed.extend(extra_prefixes.iter().cloned());

    let effective_path = match canonicalize_existing_ancestor(path) {
        Some(canonical) => canonical,
        None => return false,
    };

    allowed.iter().any(|prefix| {
        let prefix_canonical = canonicalize_existing_ancestor(prefix).unwrap_or_else(|| prefix.clone());
        path_is_within_allowed_prefix(&effective_path, &prefix_canonical)
    })
}

pub fn is_path_allowed(path: &std::path::Path) -> bool {
    is_path_allowed_with_extra(path, &[])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_allowed_path_in_project_root() {
        let project_root = get_project_root();
        let test_path = project_root.join("test-project").join("data.json");
        // The path is under the project root, which is in the allowed prefixes
        // Since the path doesn't exist, we need to ensure the project root exists first
        // For unit test purposes, verify the prefix matching logic
        let prefixes = get_allowed_prefixes();
        let is_under_prefix = prefixes.iter().any(|p| test_path.starts_with(p));
        assert!(is_under_prefix, "Project root path should be under an allowed prefix");
    }

    #[test]
    fn test_allowed_path_in_download_dir() {
        let download_dir = get_download_dir();
        let test_path = download_dir.join("video.mp4");
        // Downloads dir is under temp, which is always allowed
        let prefixes = get_allowed_prefixes();
        let is_under_prefix = prefixes.iter().any(|p| test_path.starts_with(p));
        assert!(is_under_prefix, "Download dir path should be under an allowed prefix");
    }

    #[test]
    fn test_rejected_path_home_root() {
        // After removing the home directory fallback, a bare path under home
        // that isn't in Downloads/Documents/Desktop/Videos should be rejected
        if let Some(home) = dirs::home_dir() {
            let prefixes = get_allowed_prefixes();
            let home_in_prefixes = prefixes.iter().any(|p| p == &home);
            assert!(!home_in_prefixes, "Home directory should not be in allowed prefixes");
        }
    }

    #[test]
    fn test_rejected_path_system() {
        #[cfg(windows)]
        {
            let system_path = Path::new("C:\\Windows\\System32\\cmd.exe");
            assert!(!is_path_allowed(system_path), "System paths should be rejected");
        }

        #[cfg(unix)]
        {
            let system_path = Path::new("/etc/passwd");
            assert!(!is_path_allowed(system_path), "System paths should be rejected");
        }
    }

    #[test]
    fn test_rejected_path_traversal() {
        let download_dir = get_download_dir();
        let traversal_path = download_dir.join("..").join("..").join("etc").join("passwd");
        assert!(has_traversal_segments(&traversal_path), "Path with .. should be detected as traversal");
        assert!(!is_path_allowed(&traversal_path), "Paths with traversal should be rejected");
    }

    #[test]
    fn test_path_normalization_windows() {
        // Test that forward slashes work correctly (frontend sends forward slashes)
        let download_dir = get_download_dir();
        std::fs::create_dir_all(&download_dir).expect("download dir should be creatable for test");
        let download_str = download_dir.to_string_lossy().replace('\\', "/");
        let forward_slash_path = PathBuf::from(format!("{}/test-video.mp4", download_str));

        // The path should contain forward slashes
        assert!(forward_slash_path.to_string_lossy().contains('/') || cfg!(not(windows)),
            "Test path should use forward slashes on Windows");

        assert!(is_path_allowed(&forward_slash_path), "Forward-slash paths should match allowed prefixes");
    }

    #[test]
    fn test_rejected_sibling_prefix_path() {
        let allowed_temp = std::env::temp_dir();
        let parent = allowed_temp.parent().expect("temp dir should have a parent");
        let base_name = allowed_temp
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("tmp");
        let sibling_dir = parent.join(format!(
            "{}-masterselects-security-test-{}",
            base_name,
            std::process::id()
        ));
        let sibling_path = sibling_dir.join("escape.txt");

        // Skip test if CI environment doesn't allow writing to temp dir's parent
        if std::fs::create_dir_all(&sibling_dir).is_err() {
            eprintln!("Skipping test: no write access to parent of temp dir");
            return;
        }
        if std::fs::write(&sibling_path, b"test").is_err() {
            let _ = std::fs::remove_dir_all(&sibling_dir);
            eprintln!("Skipping test: cannot write test file in sibling dir");
            return;
        }

        assert!(
            !is_path_allowed(&sibling_path),
            "Sibling paths that only share a string prefix must be rejected"
        );

        let _ = std::fs::remove_file(&sibling_path);
        let _ = std::fs::remove_dir_all(&sibling_dir);
    }

    #[test]
    fn test_allowed_nonexistent_project_dir_under_documents() {
        if let Some(docs) = dirs::document_dir() {
            let test_path = docs
                .join(format!("masterselects-missing-{}", std::process::id()))
                .join("Untitled")
                .join("project.json");

            assert!(!test_path.exists(), "test path should not already exist");
            assert!(
                is_path_allowed(&test_path),
                "new project paths under Documents should be allowed before the project folder exists"
            );
        }
    }

    #[test]
    fn test_allowed_by_extra_picked_root() {
        if let Some(home) = dirs::home_dir() {
            let picked_root = home.join(format!("masterselects-picked-{}", std::process::id()));
            let test_path = picked_root.join("project.json");

            assert!(
                !is_path_allowed(&test_path),
                "picked root should not be statically allowed before it is granted"
            );
            assert!(
                is_path_allowed_with_extra(&test_path, &[picked_root]),
                "paths under a user-picked root should be allowed"
            );
        }
    }
}
