//! Cross-platform utility functions

use std::path::PathBuf;

/// Get the default download directory for YouTube videos
/// - Windows: %TEMP%\masterselects-downloads
/// - Linux/Mac: /tmp/masterselects-downloads
pub fn get_download_dir() -> PathBuf {
    let base = if cfg!(windows) {
        std::env::temp_dir()
    } else {
        PathBuf::from("/tmp")
    };
    base.join("masterselects-downloads")
}

/// Get allowed file serving prefixes (for security)
/// Returns paths that are allowed for file serving via HTTP and WebSocket
pub fn get_allowed_prefixes() -> Vec<PathBuf> {
    let mut prefixes = Vec::new();

    // User's Downloads folder (cross-platform)
    if let Some(downloads) = dirs::download_dir() {
        prefixes.push(downloads);
    }

    // Temp directory (platform-specific)
    if cfg!(windows) {
        prefixes.push(std::env::temp_dir());
    } else {
        prefixes.push(PathBuf::from("/tmp"));
    }

    prefixes
}

/// Check if a path is within allowed directories
pub fn is_path_allowed(path: &std::path::Path) -> bool {
    let allowed = get_allowed_prefixes();
    let path_str = path.to_string_lossy();

    allowed.iter().any(|prefix| {
        let prefix_str = prefix.to_string_lossy();
        path_str.starts_with(prefix_str.as_ref())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_download_dir_exists_after_creation() {
        let dir = get_download_dir();
        std::fs::create_dir_all(&dir).expect("Failed to create download dir");
        assert!(dir.exists());
    }

    #[test]
    fn test_allowed_prefixes_not_empty() {
        let prefixes = get_allowed_prefixes();
        assert!(!prefixes.is_empty());
    }
}
