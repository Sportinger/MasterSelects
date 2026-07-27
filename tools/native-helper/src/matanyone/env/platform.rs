//! Platform detection, managed Python environment, PyTorch, and validation.

use super::*;
use tracing::{debug, info, warn};

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
        info!("No accessible CUDA-capable GPU detected; MatAnyone2 is unavailable");
    }

    CudaInfo {
        available,
        version: cuda_version,
        gpu_name,
        vram_mb,
    }
}

/// Parse a CSV line like `"NVIDIA GeForce RTX 4090, 24564"`.
pub(super) fn parse_gpu_csv(line: &str) -> (Option<String>, Option<u64>) {
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
    let output = silent_cmd("nvidia-smi").output().await.ok()?;

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
pub(super) fn detect_system_python_sync() -> (Option<PathBuf>, Option<String>) {
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
pub(super) async fn detect_system_python_async() -> (Option<PathBuf>, Option<String>) {
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
pub(super) fn parse_python_version(output: &str) -> Option<String> {
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
pub(super) fn is_version_gte(version: &str, major: u32, minor: u32) -> bool {
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

/// Parse a CUDA version string like `"12.8"` or `"13.2"`.
/// Create a Python virtual environment using `uv`.
pub(super) async fn create_venv(
    uv_path: &Path,
    requested_python: Option<&Path>,
    progress: &impl Fn(SetupStep, f32, &str),
) -> Result<()> {
    let venv_dir = get_venv_dir();

    // If venv already exists and has a working python, skip
    if get_venv_python().exists() {
        info!("Venv already exists at {}", venv_dir.display());
        progress(
            SetupStep::CreateVenv,
            1.0,
            "Virtual environment already exists",
        );
        return Ok(());
    }

    progress(
        SetupStep::CreateVenv,
        0.0,
        "Creating Python virtual environment...",
    );
    info!("Creating venv at {}", venv_dir.display());

    tokio::fs::create_dir_all(&venv_dir)
        .await
        .context("Failed to create venv directory")?;

    if let Some(python) = requested_python {
        if !python.is_file() {
            bail!(
                "Requested Python interpreter does not exist: {}",
                python.display()
            );
        }
        let validation = silent_cmd(python)
            .arg("--version")
            .output()
            .await
            .context("Failed to run requested Python interpreter")?;
        let version_output = if validation.stdout.is_empty() {
            String::from_utf8_lossy(&validation.stderr)
        } else {
            String::from_utf8_lossy(&validation.stdout)
        };
        let valid = validation.status.success()
            && parse_python_version(version_output.trim())
                .map(|version| is_version_gte(&version, 3, 10))
                .unwrap_or(false);
        if !valid {
            bail!("Requested Python must be a working Python 3.10 or newer interpreter");
        }
    }

    let python_selector = requested_python
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| "3.11".to_string());
    let output = matanyone_uv_cmd(uv_path)
        .args([
            "venv",
            &venv_dir.to_string_lossy(),
            "--python",
            &python_selector,
        ])
        .output()
        .await
        .context("Failed to run uv venv")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if requested_python.is_some() {
            bail!(
                "Failed to create venv with requested Python: {}",
                stderr.trim()
            );
        }
        // If managed Python 3.11 is unavailable, let uv select a compatible runtime.
        warn!("uv venv with Python 3.11 failed: {}", stderr.trim());
        info!("Retrying venv creation without specific Python version...");

        progress(
            SetupStep::CreateVenv,
            0.3,
            "Python 3.11 not found, trying available Python...",
        );

        let output2 = matanyone_uv_cmd(uv_path)
            .args(["venv", &venv_dir.to_string_lossy()])
            .output()
            .await
            .context("Failed to run uv venv (fallback)")?;

        if !output2.status.success() {
            let stderr2 = String::from_utf8_lossy(&output2.stderr);
            bail!("Failed to create virtual environment: {}", stderr2.trim());
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
pub(super) async fn install_pytorch(
    uv_path: &Path,
    cuda: &CudaInfo,
    progress: &impl Fn(SetupStep, f32, &str),
) -> Result<()> {
    let venv_python = get_venv_python();
    if !cuda.available {
        bail!(GPU_REQUIRED_MESSAGE);
    }

    // Check if torch is already installed and usable for the current GPU.
    if validate_pytorch_runtime(&venv_python, true).await.is_ok() {
        info!("PyTorch already installed and compatible");
        progress(SetupStep::InstallPyTorch, 1.0, "PyTorch already installed");
        return Ok(());
    }

    let index_urls = pytorch_index_candidates(cuda);
    progress(
        SetupStep::InstallPyTorch,
        0.0,
        "Installing PyTorch (CUDA)...",
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

        let output = matanyone_uv_cmd(uv_path)
            .args(args)
            .output()
            .await
            .context("Failed to run uv pip install for PyTorch")?;

        if output.status.success() {
            if let Err(reason) = validate_pytorch_runtime(&venv_python, true).await {
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
pub(super) fn pytorch_index_candidates(cuda: &CudaInfo) -> Vec<String> {
    if !cuda.available {
        return Vec::new();
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
        Some(_) => vec!["https://download.pytorch.org/whl/cu128".to_string()],
        _ => {
            vec!["https://download.pytorch.org/whl/cu128".to_string()]
        }
    };

    candidates.dedup();
    candidates
}

pub(super) fn parse_cuda_version(version: &str) -> Option<(u32, u32)> {
    let mut parts = version.split('.');
    let major = parts.next()?.parse::<u32>().ok()?;
    let minor = parts.next().unwrap_or("0").parse::<u32>().ok()?;
    Some((major, minor))
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

pub async fn validate_cuda_runtime() -> Result<(), String> {
    validate_pytorch_runtime(&get_venv_python(), true)
        .await
        .map_err(|reason| format!("{GPU_REQUIRED_MESSAGE} {reason}"))
}

/// Validate that the full environment is operational by importing MatAnyone2.
pub(super) async fn validate_installation(progress: &impl Fn(SetupStep, f32, &str)) -> Result<()> {
    progress(SetupStep::Validate, 0.0, "Validating installation...");

    let venv_python = get_venv_python();

    if !venv_python.exists() {
        bail!("Venv Python not found at {}", venv_python.display());
    }

    if let Err(reason) = validate_cuda_runtime().await {
        bail!("PyTorch runtime validation failed: {}", reason);
    }

    let output = silent_cmd(&venv_python)
        .args(["-c", "from matanyone2 import MatAnyone2; print('ok')"])
        .output()
        .await
        .context("Failed to run validation command")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!("MatAnyone2 import validation failed: {}", stderr.trim());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    if !stdout.trim().contains("ok") {
        bail!(
            "MatAnyone2 validation returned unexpected output: {}",
            stdout.trim()
        );
    }

    progress(
        SetupStep::Validate,
        1.0,
        "Installation validated successfully",
    );
    info!("MatAnyone2 installation validated");
    Ok(())
}

/// Check whether a Python package can be imported (async).
pub(super) async fn check_package_importable(python: &Path, package: &str) -> bool {
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
pub(super) fn check_deps_installed_sync() -> bool {
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
pub(super) fn check_matanyone_installed_sync() -> bool {
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
