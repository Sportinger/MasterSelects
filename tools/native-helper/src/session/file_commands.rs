//! Allowed-path file discovery and mutation commands.

use std::path::PathBuf;

use tracing::{debug, info};

use super::Session;
use crate::protocol::{error_codes, Response};
use crate::utils;

impl Session {
    pub(super) fn handle_locate(
        &self,
        id: &str,
        filename: &str,
        extra_dirs: &[String],
    ) -> Response {
        // Sanitize filename: reject path traversal attempts
        if filename.contains('/') || filename.contains('\\') || filename.contains("..") {
            return Response::error(
                id,
                error_codes::INVALID_PATH,
                "Filename must not contain path separators",
            );
        }

        // Build list of directories to search
        let mut search_dirs: Vec<PathBuf> = Vec::new();

        // Add extra dirs first (highest priority), but only if they are already
        // within the helper's allowed directory policy.
        for dir in extra_dirs {
            let p = PathBuf::from(dir);
            if p.is_absolute() && p.is_dir() && self.state.is_path_allowed(&p) {
                search_dirs.push(p);
            }
        }

        // Search only within explicitly allowed helper roots.
        for dir in utils::get_allowed_prefixes() {
            if dir.is_dir() {
                search_dirs.push(dir);
            }
        }

        // Search each directory recursively (max depth 4 to avoid long scans)
        for dir in &search_dirs {
            if let Some(path) = Self::find_file_recursive(dir, filename, 0, 4) {
                info!("Located file '{}' at {}", filename, path.display());
                return Response::ok(
                    id,
                    serde_json::json!({
                        "found": true,
                        "path": path.to_string_lossy()
                    }),
                );
            }
        }

        debug!(
            "File '{}' not found in {} directories",
            filename,
            search_dirs.len()
        );
        Response::ok(
            id,
            serde_json::json!({
                "found": false,
                "searched": search_dirs.iter().map(|d| d.to_string_lossy().to_string()).collect::<Vec<_>>()
            }),
        )
    }

    /// Recursively search for a file by name, up to max_depth levels deep.
    fn find_file_recursive(
        dir: &std::path::Path,
        filename: &str,
        depth: u32,
        max_depth: u32,
    ) -> Option<PathBuf> {
        // Check direct child first
        let candidate = dir.join(filename);
        if candidate.is_file() {
            return Some(candidate);
        }

        // Recurse into subdirectories
        if depth >= max_depth {
            return None;
        }

        let entries = match std::fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => return None,
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                // Skip hidden directories and system directories
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if name.starts_with('.')
                        || name == "node_modules"
                        || name == "$RECYCLE.BIN"
                        || name == "System Volume Information"
                    {
                        continue;
                    }
                }
                if let Some(found) =
                    Self::find_file_recursive(&path, filename, depth + 1, max_depth)
                {
                    return Some(found);
                }
            }
        }

        None
    }

    pub(super) fn handle_get_file(&self, id: &str, path: &str) -> Response {
        use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};

        let path = std::path::Path::new(path);

        if !path.is_absolute() {
            return Response::error(id, error_codes::INVALID_PATH, "Path must be absolute");
        }

        if !self.state.is_path_allowed(path) {
            return Response::error(
                id,
                error_codes::PERMISSION_DENIED,
                "File path not in allowed directory",
            );
        }

        if !path.exists() {
            return Response::error(
                id,
                error_codes::FILE_NOT_FOUND,
                format!("File not found: {}", path.display()),
            );
        }

        match std::fs::read(path) {
            Ok(data) => {
                info!("Serving file: {} ({} bytes)", path.display(), data.len());
                let data_base64 = BASE64.encode(&data);
                Response::ok(
                    id,
                    serde_json::json!({
                        "size": data.len(),
                        "path": path.display().to_string(),
                        "data": data_base64
                    }),
                )
            }
            Err(e) => Response::error(
                id,
                error_codes::FILE_NOT_FOUND,
                format!("Cannot read file: {}", e),
            ),
        }
    }

    // ── File System Command Handlers ──

    pub(super) fn handle_write_file(
        &self,
        id: &str,
        path: &str,
        data: &str,
        encoding: Option<&str>,
    ) -> Response {
        let path = std::path::Path::new(path);

        if !path.is_absolute() {
            return Response::error(id, error_codes::INVALID_PATH, "Path must be absolute");
        }

        if !self.state.is_path_allowed(path) {
            return Response::error(
                id,
                error_codes::PERMISSION_DENIED,
                "Path not in allowed directory",
            );
        }

        // Ensure parent directory exists
        if let Some(parent) = path.parent() {
            if !parent.exists() {
                if let Err(e) = std::fs::create_dir_all(parent) {
                    return Response::error(
                        id,
                        error_codes::WRITE_FAILED,
                        format!("Cannot create parent dirs: {}", e),
                    );
                }
            }
        }

        // Decode data
        let bytes = match encoding.unwrap_or("utf8") {
            "base64" => {
                use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
                match BASE64.decode(data) {
                    Ok(b) => b,
                    Err(e) => {
                        return Response::error(
                            id,
                            error_codes::INVALID_PATH,
                            format!("Invalid base64: {}", e),
                        )
                    }
                }
            }
            _ => data.as_bytes().to_vec(),
        };

        let size = bytes.len();

        // Atomic write: write to .tmp then rename
        let tmp_path = path.with_extension(format!(
            "{}.tmp",
            path.extension()
                .map(|e| e.to_string_lossy().to_string())
                .unwrap_or_default()
        ));

        if let Err(e) = std::fs::write(&tmp_path, &bytes) {
            return Response::error(
                id,
                error_codes::WRITE_FAILED,
                format!("Write failed: {}", e),
            );
        }

        if let Err(e) = std::fs::rename(&tmp_path, path) {
            // Rename failed — try direct write as fallback
            let _ = std::fs::remove_file(&tmp_path);
            if let Err(e2) = std::fs::write(path, &bytes) {
                return Response::error(
                    id,
                    error_codes::WRITE_FAILED,
                    format!("Write failed: {} / {}", e, e2),
                );
            }
        }

        info!("Wrote file: {} ({} bytes)", path.display(), size);
        Response::ok(id, serde_json::json!({ "written": true, "size": size }))
    }

    pub(super) fn handle_create_dir(&self, id: &str, path: &str, recursive: bool) -> Response {
        let path = std::path::Path::new(path);

        if !path.is_absolute() {
            return Response::error(id, error_codes::INVALID_PATH, "Path must be absolute");
        }

        if !self.state.is_path_allowed(path) {
            return Response::error(
                id,
                error_codes::PERMISSION_DENIED,
                "Path not in allowed directory",
            );
        }

        if path.exists() {
            if path.is_dir() {
                return Response::ok(id, serde_json::json!({ "created": true, "existed": true }));
            }
            return Response::error(
                id,
                error_codes::ALREADY_EXISTS,
                "A file exists at this path",
            );
        }

        let result = if recursive {
            std::fs::create_dir_all(path)
        } else {
            std::fs::create_dir(path)
        };

        match result {
            Ok(()) => {
                info!("Created directory: {}", path.display());
                Response::ok(id, serde_json::json!({ "created": true, "existed": false }))
            }
            Err(e) => Response::error(
                id,
                error_codes::WRITE_FAILED,
                format!("Cannot create directory: {}", e),
            ),
        }
    }

    pub(super) fn handle_list_dir(&self, id: &str, path: &str) -> Response {
        let path = std::path::Path::new(path);

        if !path.is_absolute() {
            return Response::error(id, error_codes::INVALID_PATH, "Path must be absolute");
        }

        if !self.state.is_path_allowed(path) {
            return Response::error(
                id,
                error_codes::PERMISSION_DENIED,
                "Path not in allowed directory",
            );
        }

        if !path.exists() || !path.is_dir() {
            return Response::error(id, error_codes::FILE_NOT_FOUND, "Directory not found");
        }

        let entries = match std::fs::read_dir(path) {
            Ok(e) => e,
            Err(e) => {
                return Response::error(
                    id,
                    error_codes::INTERNAL_ERROR,
                    format!("Cannot read directory: {}", e),
                )
            }
        };

        let mut items = Vec::new();
        for entry in entries.flatten() {
            let metadata = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };

            let modified = metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);

            items.push(serde_json::json!({
                "name": entry.file_name().to_string_lossy(),
                "kind": if metadata.is_dir() { "directory" } else { "file" },
                "size": metadata.len(),
                "modified": modified,
            }));
        }

        Response::ok(
            id,
            serde_json::json!({ "entries": items, "count": items.len() }),
        )
    }

    pub(super) fn handle_delete(&self, id: &str, path: &str, recursive: bool) -> Response {
        let path = std::path::Path::new(path);

        if !path.is_absolute() {
            return Response::error(id, error_codes::INVALID_PATH, "Path must be absolute");
        }

        if !self.state.is_path_allowed(path) {
            return Response::error(
                id,
                error_codes::PERMISSION_DENIED,
                "Path not in allowed directory",
            );
        }

        if !path.exists() {
            return Response::error(id, error_codes::FILE_NOT_FOUND, "Path not found");
        }

        let result = if path.is_dir() {
            if recursive {
                std::fs::remove_dir_all(path)
            } else {
                std::fs::remove_dir(path)
            }
        } else {
            std::fs::remove_file(path)
        };

        match result {
            Ok(()) => {
                info!("Deleted: {}", path.display());
                Response::ok(id, serde_json::json!({ "deleted": true }))
            }
            Err(e) => {
                let code = if e.kind() == std::io::ErrorKind::Other
                    || e.to_string().contains("not empty")
                {
                    error_codes::DIR_NOT_EMPTY
                } else {
                    error_codes::INTERNAL_ERROR
                };
                Response::error(id, code, format!("Delete failed: {}", e))
            }
        }
    }

    pub(super) fn handle_exists(&self, id: &str, path: &str) -> Response {
        let path = std::path::Path::new(path);

        if !path.is_absolute() {
            return Response::error(id, error_codes::INVALID_PATH, "Path must be absolute");
        }

        if !self.state.is_path_allowed(path) {
            return Response::error(
                id,
                error_codes::PERMISSION_DENIED,
                "Path not in allowed directory",
            );
        }

        let kind = if !path.exists() {
            "none"
        } else if path.is_dir() {
            "directory"
        } else {
            "file"
        };

        Response::ok(
            id,
            serde_json::json!({ "exists": path.exists(), "kind": kind }),
        )
    }

    pub(super) fn handle_rename(&self, id: &str, old_path: &str, new_path: &str) -> Response {
        let old = std::path::Path::new(old_path);
        let new = std::path::Path::new(new_path);

        if !old.is_absolute() || !new.is_absolute() {
            return Response::error(id, error_codes::INVALID_PATH, "Paths must be absolute");
        }

        if !self.state.is_path_allowed(old) || !self.state.is_path_allowed(new) {
            return Response::error(
                id,
                error_codes::PERMISSION_DENIED,
                "Path not in allowed directory",
            );
        }

        if !old.exists() {
            return Response::error(id, error_codes::FILE_NOT_FOUND, "Source path not found");
        }

        if new.exists() {
            return Response::error(
                id,
                error_codes::ALREADY_EXISTS,
                "Destination already exists",
            );
        }

        // Ensure parent of destination exists
        if let Some(parent) = new.parent() {
            if !parent.exists() {
                if let Err(e) = std::fs::create_dir_all(parent) {
                    return Response::error(
                        id,
                        error_codes::WRITE_FAILED,
                        format!("Cannot create parent dirs: {}", e),
                    );
                }
            }
        }

        match std::fs::rename(old, new) {
            Ok(()) => {
                info!("Renamed: {} -> {}", old.display(), new.display());
                Response::ok(id, serde_json::json!({ "renamed": true }))
            }
            Err(e) => Response::error(
                id,
                error_codes::INTERNAL_ERROR,
                format!("Rename failed: {}", e),
            ),
        }
    }
}
