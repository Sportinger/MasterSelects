//! Python environment management for MatAnyone2 video matting.
//!
//! Handles discovery/download of the `uv` package manager, CUDA detection,
//! virtual environment creation, PyTorch + MatAnyone2 installation, and
//! post-install validation.
//!
//! All state is stored under `{data_local_dir}/MasterSelects/matanyone2/`:
//! ```text
//! matanyone2/
//! ├── uv/           # uv binary
//! ├── env/          # Python virtual environment
//! └── matanyone2/   # Extracted MatAnyone2 source
//! ```

mod bootstrap;
mod platform;
mod source;

pub use platform::{detect_cuda, validate_cuda_runtime};

use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use serde::Serialize;
use tokio::process::Command as TokioCommand;
use tracing::info;

const BUNDLED_SERVER_SCRIPT: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/python/matanyone2_server.py"
));
/// Tested upstream source revision. Never install an unpinned branch head.
pub const MATANYONE_REVISION: &str = "d3bb5a1ebedf259a5453c6d168e6840fff85581e";
pub const GPU_REQUIRED_MESSAGE: &str = "MatAnyone2 requires an accessible NVIDIA CUDA GPU. CPU execution is disabled in MasterSelects. Check the NVIDIA driver and helper permissions.";
pub(super) const SOURCE_REVISION_MARKER: &str = "source-revision";

/// Create a TokioCommand that won't show a terminal window on Windows.
pub(super) fn silent_cmd(program: impl AsRef<std::ffi::OsStr>) -> TokioCommand {
    let mut cmd = TokioCommand::new(program);
    #[cfg(windows)]
    {
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    cmd
}

/// Create an isolated uv command that cannot inherit cache/project settings
/// from an unrelated developer environment.
pub(crate) fn managed_uv_cmd(
    program: impl AsRef<std::ffi::OsStr>,
    cache_dir: impl AsRef<Path>,
) -> TokioCommand {
    let mut cmd = silent_cmd(program);
    cmd.env("UV_CACHE_DIR", cache_dir.as_ref())
        .env_remove("UV_CONFIG_FILE")
        .env_remove("UV_PROJECT_ENVIRONMENT")
        .env_remove("UV_WORKING_DIR")
        .env_remove("UV_PYTHON")
        .env_remove("UV_OFFLINE")
        .env_remove("UV_NO_INDEX")
        .env_remove("UV_INDEX")
        .env_remove("UV_DEFAULT_INDEX")
        .env_remove("UV_EXTRA_INDEX_URL")
        .env_remove("UV_INDEX_URL");
    cmd
}

pub(super) fn matanyone_uv_cmd(program: impl AsRef<std::ffi::OsStr>) -> TokioCommand {
    managed_uv_cmd(program, get_data_dir().join("uv-cache"))
}

/// Create a std::process::Command that won't show a terminal window on Windows.
pub(super) fn silent_cmd_std(program: impl AsRef<std::ffi::OsStr>) -> std::process::Command {
    let mut cmd = std::process::Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    cmd
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Snapshot of the current MatAnyone2 environment status.
#[derive(Debug, Clone, Serialize)]
pub struct EnvInfo {
    /// Path to the `uv` binary, if found or downloaded.
    pub uv_path: Option<PathBuf>,
    /// Path to a system Python interpreter (fallback).
    pub python_path: Option<PathBuf>,
    /// Version string of the detected system Python (e.g. `"3.12.2"`).
    pub python_version: Option<String>,
    /// Path to the virtual environment root.
    pub venv_path: PathBuf,
    /// Whether the venv directory exists on disk.
    pub venv_exists: bool,
    /// Whether core dependencies (torch, torchvision) are installed.
    pub deps_installed: bool,
    /// Whether the `matanyone2` package is importable.
    pub matanyone_installed: bool,
    /// Pinned source revision recorded after a successful install/update.
    pub installed_revision: Option<String>,
    pub expected_revision: &'static str,
    /// CUDA / GPU information.
    pub cuda: CudaInfo,
}

/// CUDA and GPU hardware information.
#[derive(Debug, Clone, Default, Serialize)]
pub struct CudaInfo {
    /// Whether an NVIDIA GPU with CUDA support was detected.
    pub available: bool,
    /// CUDA driver version reported by `nvidia-smi` (e.g. `"12.1"`).
    pub version: Option<String>,
    /// GPU product name (e.g. `"NVIDIA GeForce RTX 4090"`).
    pub gpu_name: Option<String>,
    /// Total VRAM in megabytes.
    pub vram_mb: Option<u64>,
}

/// Discrete steps of the setup process, reported via the progress callback.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum SetupStep {
    DownloadUv,
    InstallPython,
    CreateVenv,
    InstallPyTorch,
    InstallMatAnyone,
    Validate,
}

impl std::fmt::Display for SetupStep {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::DownloadUv => write!(f, "Download uv"),
            Self::InstallPython => write!(f, "Install Python"),
            Self::CreateVenv => write!(f, "Create venv"),
            Self::InstallPyTorch => write!(f, "Install PyTorch"),
            Self::InstallMatAnyone => write!(f, "Install MatAnyone2"),
            Self::Validate => write!(f, "Validate"),
        }
    }
}

// ---------------------------------------------------------------------------
// Directory helpers
// ---------------------------------------------------------------------------

/// Return the base data directory for MatAnyone2 artifacts.
///
/// Resolves to `%LOCALAPPDATA%/MasterSelects/matanyone2` on Windows,
/// `~/Library/Application Support/MasterSelects/matanyone2` on macOS,
/// or `~/.local/share/MasterSelects/matanyone2` on Linux.
pub fn get_data_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("MasterSelects")
        .join("matanyone2")
}

/// Return the path where the bundled MatAnyone2 HTTP server script should live.
pub fn get_server_script_path() -> PathBuf {
    get_data_dir().join("matanyone2_server.py")
}

/// Return the path where the `uv` binary should live.
pub(super) fn get_uv_dir() -> PathBuf {
    get_data_dir().join("uv")
}

/// Return the expected `uv` binary path (platform-specific extension).
pub(super) fn get_uv_binary_path() -> PathBuf {
    let dir = get_uv_dir();
    if cfg!(windows) {
        dir.join("uv.exe")
    } else {
        dir.join("uv")
    }
}

/// Ensure the managed uv binary exists so other isolated local-AI providers
/// can reuse the bootstrap without sharing Python packages or model caches.
pub(crate) async fn ensure_uv_available() -> Result<PathBuf, String> {
    bootstrap::download_uv(&|_, _, _| {})
        .await
        .map_err(|e| format!("{e:#}"))
}

/// Return the path to the Python virtual environment.
pub(super) fn get_venv_dir() -> PathBuf {
    get_data_dir().join("env")
}

/// Return the path to the Python interpreter inside the venv.
pub fn get_venv_python() -> PathBuf {
    let venv = get_venv_dir();
    if cfg!(windows) {
        venv.join("Scripts").join("python.exe")
    } else {
        venv.join("bin").join("python")
    }
}

/// Return the directory where MatAnyone2 source is extracted.
pub(super) fn get_matanyone_src_dir() -> PathBuf {
    get_data_dir().join("matanyone2")
}

// ---------------------------------------------------------------------------
// Quick status check (no side effects)
// ---------------------------------------------------------------------------

/// Collect environment status without performing any installs.
///
/// This is a fast, read-only probe suitable for UI status displays.
pub fn get_env_info() -> EnvInfo {
    let uv_bin = get_uv_binary_path();
    let uv_path = if uv_bin.exists() { Some(uv_bin) } else { None };

    let (python_path, python_version) = platform::detect_system_python_sync();

    let venv_path = get_venv_dir();
    let venv_exists = get_venv_python().exists();

    let deps_installed = if venv_exists {
        platform::check_deps_installed_sync()
    } else {
        false
    };

    let package_importable = if venv_exists {
        platform::check_matanyone_installed_sync()
    } else {
        false
    };
    let installed_revision = std::fs::read_to_string(get_data_dir().join(SOURCE_REVISION_MARKER))
        .ok()
        .map(|value| value.trim().to_string());
    let matanyone_installed =
        package_importable && installed_revision.as_deref() == Some(MATANYONE_REVISION);

    EnvInfo {
        uv_path,
        python_path,
        python_version,
        venv_path,
        venv_exists,
        deps_installed,
        matanyone_installed,
        installed_revision,
        expected_revision: MATANYONE_REVISION,
        cuda: CudaInfo::default(),
    }
}

/// Ensure the bundled Python inference server script exists on disk.
pub async fn ensure_server_script() -> Result<PathBuf, String> {
    let script_path = get_server_script_path();

    if let Some(parent) = script_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create MatAnyone2 data directory: {e}"))?;
    }

    let needs_write = match tokio::fs::read_to_string(&script_path).await {
        Ok(existing) => existing != BUNDLED_SERVER_SCRIPT,
        Err(_) => true,
    };

    if needs_write {
        tokio::fs::write(&script_path, BUNDLED_SERVER_SCRIPT)
            .await
            .map_err(|e| format!("Failed to write MatAnyone2 server script: {e}"))?;
    }

    Ok(script_path)
}

// ---------------------------------------------------------------------------
// Full setup orchestration
// ---------------------------------------------------------------------------

/// Run the full MatAnyone2 environment setup.
///
/// This is the main entry point for setting up everything from scratch.
/// It is idempotent — each step checks whether work is already done and
/// skips accordingly.
///
/// # Arguments
/// * `progress_callback` — called with `(step, progress_0_to_1, message)` to
///   report setup progress to the UI.
///
/// # Errors
/// Returns an error if any step fails. The environment may be partially set up,
/// and re-running will resume from the first incomplete step.
pub async fn setup_environment(
    requested_python: Option<PathBuf>,
    progress_callback: impl Fn(SetupStep, f32, &str),
) -> Result<EnvInfo, String> {
    let result = setup_environment_inner(requested_python.as_deref(), &progress_callback).await;
    result.map_err(|e| format!("{:#}", e))
}

async fn setup_environment_inner(
    requested_python: Option<&Path>,
    progress: &impl Fn(SetupStep, f32, &str),
) -> Result<EnvInfo> {
    info!("Starting MatAnyone2 environment setup");

    // Fail before bootstrapping Python tooling when no supported execution
    // device is accessible. MatAnyone2 has no CPU mode in MasterSelects.
    let cuda = platform::detect_cuda().await;
    if !cuda.available {
        bail!(GPU_REQUIRED_MESSAGE);
    }

    let data_dir = get_data_dir();
    info!("Data directory: {}", data_dir.display());

    tokio::fs::create_dir_all(&data_dir)
        .await
        .context("Failed to create data directory")?;

    // Step 1: Download uv
    let uv_path = bootstrap::download_uv(progress).await?;

    // Step 2: Detect system Python (informational — uv can install its own)
    progress(SetupStep::InstallPython, 0.0, "Detecting system Python...");
    let detected = if let Some(path) = requested_python {
        let output = silent_cmd(path).arg("--version").output().await.ok();
        let version = output.as_ref().and_then(|value| {
            let bytes = if value.stdout.is_empty() {
                &value.stderr
            } else {
                &value.stdout
            };
            platform::parse_python_version(String::from_utf8_lossy(bytes).trim())
        });
        (Some(path.to_path_buf()), version)
    } else {
        platform::detect_system_python_async().await
    };
    let (python_path, python_version) = detected;
    if let Some(ref ver) = python_version {
        info!(
            "System Python: {} ({})",
            python_path.as_ref().unwrap().display(),
            ver
        );
        progress(
            SetupStep::InstallPython,
            1.0,
            &format!("System Python {} detected", ver),
        );
    } else {
        info!("No system Python >= 3.10 found; uv will install one");
        progress(
            SetupStep::InstallPython,
            1.0,
            "No system Python found; uv will manage Python",
        );
    }

    // Step 3: Create venv
    platform::create_venv(&uv_path, requested_python, progress).await?;

    // Step 4: Install PyTorch
    platform::install_pytorch(&uv_path, &cuda, progress).await?;

    // Step 5: Install MatAnyone2
    source::install_matanyone(&uv_path, progress).await?;

    // Step 6: Validate
    platform::validate_installation(progress).await?;

    let env_info = EnvInfo {
        uv_path: Some(uv_path),
        python_path,
        python_version,
        venv_path: get_venv_dir(),
        venv_exists: true,
        deps_installed: true,
        matanyone_installed: true,
        installed_revision: Some(MATANYONE_REVISION.to_string()),
        expected_revision: MATANYONE_REVISION,
        cuda,
    };

    info!("MatAnyone2 environment setup complete");
    Ok(env_info)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_python_version() {
        assert_eq!(
            platform::parse_python_version("Python 3.12.2"),
            Some("3.12.2".to_string())
        );
        assert_eq!(
            platform::parse_python_version("Python 3.10.0"),
            Some("3.10.0".to_string())
        );
        assert_eq!(platform::parse_python_version("not a version"), None);
        assert_eq!(platform::parse_python_version(""), None);
    }

    #[test]
    fn managed_uv_uses_provider_local_cache() {
        let expected = get_data_dir().join("uv-cache");
        let command = matanyone_uv_cmd("uv");
        let configured = command
            .as_std()
            .get_envs()
            .find(|(key, _)| *key == "UV_CACHE_DIR")
            .and_then(|(_, value)| value)
            .map(PathBuf::from);
        assert_eq!(configured, Some(expected));
    }

    #[test]
    fn test_parse_cuda_version() {
        assert_eq!(platform::parse_cuda_version("13.2"), Some((13, 2)));
        assert_eq!(platform::parse_cuda_version("12.8"), Some((12, 8)));
        assert_eq!(platform::parse_cuda_version("12"), Some((12, 0)));
        assert_eq!(platform::parse_cuda_version("CUDA 12.8"), None);
    }

    #[test]
    fn test_is_version_gte() {
        assert!(platform::is_version_gte("3.12.2", 3, 10));
        assert!(platform::is_version_gte("3.10.0", 3, 10));
        assert!(!platform::is_version_gte("3.9.7", 3, 10));
        assert!(!platform::is_version_gte("2.7.18", 3, 10));
        assert!(platform::is_version_gte("4.0.0", 3, 10));
    }

    #[test]
    fn test_parse_gpu_csv() {
        let (name, vram) = platform::parse_gpu_csv("NVIDIA GeForce RTX 4090, 24564");
        assert_eq!(name.as_deref(), Some("NVIDIA GeForce RTX 4090"));
        assert_eq!(vram, Some(24564));

        let (name, vram) = platform::parse_gpu_csv("Tesla V100-SXM2-16GB, 16384");
        assert_eq!(name.as_deref(), Some("Tesla V100-SXM2-16GB"));
        assert_eq!(vram, Some(16384));

        let (name, vram) = platform::parse_gpu_csv("");
        assert_eq!(name, None);
        assert_eq!(vram, None);
    }

    #[test]
    fn test_select_pytorch_index_url() {
        let cuda_132 = CudaInfo {
            available: true,
            version: Some("13.2".to_string()),
            gpu_name: None,
            vram_mb: None,
        };
        assert_eq!(
            platform::pytorch_index_candidates(&cuda_132),
            vec![
                "https://download.pytorch.org/whl/cu130".to_string(),
                "https://download.pytorch.org/whl/cu128".to_string(),
            ]
        );

        let cuda_128 = CudaInfo {
            available: true,
            version: Some("12.8".to_string()),
            gpu_name: None,
            vram_mb: None,
        };
        assert!(platform::pytorch_index_candidates(&cuda_128)[0].contains("cu128"));

        let cuda_126 = CudaInfo {
            available: true,
            version: Some("12.6".to_string()),
            gpu_name: None,
            vram_mb: None,
        };
        assert!(platform::pytorch_index_candidates(&cuda_126)[0].contains("cu126"));

        let cuda_121 = CudaInfo {
            available: true,
            version: Some("12.1".to_string()),
            gpu_name: None,
            vram_mb: None,
        };
        assert!(platform::pytorch_index_candidates(&cuda_121)[0].contains("cu121"));

        let cuda_118 = CudaInfo {
            available: true,
            version: Some("11.8".to_string()),
            gpu_name: None,
            vram_mb: None,
        };
        assert!(platform::pytorch_index_candidates(&cuda_118)[0].contains("cu118"));

        let no_cuda = CudaInfo {
            available: false,
            version: None,
            gpu_name: None,
            vram_mb: None,
        };
        assert!(platform::pytorch_index_candidates(&no_cuda).is_empty());
    }

    #[test]
    fn test_get_data_dir_is_absolute() {
        let dir = get_data_dir();
        // On CI or unusual environments data_local_dir may return None,
        // falling back to ".". In normal environments it should be absolute.
        if dirs::data_local_dir().is_some() {
            assert!(dir.is_absolute());
        }
    }

    #[test]
    fn test_uv_target() {
        let target = bootstrap::get_uv_target();
        assert!(!target.is_empty());
        // Should contain a known OS substring
        assert!(
            target.contains("windows") || target.contains("darwin") || target.contains("linux"),
            "Unexpected target: {}",
            target
        );
    }
}
