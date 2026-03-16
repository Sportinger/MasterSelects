//! MatAnyone2 model weight management
//!
//! Downloads model weights from HuggingFace (`PeiqingYang/MatAnyone2`)
//! with streaming progress, resume support, and SHA256 integrity checks.
//!
//! Storage layout:
//! ```text
//! {data_dir}/matanyone2/models/
//! ├── model.safetensors        (~141 MB)
//! ├── model.safetensors.sha256  (hex digest sidecar)
//! ├── config.json
//! └── config.json.sha256
//! ```

use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::time::Instant;

use sha2::{Digest, Sha256};
use tracing::{debug, error, info, warn};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HF_REPO: &str = "PeiqingYang/MatAnyone2";
const HF_BASE_URL: &str = "https://huggingface.co";

const MODEL_FILENAME: &str = "model.safetensors";
const CONFIG_FILENAME: &str = "config.json";

const USER_AGENT: &str = "MasterSelects-Helper";

/// Chunk size for streaming reads (64 KiB — good balance for progress granularity
/// and throughput on typical broadband connections).
const READ_CHUNK_SIZE: usize = 64 * 1024;

/// Minimum interval between progress callback invocations to avoid flooding
/// the caller with updates (100 ms).
const PROGRESS_MIN_INTERVAL_MS: u128 = 100;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Information about the local model state.
#[derive(Debug, Clone)]
pub struct ModelInfo {
    /// Whether both `model.safetensors` and `config.json` are present and valid.
    pub downloaded: bool,
    /// Absolute path to `model.safetensors`, if it exists on disk.
    pub model_path: Option<PathBuf>,
    /// Absolute path to `config.json`, if it exists on disk.
    pub config_path: Option<PathBuf>,
    /// Size in bytes of the model file (from filesystem metadata).
    pub size_bytes: Option<u64>,
}

/// Real-time progress snapshot emitted during a download.
#[derive(Debug, Clone)]
pub struct DownloadProgress {
    /// Bytes received so far (including any previously resumed portion).
    pub bytes_downloaded: u64,
    /// Total content length reported by the server (`Content-Length`).
    pub total_bytes: u64,
    /// Completion percentage in `[0.0, 100.0]`.
    pub percent: f32,
    /// Instantaneous throughput in bytes/second, computed from the most recent
    /// reporting window.
    pub speed_bytes_per_sec: f64,
    /// Estimated seconds remaining at the current speed, if computable.
    pub eta_seconds: Option<f64>,
}

// ---------------------------------------------------------------------------
// Directory helpers
// ---------------------------------------------------------------------------

/// Return the models directory: `{data_dir}/matanyone2/models/`.
///
/// On Windows this resolves to `%APPDATA%/matanyone2/models/`,
/// on macOS `~/Library/Application Support/matanyone2/models/`,
/// on Linux `~/.local/share/matanyone2/models/`.
///
/// The directory is **not** created by this function.
pub fn get_models_dir() -> PathBuf {
    let base = dirs::data_dir().unwrap_or_else(|| {
        // Fallback: put it next to the executable
        std::env::current_exe()
            .map(|p| p.parent().unwrap_or_else(|| std::path::Path::new(".")).to_path_buf())
            .unwrap_or_else(|_| PathBuf::from("."))
    });
    base.join("matanyone2").join("models")
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

/// Check whether the MatAnyone2 model is already downloaded and valid.
///
/// A file is considered valid when:
/// 1. It exists and has non-zero size.
/// 2. If a `.sha256` sidecar file is present, the stored digest matches
///    a freshly computed SHA-256 of the file.
///
/// Computing the hash of a 141 MB file takes ~0.3 s on a modern SSD, so the
/// verification is kept synchronous and only runs when a sidecar exists.
pub fn get_model_info() -> ModelInfo {
    let dir = get_models_dir();
    let model_path = dir.join(MODEL_FILENAME);
    let config_path = dir.join(CONFIG_FILENAME);

    let model_ok = file_is_valid(&model_path);
    let config_ok = file_is_valid(&config_path);

    let size_bytes = if model_ok {
        fs::metadata(&model_path).ok().map(|m| m.len())
    } else {
        None
    };

    ModelInfo {
        downloaded: model_ok && config_ok,
        model_path: if model_ok { Some(model_path) } else { None },
        config_path: if config_ok { Some(config_path) } else { None },
        size_bytes,
    }
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

/// Download both `model.safetensors` and `config.json` from HuggingFace.
///
/// * Supports **resume** via HTTP `Range` headers when a `.tmp` partial file
///   already exists on disk.
/// * Writes to a `.tmp` file first and atomically renames on completion.
/// * Computes SHA-256 on the fly and stores the digest in a `.sha256` sidecar.
/// * Calls `progress_callback` periodically with a [`DownloadProgress`] snapshot.
///
/// If both files are already present and valid, returns immediately.
pub async fn download_model(
    progress_callback: impl Fn(DownloadProgress) + Send + 'static,
) -> Result<ModelInfo, String> {
    // Fast path: already downloaded
    let info = get_model_info();
    if info.downloaded {
        info!("MatAnyone2 model already present at {:?}", info.model_path);
        return Ok(info);
    }

    let dir = get_models_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create models directory: {e}"))?;
    info!("Models directory: {}", dir.display());

    // Download config.json first (small, quick)
    let config_path = dir.join(CONFIG_FILENAME);
    if !file_is_valid(&config_path) {
        let config_url = resolve_url(CONFIG_FILENAME);
        info!("Downloading {CONFIG_FILENAME} from {config_url}");
        download_file(&config_url, &config_path, None).map_err(|e| {
            error!("Failed to download {CONFIG_FILENAME}: {e}");
            format!("Failed to download {CONFIG_FILENAME}: {e}")
        })?;
        info!("{CONFIG_FILENAME} downloaded successfully");
    }

    // Download model.safetensors (large, with progress)
    let model_path = dir.join(MODEL_FILENAME);
    if !file_is_valid(&model_path) {
        let model_url = resolve_url(MODEL_FILENAME);
        info!("Downloading {MODEL_FILENAME} from {model_url}");
        download_file(&model_url, &model_path, Some(&progress_callback)).map_err(|e| {
            error!("Failed to download {MODEL_FILENAME}: {e}");
            format!("Failed to download {MODEL_FILENAME}: {e}")
        })?;
        info!("{MODEL_FILENAME} downloaded successfully");
    }

    Ok(get_model_info())
}

/// Delete all downloaded model files (for uninstall / cache cleanup).
pub async fn delete_model() -> Result<(), String> {
    let dir = get_models_dir();
    if !dir.exists() {
        debug!("Models directory does not exist, nothing to delete");
        return Ok(());
    }

    // Remove known files individually so we don't accidentally nuke unrelated data.
    let files = [
        MODEL_FILENAME,
        CONFIG_FILENAME,
        &format!("{MODEL_FILENAME}.tmp"),
        &format!("{CONFIG_FILENAME}.tmp"),
        &format!("{MODEL_FILENAME}.sha256"),
        &format!("{CONFIG_FILENAME}.sha256"),
    ];

    for name in &files {
        let path = dir.join(name);
        if path.exists() {
            fs::remove_file(&path).map_err(|e| format!("Failed to delete {name}: {e}"))?;
            info!("Deleted {}", path.display());
        }
    }

    // Try to remove the directory tree if empty
    let _ = fs::remove_dir(dir.join("..").join("models")); // models/
    let _ = fs::remove_dir(dir.join(".."));                 // matanyone2/

    info!("MatAnyone2 model files deleted");
    Ok(())
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Build the HuggingFace `resolve/main/` URL for a file.
fn resolve_url(filename: &str) -> String {
    format!("{HF_BASE_URL}/{HF_REPO}/resolve/main/{filename}")
}

/// Check if a file exists, has non-zero size, and (if a sidecar is present)
/// passes SHA-256 verification.
fn file_is_valid(path: &PathBuf) -> bool {
    let meta = match fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return false,
    };
    if meta.len() == 0 {
        return false;
    }

    let sidecar = sidecar_path(path);
    if sidecar.exists() {
        match (read_sidecar_hash(&sidecar), compute_sha256(path)) {
            (Some(expected), Ok(actual)) => {
                if expected != actual {
                    warn!(
                        "SHA-256 mismatch for {}: expected {expected}, got {actual}",
                        path.display()
                    );
                    return false;
                }
            }
            (Some(_), Err(e)) => {
                warn!("Cannot verify {}: {e}", path.display());
                return false;
            }
            // No sidecar hash → skip verification (file was downloaded before
            // we added integrity checks; still considered valid).
            (None, _) => {}
        }
    }

    true
}

/// Return the `.sha256` sidecar path for a given file.
fn sidecar_path(path: &PathBuf) -> PathBuf {
    let mut s = path.as_os_str().to_os_string();
    s.push(".sha256");
    PathBuf::from(s)
}

/// Read the hex digest stored in a sidecar file (first whitespace-delimited
/// token on the first line).
fn read_sidecar_hash(path: &PathBuf) -> Option<String> {
    let content = fs::read_to_string(path).ok()?;
    content
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().next())
        .map(|s| s.to_lowercase())
}

/// Compute the SHA-256 digest of a file, returning the lowercase hex string.
fn compute_sha256(path: &PathBuf) -> Result<String, String> {
    let mut file = fs::File::open(path)
        .map_err(|e| format!("Cannot open {} for hashing: {e}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; READ_CHUNK_SIZE];
    loop {
        let n = file
            .read(&mut buf)
            .map_err(|e| format!("Read error during hashing: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// Download a single file with optional resume and progress reporting.
///
/// Workflow:
/// 1. If a `.tmp` file exists, issue a `Range` request to resume.
/// 2. Stream the response body in chunks, updating progress.
/// 3. After the transfer completes, rename `.tmp` → final path.
/// 4. Compute SHA-256 and write a `.sha256` sidecar.
fn download_file(
    url: &str,
    dest: &PathBuf,
    progress_callback: Option<&dyn Fn(DownloadProgress)>,
) -> Result<(), String> {
    let tmp_path = {
        let mut s = dest.as_os_str().to_os_string();
        s.push(".tmp");
        PathBuf::from(s)
    };

    // Determine how many bytes we already have (for resume).
    let existing_len: u64 = fs::metadata(&tmp_path)
        .map(|m| m.len())
        .unwrap_or(0);

    // --- Issue HTTP request ---
    let response = issue_download_request(url, existing_len)?;

    // Parse content-length and whether the server accepted our Range request.
    let status = response.status();
    let is_partial = status == 206;

    let content_length: u64 = response
        .header("Content-Length")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);

    // If server returns 200 (not 206), it's sending the full file — discard
    // any partial data we might have.
    let resume_offset = if is_partial { existing_len } else { 0 };
    let total_bytes = if is_partial {
        // Content-Range: bytes START-END/TOTAL — total from Content-Length is
        // just the remaining chunk; real total is offset + remaining.
        resume_offset + content_length
    } else {
        content_length
    };

    if resume_offset > 0 {
        info!(
            "Resuming download from byte {resume_offset} ({:.1} MB already on disk)",
            resume_offset as f64 / 1_048_576.0
        );
    }

    // Open output file (append if resuming, create/truncate otherwise).
    let mut file = if resume_offset > 0 {
        fs::OpenOptions::new()
            .append(true)
            .open(&tmp_path)
            .map_err(|e| format!("Cannot open tmp file for append: {e}"))?
    } else {
        fs::File::create(&tmp_path)
            .map_err(|e| format!("Cannot create tmp file: {e}"))?
    };

    // --- Stream body ---
    let mut reader = response.into_reader();
    let mut buf = vec![0u8; READ_CHUNK_SIZE];
    let mut bytes_downloaded: u64 = resume_offset;

    let start_time = Instant::now();
    let mut last_progress_time = Instant::now();
    let mut last_progress_bytes: u64 = resume_offset;

    loop {
        let n = reader
            .read(&mut buf)
            .map_err(|e| format!("Network read error: {e}"))?;
        if n == 0 {
            break;
        }

        file.write_all(&buf[..n])
            .map_err(|e| format!("Disk write error (disk full?): {e}"))?;

        bytes_downloaded += n as u64;

        // Emit progress (throttled)
        if let Some(cb) = progress_callback {
            let now = Instant::now();
            let elapsed_since_last = now.duration_since(last_progress_time).as_millis();
            if elapsed_since_last >= PROGRESS_MIN_INTERVAL_MS || bytes_downloaded == total_bytes {
                let window_bytes = bytes_downloaded - last_progress_bytes;
                let window_secs = elapsed_since_last as f64 / 1000.0;
                let speed = if window_secs > 0.0 {
                    window_bytes as f64 / window_secs
                } else {
                    0.0
                };

                let remaining = if total_bytes > bytes_downloaded {
                    total_bytes - bytes_downloaded
                } else {
                    0
                };
                let eta = if speed > 0.0 {
                    Some(remaining as f64 / speed)
                } else {
                    None
                };

                let percent = if total_bytes > 0 {
                    (bytes_downloaded as f64 / total_bytes as f64 * 100.0) as f32
                } else {
                    0.0
                };

                cb(DownloadProgress {
                    bytes_downloaded,
                    total_bytes,
                    percent,
                    speed_bytes_per_sec: speed,
                    eta_seconds: eta,
                });

                last_progress_time = now;
                last_progress_bytes = bytes_downloaded;
            }
        }
    }

    // Flush and sync to disk before renaming
    file.flush()
        .map_err(|e| format!("Flush failed: {e}"))?;
    file.sync_all()
        .map_err(|e| format!("Sync failed: {e}"))?;
    drop(file);

    let elapsed = start_time.elapsed();
    let downloaded_in_session = bytes_downloaded - resume_offset;
    info!(
        "Transfer complete: {:.1} MB in {:.1}s ({:.1} MB/s)",
        downloaded_in_session as f64 / 1_048_576.0,
        elapsed.as_secs_f64(),
        if elapsed.as_secs_f64() > 0.0 {
            downloaded_in_session as f64 / 1_048_576.0 / elapsed.as_secs_f64()
        } else {
            0.0
        }
    );

    // Atomic rename: .tmp -> final
    // On Windows, the target must not exist for `fs::rename` to succeed.
    if dest.exists() {
        fs::remove_file(dest)
            .map_err(|e| format!("Cannot remove existing file {}: {e}", dest.display()))?;
    }
    fs::rename(&tmp_path, dest)
        .map_err(|e| format!("Rename {} -> {} failed: {e}", tmp_path.display(), dest.display()))?;

    // Compute and store SHA-256 sidecar
    info!("Computing SHA-256 for {} ...", dest.display());
    let hash = compute_sha256(dest)?;
    let sidecar = sidecar_path(dest);
    fs::write(&sidecar, format!("{hash}  {}\n", dest.file_name().unwrap_or_default().to_string_lossy()))
        .map_err(|e| format!("Failed to write sidecar {}: {e}", sidecar.display()))?;
    info!("SHA-256: {hash}");

    Ok(())
}

/// Build and send the HTTP request via `ureq`, handling redirects and
/// optional `Range` header for resume.
fn issue_download_request(url: &str, resume_from: u64) -> Result<ureq::Response, String> {
    let mut request = ureq::AgentBuilder::new()
        .redirects(10)
        .build()
        .get(url)
        .set("User-Agent", USER_AGENT);

    if resume_from > 0 {
        request = request.set("Range", &format!("bytes={resume_from}-"));
    }

    let response = request.call().map_err(|e| match e {
        ureq::Error::Status(code, resp) => {
            let body = resp.into_string().unwrap_or_default();
            format!("HTTP {code}: {body}")
        }
        ureq::Error::Transport(t) => {
            format!("Network error: {t}")
        }
    })?;

    debug!(
        "HTTP {} {} Content-Length={}",
        response.status(),
        response.status_text(),
        response.header("Content-Length").unwrap_or("unknown"),
    );

    Ok(response)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_url() {
        assert_eq!(
            resolve_url("model.safetensors"),
            "https://huggingface.co/PeiqingYang/MatAnyone2/resolve/main/model.safetensors"
        );
        assert_eq!(
            resolve_url("config.json"),
            "https://huggingface.co/PeiqingYang/MatAnyone2/resolve/main/config.json"
        );
    }

    #[test]
    fn test_get_models_dir() {
        let dir = get_models_dir();
        assert!(dir.ends_with("matanyone2/models") || dir.ends_with("matanyone2\\models"));
    }

    #[test]
    fn test_sidecar_path() {
        let p = PathBuf::from("/tmp/model.safetensors");
        let s = sidecar_path(&p);
        assert_eq!(s, PathBuf::from("/tmp/model.safetensors.sha256"));
    }

    #[test]
    fn test_model_info_when_no_files() {
        // In a test environment the models dir likely doesn't exist
        let info = get_model_info();
        // We can't guarantee it's not downloaded, but we can check the struct
        if !info.downloaded {
            assert!(info.model_path.is_none());
            assert!(info.config_path.is_none());
            assert!(info.size_bytes.is_none());
        }
    }
}
