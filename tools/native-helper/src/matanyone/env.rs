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

use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use serde::Serialize;
use tokio::process::Command as TokioCommand;
use tracing::{debug, info, warn};

const BUNDLED_SERVER_SCRIPT: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/python/matanyone2_server.py"
));

/// Create a TokioCommand that won't show a terminal window on Windows.
fn silent_cmd(program: impl AsRef<std::ffi::OsStr>) -> TokioCommand {
    let mut cmd = TokioCommand::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    cmd
}

/// Create a std::process::Command that won't show a terminal window on Windows.
fn silent_cmd_std(program: impl AsRef<std::ffi::OsStr>) -> std::process::Command {
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
fn get_uv_dir() -> PathBuf {
    get_data_dir().join("uv")
}

/// Return the expected `uv` binary path (platform-specific extension).
fn get_uv_binary_path() -> PathBuf {
    let dir = get_uv_dir();
    if cfg!(windows) {
        dir.join("uv.exe")
    } else {
        dir.join("uv")
    }
}

/// Return the path to the Python virtual environment.
fn get_venv_dir() -> PathBuf {
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
fn get_matanyone_src_dir() -> PathBuf {
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
    let uv_path = if uv_bin.exists() {
        Some(uv_bin)
    } else {
        None
    };

    let (python_path, python_version) = detect_system_python_sync();

    let venv_path = get_venv_dir();
    let venv_exists = get_venv_python().exists();

    let deps_installed = if venv_exists {
        check_deps_installed_sync()
    } else {
        false
    };

    let matanyone_installed = if venv_exists {
        check_matanyone_installed_sync()
    } else {
        false
    };

    EnvInfo {
        uv_path,
        python_path,
        python_version,
        venv_path,
        venv_exists,
        deps_installed,
        matanyone_installed,
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
// CUDA detection
// ---------------------------------------------------------------------------

/// Detect NVIDIA GPU and CUDA availability via `nvidia-smi`.
pub async fn detect_cuda() -> CudaInfo {
    // Query GPU name and VRAM
    let gpu_result = silent_cmd("nvidia-smi")
        .args([
            "--query-gpu=name,memory.total",
            "--format=csv,noheader,nounits",
        ])
        .output()
        .await;

    let (gpu_name, vram_mb) = match gpu_result {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let line = stdout.lines().next().unwrap_or("");
            parse_gpu_csv(line)
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            debug!("nvidia-smi failed: {}", stderr.trim());
            (None, None)
        }
        Err(e) => {
            debug!("nvidia-smi not found or failed to execute: {}", e);
            (None, None)
        }
    };

    // Query CUDA driver version
    let cuda_version = query_cuda_version().await;

    let available = gpu_name.is_some() && cuda_version.is_some();

    if available {
        info!(
            "CUDA detected: {} ({} MB VRAM), driver {}",
            gpu_name.as_deref().unwrap_or("?"),
            vram_mb.unwrap_or(0),
            cuda_version.as_deref().unwrap_or("?"),
        );
    } else {
        info!("No CUDA-capable GPU detected, will use CPU-only PyTorch");
    }

    CudaInfo {
        available,
        version: cuda_version,
        gpu_name,
        vram_mb,
    }
}

/// Parse a CSV line like `"NVIDIA GeForce RTX 4090, 24564"`.
fn parse_gpu_csv(line: &str) -> (Option<String>, Option<u64>) {
    let parts: Vec<&str> = line.splitn(2, ',').collect();
    if parts.len() < 2 {
        return (None, None);
    }
    let name = parts[0].trim();
    let vram_str = parts[1].trim();
    let vram = vram_str.parse::<u64>().ok();
    if name.is_empty() {
        (None, vram)
    } else {
        (Some(name.to_string()), vram)
    }
}

/// Query the CUDA driver version via `nvidia-smi`.
async fn query_cuda_version() -> Option<String> {
    let output = silent_cmd("nvidia-smi")
        .output()
        .await
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    // nvidia-smi output contains a line like "CUDA Version: 12.1"
    for line in stdout.lines() {
        if let Some(idx) = line.find("CUDA Version:") {
            let after = &line[idx + "CUDA Version:".len()..];
            let version = after.trim().split_whitespace().next()?;
            return Some(version.to_string());
        }
    }
    None
}

// ---------------------------------------------------------------------------
// System Python detection
// ---------------------------------------------------------------------------

/// Try to find a system Python >= 3.10 (synchronous, for `get_env_info`).
fn detect_system_python_sync() -> (Option<PathBuf>, Option<String>) {
    let candidates = python_candidates();
    for (cmd, args) in &candidates {
        if let Ok(output) = silent_cmd_std(cmd).args(args).output() {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if let Some(version) = parse_python_version(stdout.trim()) {
                    if is_version_gte(&version, 3, 10) {
                        debug!("System Python found: {} ({})", cmd, version);
                        return (Some(PathBuf::from(cmd)), Some(version));
                    }
                }
            }
        }
    }
    (None, None)
}

/// Try to find a system Python >= 3.10 (async).
async fn detect_system_python_async() -> (Option<PathBuf>, Option<String>) {
    let candidates = python_candidates();
    for (cmd, args) in &candidates {
        let result = silent_cmd(cmd).args(args).output().await;
        if let Ok(output) = result {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if let Some(version) = parse_python_version(stdout.trim()) {
                    if is_version_gte(&version, 3, 10) {
                        debug!("System Python found: {} ({})", cmd, version);
                        return (Some(PathBuf::from(cmd)), Some(version));
                    }
                }
            }
        }
    }
    (None, None)
}

/// Return a list of (command, args) pairs to try for Python discovery.
fn python_candidates() -> Vec<(&'static str, Vec<&'static str>)> {
    let mut candidates = vec![
        ("python3", vec!["--version"]),
        ("python", vec!["--version"]),
    ];
    if cfg!(windows) {
        candidates.push(("py", vec!["-3", "--version"]));
    }
    candidates
}

/// Extract a version string like `"3.12.2"` from `"Python 3.12.2"`.
fn parse_python_version(output: &str) -> Option<String> {
    // Handle output like "Python 3.12.2"
    let version_part = output
        .strip_prefix("Python ")
        .or_else(|| output.strip_prefix("python "))
        .unwrap_or(output);

    // Validate it looks like a version
    let parts: Vec<&str> = version_part.split('.').collect();
    if parts.len() >= 2 && parts[0].parse::<u32>().is_ok() && parts[1].parse::<u32>().is_ok() {
        Some(version_part.to_string())
    } else {
        None
    }
}

/// Check whether a version string like `"3.12.2"` is >= major.minor.
fn is_version_gte(version: &str, major: u32, minor: u32) -> bool {
    let parts: Vec<&str> = version.split('.').collect();
    if parts.len() < 2 {
        return false;
    }
    let Ok(v_major) = parts[0].parse::<u32>() else {
        return false;
    };
    let Ok(v_minor) = parts[1].parse::<u32>() else {
        return false;
    };
    (v_major, v_minor) >= (major, minor)
}

// ---------------------------------------------------------------------------
// uv download
// ---------------------------------------------------------------------------

/// Download the `uv` package manager from GitHub releases.
async fn download_uv(progress: &impl Fn(SetupStep, f32, &str)) -> Result<PathBuf> {
    let target = get_uv_target();
    let url = format!(
        "https://github.com/astral-sh/uv/releases/latest/download/uv-{}.zip",
        target
    );

    let dest_dir = get_uv_dir();
    let dest_bin = get_uv_binary_path();

    // Already downloaded?
    if dest_bin.exists() {
        info!("uv already present at {}", dest_bin.display());
        return Ok(dest_bin);
    }

    progress(SetupStep::DownloadUv, 0.0, "Downloading uv package manager...");
    info!("Downloading uv from {}", url);

    tokio::fs::create_dir_all(&dest_dir)
        .await
        .context("Failed to create uv directory")?;

    let zip_path = dest_dir.join("uv-download.zip");

    // Download using curl/wget/powershell depending on platform
    download_file(&url, &zip_path).await?;

    progress(SetupStep::DownloadUv, 0.5, "Extracting uv...");

    // Extract the zip
    extract_zip(&zip_path, &dest_dir).await?;

    // The archive extracts into a subdirectory like `uv-x86_64-pc-windows-msvc/`
    // We need to find and move the binary to dest_dir directly.
    let extracted_subdir = dest_dir.join(format!("uv-{}", target));
    let binary_name = if cfg!(windows) { "uv.exe" } else { "uv" };
    let extracted_bin = extracted_subdir.join(binary_name);

    if extracted_bin.exists() && extracted_bin != dest_bin {
        tokio::fs::rename(&extracted_bin, &dest_bin)
            .await
            .context("Failed to move uv binary")?;
        // Clean up the extracted subdirectory
        let _ = tokio::fs::remove_dir_all(&extracted_subdir).await;
    }

    // On Unix, make the binary executable
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o755);
        tokio::fs::set_permissions(&dest_bin, perms)
            .await
            .context("Failed to set executable permissions on uv")?;
    }

    // Clean up zip
    let _ = tokio::fs::remove_file(&zip_path).await;

    if !dest_bin.exists() {
        bail!(
            "uv binary not found at {} after extraction",
            dest_bin.display()
        );
    }

    progress(SetupStep::DownloadUv, 1.0, "uv downloaded successfully");
    info!("uv installed at {}", dest_bin.display());
    Ok(dest_bin)
}

/// Determine the GitHub release target triple for the current platform.
fn get_uv_target() -> &'static str {
    if cfg!(target_os = "windows") {
        if cfg!(target_arch = "aarch64") {
            "aarch64-pc-windows-msvc"
        } else {
            "x86_64-pc-windows-msvc"
        }
    } else if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") {
            "aarch64-apple-darwin"
        } else {
            "x86_64-apple-darwin"
        }
    } else {
        if cfg!(target_arch = "aarch64") {
            "aarch64-unknown-linux-gnu"
        } else {
            "x86_64-unknown-linux-gnu"
        }
    }
}

/// Download a file from `url` to `dest` using platform-native tools.
async fn download_file(url: &str, dest: &Path) -> Result<()> {
    // Try curl first (available on Windows 10+, macOS, most Linux)
    let curl_result = silent_cmd("curl")
        .args(["-fSL", "--retry", "3", "-o"])
        .arg(dest.as_os_str())
        .arg(url)
        .output()
        .await;

    match curl_result {
        Ok(output) if output.status.success() => return Ok(()),
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            debug!("curl failed: {}", stderr.trim());
        }
        Err(e) => {
            debug!("curl not available: {}", e);
        }
    }

    // Fallback: PowerShell on Windows
    #[cfg(windows)]
    {
        let ps_result = silent_cmd("powershell")
            .args([
                "-NoProfile",
                "-Command",
                &format!(
                    "Invoke-WebRequest -Uri '{}' -OutFile '{}' -UseBasicParsing",
                    url,
                    dest.display()
                ),
            ])
            .output()
            .await;

        match ps_result {
            Ok(output) if output.status.success() => return Ok(()),
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                debug!("PowerShell download failed: {}", stderr.trim());
            }
            Err(e) => {
                debug!("PowerShell not available: {}", e);
            }
        }
    }

    // Fallback: wget on Unix
    #[cfg(not(windows))]
    {
        let wget_result = silent_cmd("wget")
            .args(["-q", "-O"])
            .arg(dest.as_os_str())
            .arg(url)
            .output()
            .await;

        match wget_result {
            Ok(output) if output.status.success() => return Ok(()),
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                debug!("wget failed: {}", stderr.trim());
            }
            Err(e) => {
                debug!("wget not available: {}", e);
            }
        }
    }

    bail!(
        "Failed to download {} - no working HTTP client found (tried curl{})",
        url,
        if cfg!(windows) {
            ", PowerShell"
        } else {
            ", wget"
        }
    );
}

/// Extract a zip archive to `dest_dir` using platform-native tools.
async fn extract_zip(zip_path: &Path, dest_dir: &Path) -> Result<()> {
    #[cfg(windows)]
    {
        let result = silent_cmd("powershell")
            .args([
                "-NoProfile",
                "-Command",
                &format!(
                    "Expand-Archive -Path '{}' -DestinationPath '{}' -Force",
                    zip_path.display(),
                    dest_dir.display()
                ),
            ])
            .output()
            .await
            .context("Failed to run PowerShell for zip extraction")?;

        if !result.status.success() {
            let stderr = String::from_utf8_lossy(&result.stderr);
            bail!("Zip extraction failed: {}", stderr.trim());
        }
        return Ok(());
    }

    #[cfg(not(windows))]
    {
        let result = silent_cmd("unzip")
            .args(["-o", "-q"])
            .arg(zip_path.as_os_str())
            .arg("-d")
            .arg(dest_dir.as_os_str())
            .output()
            .await
            .context("Failed to run unzip")?;

        if !result.status.success() {
            let stderr = String::from_utf8_lossy(&result.stderr);
            bail!("Zip extraction failed: {}", stderr.trim());
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Venv creation and dependency installation
// ---------------------------------------------------------------------------

/// Create a Python virtual environment using `uv`.
async fn create_venv(
    uv_path: &Path,
    progress: &impl Fn(SetupStep, f32, &str),
) -> Result<()> {
    let venv_dir = get_venv_dir();

    // If venv already exists and has a working python, skip
    if get_venv_python().exists() {
        info!("Venv already exists at {}", venv_dir.display());
        progress(SetupStep::CreateVenv, 1.0, "Virtual environment already exists");
        return Ok(());
    }

    progress(SetupStep::CreateVenv, 0.0, "Creating Python virtual environment...");
    info!("Creating venv at {}", venv_dir.display());

    tokio::fs::create_dir_all(&venv_dir)
        .await
        .context("Failed to create venv directory")?;

    let output = silent_cmd(uv_path)
        .args(["venv", &venv_dir.to_string_lossy(), "--python", "3.11"])
        .output()
        .await
        .context("Failed to run uv venv")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // If Python 3.12 is not available, try without specifying version
        // and let uv pick what's available
        warn!("uv venv with Python 3.11 failed: {}", stderr.trim());
        info!("Retrying venv creation without specific Python version...");

        progress(
            SetupStep::CreateVenv,
            0.3,
            "Python 3.11 not found, trying available Python...",
        );

        let output2 = silent_cmd(uv_path)
            .args(["venv", &venv_dir.to_string_lossy()])
            .output()
            .await
            .context("Failed to run uv venv (fallback)")?;

        if !output2.status.success() {
            let stderr2 = String::from_utf8_lossy(&output2.stderr);
            bail!(
                "Failed to create virtual environment: {}",
                stderr2.trim()
            );
        }
    }

    if !get_venv_python().exists() {
        bail!(
            "Venv was created but Python binary not found at {}",
            get_venv_python().display()
        );
    }

    progress(SetupStep::CreateVenv, 1.0, "Virtual environment created");
    info!("Venv created successfully");
    Ok(())
}

/// Install PyTorch and torchvision into the venv.
async fn install_pytorch(
    uv_path: &Path,
    cuda: &CudaInfo,
    progress: &impl Fn(SetupStep, f32, &str),
) -> Result<()> {
    let venv_python = get_venv_python();

    // Check if torch is already installed and usable for the current GPU.
    if validate_pytorch_runtime(&venv_python, cuda.available).await.is_ok() {
        info!("PyTorch already installed and compatible");
        progress(SetupStep::InstallPyTorch, 1.0, "PyTorch already installed");
        return Ok(());
    }

    let index_urls = pytorch_index_candidates(cuda);
    progress(
        SetupStep::InstallPyTorch,
        0.0,
        &format!(
            "Installing PyTorch ({})...",
            if cuda.available { "CUDA" } else { "CPU" }
        ),
    );

    let venv_str = get_venv_dir().to_string_lossy().to_string();
    let mut last_error = String::new();

    for (idx, index_url) in index_urls.iter().enumerate() {
        info!("Installing PyTorch from {}", index_url);

        let args = [
            "pip",
            "install",
            "torch",
            "torchvision",
            "--upgrade",
            "--index-url",
            index_url.as_str(),
            "-p",
            venv_str.as_str(),
        ];

        let output = silent_cmd(uv_path)
            .args(args)
            .output()
            .await
            .context("Failed to run uv pip install for PyTorch")?;

        if output.status.success() {
            if let Err(reason) = validate_pytorch_runtime(&venv_python, cuda.available).await {
                last_error = format!(
                    "PyTorch installed from {} but runtime validation failed: {}",
                    index_url, reason
                );
                warn!("{}", last_error);
                continue;
            }

            progress(SetupStep::InstallPyTorch, 1.0, "PyTorch installed");
            info!("PyTorch installed successfully");
            return Ok(());
        }

        let stderr = String::from_utf8_lossy(&output.stderr);
        last_error = stderr.trim().to_string();
        warn!(
            "Failed to install PyTorch from {}{}: {}",
            index_url,
            if idx + 1 < index_urls.len() {
                ", trying fallback"
            } else {
                ""
            },
            last_error
        );
    }

    bail!("Failed to install PyTorch: {}", last_error);
}

/// Select PyTorch index URLs, ordered from best match to fallback.
fn pytorch_index_candidates(cuda: &CudaInfo) -> Vec<String> {
    if !cuda.available {
        return vec!["https://download.pytorch.org/whl/cpu".to_string()];
    }

    // Pick the best CUDA wheel version based on the driver's CUDA version
    let mut candidates = match cuda.version.as_deref().and_then(parse_cuda_version) {
        Some((major, _minor)) if major >= 13 => {
            vec![
                "https://download.pytorch.org/whl/cu130".to_string(),
                "https://download.pytorch.org/whl/cu128".to_string(),
            ]
        }
        Some((12, minor)) if minor >= 8 => {
            vec!["https://download.pytorch.org/whl/cu128".to_string()]
        }
        Some((12, minor)) if minor >= 6 => {
            vec![
                "https://download.pytorch.org/whl/cu126".to_string(),
                "https://download.pytorch.org/whl/cu121".to_string(),
            ]
        }
        Some((12, _)) => {
            vec!["https://download.pytorch.org/whl/cu121".to_string()]
        }
        Some((11, _)) => {
            vec!["https://download.pytorch.org/whl/cu118".to_string()]
        }
        Some(_) => {
            // Unknown CUDA major; use CPU wheels.
            vec!["https://download.pytorch.org/whl/cpu".to_string()]
        }
        _ => {
            vec!["https://download.pytorch.org/whl/cu128".to_string()]
        }
    };

    candidates.dedup();
    candidates
}

/// Parse a CUDA version string like `"12.8"` or `"13.2"`.
fn parse_cuda_version(version: &str) -> Option<(u32, u32)> {
    let mut parts = version.split('.');
    let major = parts.next()?.parse::<u32>().ok()?;
    let minor = parts.next().unwrap_or("0").parse::<u32>().ok()?;
    Some((major, minor))
}

/// Download and install MatAnyone2 from GitHub.
async fn install_matanyone(
    uv_path: &Path,
    progress: &impl Fn(SetupStep, f32, &str),
) -> Result<()> {
    let venv_python = get_venv_python();

    // Check if already installed
    if check_package_importable(&venv_python, "matanyone2").await {
        info!("MatAnyone2 already installed");
        progress(
            SetupStep::InstallMatAnyone,
            1.0,
            "MatAnyone2 already installed",
        );
        return Ok(());
    }

    progress(
        SetupStep::InstallMatAnyone,
        0.0,
        "Downloading MatAnyone2...",
    );

    let data_dir = get_data_dir();
    let zip_url = "https://github.com/pq-yang/MatAnyone2/archive/refs/heads/main.zip";
    let zip_path = data_dir.join("matanyone2-source.zip");

    tokio::fs::create_dir_all(&data_dir)
        .await
        .context("Failed to create data directory")?;

    download_file(zip_url, &zip_path).await?;

    progress(
        SetupStep::InstallMatAnyone,
        0.3,
        "Extracting MatAnyone2...",
    );

    // Extract
    extract_zip(&zip_path, &data_dir).await?;
    let _ = tokio::fs::remove_file(&zip_path).await;

    // GitHub archives extract to `MatAnyone2-main/`
    let extracted_dir = data_dir.join("MatAnyone2-main");
    let target_dir = get_matanyone_src_dir();

    // Rename if the target doesn't already exist
    if extracted_dir.exists() && extracted_dir != target_dir {
        // Remove old target if it exists
        if target_dir.exists() {
            let _ = tokio::fs::remove_dir_all(&target_dir).await;
        }
        tokio::fs::rename(&extracted_dir, &target_dir)
            .await
            .context("Failed to rename extracted MatAnyone2 directory")?;
    }

    progress(
        SetupStep::InstallMatAnyone,
        0.4,
        "Patching dependencies (cchardet → charset-normalizer)...",
    );

    // cchardet has no pre-built wheels for Python >= 3.10 and fails to compile.
    // Replace it with charset-normalizer in the project requirements.
    patch_cchardet_dependency(&target_dir).await;

    progress(
        SetupStep::InstallMatAnyone,
        0.5,
        "Installing MatAnyone2 package...",
    );

    info!("Installing MatAnyone2 from {}", target_dir.display());

    // Pre-install charset-normalizer as cchardet replacement
    let venv_str = get_venv_dir().to_string_lossy().to_string();
    let _ = silent_cmd(uv_path)
        .args(["pip", "install", "charset-normalizer", "-p", &venv_str])
        .output()
        .await;

    let src_str = target_dir.to_string_lossy().to_string();

    let output = silent_cmd(uv_path)
        .args(["pip", "install", &src_str, "-p", &venv_str])
        .output()
        .await
        .context("Failed to run uv pip install for MatAnyone2")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!("Failed to install MatAnyone2: {}", stderr.trim());
    }

    progress(
        SetupStep::InstallMatAnyone,
        1.0,
        "MatAnyone2 installed",
    );
    info!("MatAnyone2 installed successfully");
    Ok(())
}

/// Replace `cchardet` with `charset-normalizer` in MatAnyone2 project files.
/// cchardet fails to compile on Python >= 3.10 (missing longintrepr.h).
async fn patch_cchardet_dependency(project_dir: &Path) {
    let files_to_patch = [
        "setup.cfg",
        "setup.py",
        "pyproject.toml",
        "requirements.txt",
    ];

    for filename in &files_to_patch {
        let filepath = project_dir.join(filename);
        if let Ok(content) = tokio::fs::read_to_string(&filepath).await {
            if content.contains("cchardet") {
                let patched = content
                    .replace("cchardet", "charset-normalizer")
                    .replace("charset-normalizer>=2.1", "charset-normalizer>=3.0");
                if let Err(e) = tokio::fs::write(&filepath, &patched).await {
                    warn!("Failed to patch {}: {}", filename, e);
                } else {
                    info!("Patched {} — replaced cchardet with charset-normalizer", filename);
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const PYTORCH_RUNTIME_CHECK: &str = r#"
import os
import sys
import torch

require_cuda = os.environ.get("MASTERSELECTS_REQUIRE_CUDA") == "1"
if require_cuda and not torch.cuda.is_available():
    print("CUDA build is required but torch.cuda.is_available() is false", file=sys.stderr)
    sys.exit(2)

if torch.cuda.is_available():
    major, minor = torch.cuda.get_device_capability(0)
    arch = f"sm_{major}{minor}"
    arch_list = set(torch.cuda.get_arch_list())
    if arch_list and arch not in arch_list:
        supported = ",".join(sorted(arch_list))
        print(f"GPU architecture {arch} is not supported by this PyTorch wheel ({supported})", file=sys.stderr)
        sys.exit(3)

print("ok")
"#;

async fn validate_pytorch_runtime(python: &Path, require_cuda: bool) -> Result<(), String> {
    if !python.exists() {
        return Err(format!("Python not found at {}", python.display()));
    }

    let mut cmd = silent_cmd(python);
    if require_cuda {
        cmd.env("MASTERSELECTS_REQUIRE_CUDA", "1");
    }

    let output = cmd
        .args(["-c", PYTORCH_RUNTIME_CHECK])
        .output()
        .await
        .map_err(|e| format!("Failed to run PyTorch validation: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    if output.status.success() && stdout.trim().contains("ok") {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    let message = [stdout.trim(), stderr.trim()]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ");

    Err(if message.is_empty() {
        "PyTorch validation failed without output".to_string()
    } else {
        message
    })
}

/// Validate that the full environment is operational by importing MatAnyone2.
async fn validate_installation(
    progress: &impl Fn(SetupStep, f32, &str),
) -> Result<()> {
    progress(SetupStep::Validate, 0.0, "Validating installation...");

    let venv_python = get_venv_python();

    if !venv_python.exists() {
        bail!(
            "Venv Python not found at {}",
            venv_python.display()
        );
    }

    let cuda = detect_cuda().await;
    if let Err(reason) = validate_pytorch_runtime(&venv_python, cuda.available).await {
        bail!("PyTorch runtime validation failed: {}", reason);
    }

    let output = silent_cmd(&venv_python)
        .args([
            "-c",
            "from matanyone2 import MatAnyone2; print('ok')",
        ])
        .output()
        .await
        .context("Failed to run validation command")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!(
            "MatAnyone2 import validation failed: {}",
            stderr.trim()
        );
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    if !stdout.trim().contains("ok") {
        bail!(
            "MatAnyone2 validation returned unexpected output: {}",
            stdout.trim()
        );
    }

    progress(SetupStep::Validate, 1.0, "Installation validated successfully");
    info!("MatAnyone2 installation validated");
    Ok(())
}

/// Check whether a Python package can be imported (async).
async fn check_package_importable(python: &Path, package: &str) -> bool {
    let result = silent_cmd(python)
        .args(["-c", &format!("import {}; print('ok')", package)])
        .output()
        .await;

    match result {
        Ok(output) => {
            output.status.success()
                && String::from_utf8_lossy(&output.stdout)
                    .trim()
                    .contains("ok")
        }
        Err(_) => false,
    }
}

/// Synchronous check whether torch is importable in the venv.
fn check_deps_installed_sync() -> bool {
    let python = get_venv_python();
    if !python.exists() {
        return false;
    }
    match silent_cmd_std(&python)
        .args(["-c", PYTORCH_RUNTIME_CHECK])
        .output()
    {
        Ok(output) => {
            output.status.success()
                && String::from_utf8_lossy(&output.stdout)
                    .trim()
                    .contains("ok")
        }
        Err(_) => false,
    }
}

/// Synchronous check whether matanyone2 is importable in the venv.
fn check_matanyone_installed_sync() -> bool {
    let python = get_venv_python();
    if !python.exists() {
        return false;
    }
    match silent_cmd_std(&python)
        .args(["-c", "import matanyone2; print('ok')"])
        .output()
    {
        Ok(output) => {
            output.status.success()
                && String::from_utf8_lossy(&output.stdout)
                    .trim()
                    .contains("ok")
        }
        Err(_) => false,
    }
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
    progress_callback: impl Fn(SetupStep, f32, &str),
) -> Result<EnvInfo, String> {
    let result = setup_environment_inner(&progress_callback).await;
    result.map_err(|e| format!("{:#}", e))
}

async fn setup_environment_inner(
    progress: &impl Fn(SetupStep, f32, &str),
) -> Result<EnvInfo> {
    info!("Starting MatAnyone2 environment setup");
    let data_dir = get_data_dir();
    info!("Data directory: {}", data_dir.display());

    tokio::fs::create_dir_all(&data_dir)
        .await
        .context("Failed to create data directory")?;

    // Step 1: Download uv
    let uv_path = download_uv(progress).await?;

    // Step 2: Detect system Python (informational — uv can install its own)
    progress(SetupStep::InstallPython, 0.0, "Detecting system Python...");
    let (python_path, python_version) = detect_system_python_async().await;
    if let Some(ref ver) = python_version {
        info!("System Python: {} ({})", python_path.as_ref().unwrap().display(), ver);
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

    // Step 3: Detect CUDA
    let cuda = detect_cuda().await;

    // Step 4: Create venv
    create_venv(&uv_path, progress).await?;

    // Step 5: Install PyTorch
    install_pytorch(&uv_path, &cuda, progress).await?;

    // Step 6: Install MatAnyone2
    install_matanyone(&uv_path, progress).await?;

    // Step 7: Validate
    validate_installation(progress).await?;

    let env_info = EnvInfo {
        uv_path: Some(uv_path),
        python_path,
        python_version,
        venv_path: get_venv_dir(),
        venv_exists: true,
        deps_installed: true,
        matanyone_installed: true,
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
            parse_python_version("Python 3.12.2"),
            Some("3.12.2".to_string())
        );
        assert_eq!(
            parse_python_version("Python 3.10.0"),
            Some("3.10.0".to_string())
        );
        assert_eq!(parse_python_version("not a version"), None);
        assert_eq!(parse_python_version(""), None);
    }

    #[test]
    fn test_parse_cuda_version() {
        assert_eq!(parse_cuda_version("13.2"), Some((13, 2)));
        assert_eq!(parse_cuda_version("12.8"), Some((12, 8)));
        assert_eq!(parse_cuda_version("12"), Some((12, 0)));
        assert_eq!(parse_cuda_version("CUDA 12.8"), None);
    }

    #[test]
    fn test_is_version_gte() {
        assert!(is_version_gte("3.12.2", 3, 10));
        assert!(is_version_gte("3.10.0", 3, 10));
        assert!(!is_version_gte("3.9.7", 3, 10));
        assert!(!is_version_gte("2.7.18", 3, 10));
        assert!(is_version_gte("4.0.0", 3, 10));
    }

    #[test]
    fn test_parse_gpu_csv() {
        let (name, vram) = parse_gpu_csv("NVIDIA GeForce RTX 4090, 24564");
        assert_eq!(name.as_deref(), Some("NVIDIA GeForce RTX 4090"));
        assert_eq!(vram, Some(24564));

        let (name, vram) = parse_gpu_csv("Tesla V100-SXM2-16GB, 16384");
        assert_eq!(name.as_deref(), Some("Tesla V100-SXM2-16GB"));
        assert_eq!(vram, Some(16384));

        let (name, vram) = parse_gpu_csv("");
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
            pytorch_index_candidates(&cuda_132),
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
        assert!(pytorch_index_candidates(&cuda_128)[0].contains("cu128"));

        let cuda_126 = CudaInfo {
            available: true,
            version: Some("12.6".to_string()),
            gpu_name: None,
            vram_mb: None,
        };
        assert!(pytorch_index_candidates(&cuda_126)[0].contains("cu126"));

        let cuda_121 = CudaInfo {
            available: true,
            version: Some("12.1".to_string()),
            gpu_name: None,
            vram_mb: None,
        };
        assert!(pytorch_index_candidates(&cuda_121)[0].contains("cu121"));

        let cuda_118 = CudaInfo {
            available: true,
            version: Some("11.8".to_string()),
            gpu_name: None,
            vram_mb: None,
        };
        assert!(pytorch_index_candidates(&cuda_118)[0].contains("cu118"));

        let no_cuda = CudaInfo {
            available: false,
            version: None,
            gpu_name: None,
            vram_mb: None,
        };
        assert!(pytorch_index_candidates(&no_cuda)[0].contains("cpu"));
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
        let target = get_uv_target();
        assert!(!target.is_empty());
        // Should contain a known OS substring
        assert!(
            target.contains("windows") || target.contains("darwin") || target.contains("linux"),
            "Unexpected target: {}",
            target
        );
    }
}
