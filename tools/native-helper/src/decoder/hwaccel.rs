//! Cross-platform hardware acceleration detection

/// Detect available hardware acceleration methods
pub fn detect_hw_accel() -> Vec<String> {
    let mut available = Vec::new();

    #[cfg(target_os = "windows")]
    {
        // DXVA2 is always available on Windows Vista+
        available.push("dxva2".to_string());

        // D3D11VA is available on Windows 8+
        available.push("d3d11va".to_string());

        // Check for NVIDIA GPU (NVDEC)
        if has_nvidia_gpu_windows() {
            available.push("nvdec".to_string());
        }

        // Check for AMD GPU (AMF)
        if has_amd_gpu_windows() {
            available.push("amf".to_string());
        }

        // Check for Intel GPU (QSV)
        if has_intel_gpu_windows() {
            available.push("qsv".to_string());
        }
    }

    #[cfg(target_os = "linux")]
    {
        // Check for VAAPI (Intel/AMD on Linux)
        if std::path::Path::new("/dev/dri/renderD128").exists() {
            available.push("vaapi".to_string());
        }

        // Check for NVDEC (NVIDIA)
        if std::path::Path::new("/dev/nvidia0").exists() {
            available.push("nvdec".to_string());
        }

        // Check for V4L2 (Raspberry Pi, some ARM)
        if std::path::Path::new("/dev/video10").exists() {
            available.push("v4l2m2m".to_string());
        }
    }

    #[cfg(target_os = "macos")]
    {
        // VideoToolbox is always available on macOS
        available.push("videotoolbox".to_string());
    }

    available
}

#[cfg(target_os = "windows")]
fn has_nvidia_gpu_windows() -> bool {
    // Check for NVIDIA driver DLL
    let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
    let nvapi = std::path::PathBuf::from(&system_root)
        .join("System32")
        .join("nvapi64.dll");
    nvapi.exists()
}

#[cfg(target_os = "windows")]
fn has_amd_gpu_windows() -> bool {
    // Check for AMD driver DLL
    let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
    let amf = std::path::PathBuf::from(&system_root)
        .join("System32")
        .join("amfrt64.dll");
    amf.exists()
}

#[cfg(target_os = "windows")]
fn has_intel_gpu_windows() -> bool {
    // Check for Intel QSV runtime
    let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
    let mfx = std::path::PathBuf::from(&system_root)
        .join("System32")
        .join("mfx_dispatch.dll");
    // Also check for newer oneVPL
    let vpl = std::path::PathBuf::from(&system_root)
        .join("System32")
        .join("libmfxhw64.dll");
    mfx.exists() || vpl.exists()
}
