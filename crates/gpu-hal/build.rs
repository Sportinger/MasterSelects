//! Build script for `ms-gpu-hal` — compiles GPU kernels.
//!
//! CUDA: Compiles `.cu` files in `kernels/cuda/` to `.ptx` using `nvcc`.
//! Vulkan: Compiles `.comp` files in `kernels/vulkan/` to `.spv` using `glslc`.
//!
//! Both toolchains are optional. If nvcc or glslc are not found, the build
//! prints a warning and sets cfg flags so the crate can still compile without
//! GPU kernel support.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    // Register custom cfg flags so Cargo does not warn about them.
    println!("cargo::rustc-check-cfg=cfg(no_cuda_kernels)");
    println!("cargo::rustc-check-cfg=cfg(no_vulkan_kernels)");

    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR not set"));

    // Workspace root is two levels up from crates/gpu-hal/
    let manifest_dir =
        PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR not set"));
    let workspace_root = manifest_dir
        .parent()
        .and_then(|p| p.parent())
        .expect("Cannot determine workspace root");

    let cuda_kernel_dir = workspace_root.join("kernels").join("cuda");
    let vulkan_kernel_dir = workspace_root.join("kernels").join("vulkan");

    // -------------------------------------------------------------------------
    // CUDA kernel compilation
    // -------------------------------------------------------------------------
    let cuda_enabled = env::var("CARGO_FEATURE_CUDA").is_ok();
    if cuda_enabled {
        compile_cuda_kernels(&cuda_kernel_dir, &out_dir);
    }

    // -------------------------------------------------------------------------
    // Vulkan shader compilation
    // -------------------------------------------------------------------------
    let vulkan_enabled = env::var("CARGO_FEATURE_VULKAN").is_ok();
    if vulkan_enabled {
        compile_vulkan_shaders(&vulkan_kernel_dir, &out_dir);
    }
}

// =============================================================================
// CUDA compilation
// =============================================================================

/// Find the `nvcc` compiler.
///
/// Search order:
/// 1. `CUDA_PATH` environment variable (e.g. `C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.x`)
/// 2. `PATH` lookup
fn find_nvcc() -> Option<PathBuf> {
    // Try CUDA_PATH first
    if let Ok(cuda_path) = env::var("CUDA_PATH") {
        let nvcc = Path::new(&cuda_path).join("bin").join(nvcc_binary_name());
        if nvcc.exists() {
            return Some(nvcc);
        }
    }

    // Try PATH
    let nvcc_name = nvcc_binary_name();
    if let Ok(output) = Command::new(if cfg!(target_os = "windows") {
        "where"
    } else {
        "which"
    })
    .arg(nvcc_name)
    .output()
    {
        if output.status.success() {
            let path_str = String::from_utf8_lossy(&output.stdout);
            let first_line = path_str.lines().next().unwrap_or("").trim();
            if !first_line.is_empty() {
                return Some(PathBuf::from(first_line));
            }
        }
    }

    None
}

fn nvcc_binary_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "nvcc.exe"
    } else {
        "nvcc"
    }
}

fn compile_cuda_kernels(kernel_dir: &Path, out_dir: &Path) {
    let ptx_dir = out_dir.join("ptx");
    fs::create_dir_all(&ptx_dir).expect("Failed to create PTX output directory");

    let nvcc = match find_nvcc() {
        Some(path) => {
            println!("cargo:warning=Found nvcc at: {}", path.display());
            path
        }
        None => {
            println!("cargo:warning=nvcc not found. CUDA kernels will NOT be compiled.");
            println!("cargo:warning=Set CUDA_PATH or add nvcc to PATH to enable CUDA kernel compilation.");
            println!("cargo:rustc-cfg=no_cuda_kernels");
            return;
        }
    };

    if !kernel_dir.exists() {
        println!(
            "cargo:warning=CUDA kernel directory not found: {}",
            kernel_dir.display()
        );
        println!("cargo:rustc-cfg=no_cuda_kernels");
        return;
    }

    let cu_files = collect_files(kernel_dir, "cu");
    if cu_files.is_empty() {
        println!(
            "cargo:warning=No .cu files found in {}",
            kernel_dir.display()
        );
        println!("cargo:rustc-cfg=no_cuda_kernels");
        return;
    }

    let mut all_succeeded = true;

    for cu_file in &cu_files {
        // Rerun if this source file changes
        println!("cargo:rerun-if-changed={}", cu_file.display());

        let stem = cu_file
            .file_stem()
            .expect("No file stem")
            .to_str()
            .expect("Non-UTF8 filename");
        let ptx_output = ptx_dir.join(format!("{stem}.ptx"));

        println!(
            "cargo:warning=Compiling CUDA kernel: {} -> {}",
            cu_file.display(),
            ptx_output.display()
        );

        // nvcc flags:
        //   --ptx            : Output PTX assembly
        //   -arch=sm_75      : Minimum compute capability (Turing, GTX 16xx / RTX 20xx+)
        //   -O3              : Maximum optimization
        //   --use_fast_math  : Enable fast math intrinsics
        //   -o               : Output file
        //   -Wno-deprecated-gpu-targets : Suppress deprecation warnings for older archs
        let mut cmd = Command::new(&nvcc);
        cmd.arg("--ptx")
            .arg("-arch=sm_75")
            .arg("-O3")
            .arg("--use_fast_math")
            .arg("-Wno-deprecated-gpu-targets")
            .arg("-o")
            .arg(&ptx_output)
            .arg(cu_file);

        // On Windows, nvcc needs cl.exe (MSVC) as host compiler. If it's not
        // in PATH, try to find it from Visual Studio Build Tools.
        if cfg!(target_os = "windows") {
            if let Some(cl_dir) = find_msvc_cl_dir() {
                let current_path = env::var("PATH").unwrap_or_default();
                let new_path = format!("{};{}", cl_dir.display(), current_path);
                cmd.env("PATH", new_path);
            }
        }

        let status = cmd.status();

        match status {
            Ok(s) if s.success() => {
                println!("cargo:warning=Successfully compiled CUDA kernel: {stem}.ptx");
            }
            Ok(s) => {
                println!(
                    "cargo:warning=nvcc failed for {stem}.cu with exit code: {}",
                    s.code().unwrap_or(-1)
                );
                all_succeeded = false;
            }
            Err(e) => {
                println!("cargo:warning=Failed to run nvcc for {stem}.cu: {e}");
                all_succeeded = false;
            }
        }
    }

    if !all_succeeded {
        println!(
            "cargo:warning=Some CUDA kernels failed to compile. Falling back to no-kernel mode."
        );
        println!("cargo:rustc-cfg=no_cuda_kernels");
    }

    // Rerun if any new .cu files are added to the directory
    println!("cargo:rerun-if-changed={}", kernel_dir.display());
}

// =============================================================================
// Vulkan shader compilation
// =============================================================================

/// Find the `glslc` compiler.
///
/// Search order:
/// 1. `VULKAN_SDK` environment variable
/// 2. `PATH` lookup
fn find_glslc() -> Option<PathBuf> {
    // Try VULKAN_SDK first
    if let Ok(vulkan_sdk) = env::var("VULKAN_SDK") {
        let glslc = Path::new(&vulkan_sdk).join("Bin").join(glslc_binary_name());
        if glslc.exists() {
            return Some(glslc);
        }
        // Also try lowercase 'bin' (Linux convention)
        let glslc = Path::new(&vulkan_sdk).join("bin").join(glslc_binary_name());
        if glslc.exists() {
            return Some(glslc);
        }
    }

    // Try PATH
    let glslc_name = glslc_binary_name();
    if let Ok(output) = Command::new(if cfg!(target_os = "windows") {
        "where"
    } else {
        "which"
    })
    .arg(glslc_name)
    .output()
    {
        if output.status.success() {
            let path_str = String::from_utf8_lossy(&output.stdout);
            let first_line = path_str.lines().next().unwrap_or("").trim();
            if !first_line.is_empty() {
                return Some(PathBuf::from(first_line));
            }
        }
    }

    None
}

fn glslc_binary_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "glslc.exe"
    } else {
        "glslc"
    }
}

fn compile_vulkan_shaders(kernel_dir: &Path, out_dir: &Path) {
    let spv_dir = out_dir.join("spv");
    fs::create_dir_all(&spv_dir).expect("Failed to create SPV output directory");

    let glslc = match find_glslc() {
        Some(path) => {
            println!("cargo:warning=Found glslc at: {}", path.display());
            path
        }
        None => {
            println!("cargo:warning=glslc not found. Vulkan shaders will NOT be compiled.");
            println!("cargo:warning=Set VULKAN_SDK or add glslc to PATH to enable Vulkan shader compilation.");
            println!("cargo:rustc-cfg=no_vulkan_kernels");
            return;
        }
    };

    if !kernel_dir.exists() {
        println!(
            "cargo:warning=Vulkan shader directory not found: {}",
            kernel_dir.display()
        );
        println!("cargo:rustc-cfg=no_vulkan_kernels");
        return;
    }

    let comp_files = collect_files(kernel_dir, "comp");
    if comp_files.is_empty() {
        println!(
            "cargo:warning=No .comp files found in {}",
            kernel_dir.display()
        );
        println!("cargo:rustc-cfg=no_vulkan_kernels");
        return;
    }

    let mut all_succeeded = true;

    for comp_file in &comp_files {
        // Rerun if this source file changes
        println!("cargo:rerun-if-changed={}", comp_file.display());

        let stem = comp_file
            .file_stem()
            .expect("No file stem")
            .to_str()
            .expect("Non-UTF8 filename");
        let spv_output = spv_dir.join(format!("{stem}.spv"));

        println!(
            "cargo:warning=Compiling Vulkan shader: {} -> {}",
            comp_file.display(),
            spv_output.display()
        );

        // glslc flags:
        //   -fshader-stage=compute : Explicit stage (in case extension is not recognized)
        //   -O                    : Optimize
        //   --target-env=vulkan1.0 : Target Vulkan 1.0 for widest compatibility
        //   -o                    : Output file
        let status = Command::new(&glslc)
            .arg("-fshader-stage=compute")
            .arg("-O")
            .arg("--target-env=vulkan1.0")
            .arg("-o")
            .arg(&spv_output)
            .arg(comp_file)
            .status();

        match status {
            Ok(s) if s.success() => {
                println!("cargo:warning=Successfully compiled Vulkan shader: {stem}.spv");
            }
            Ok(s) => {
                println!(
                    "cargo:warning=glslc failed for {stem}.comp with exit code: {}",
                    s.code().unwrap_or(-1)
                );
                all_succeeded = false;
            }
            Err(e) => {
                println!("cargo:warning=Failed to run glslc for {stem}.comp: {e}");
                all_succeeded = false;
            }
        }
    }

    if !all_succeeded {
        println!(
            "cargo:warning=Some Vulkan shaders failed to compile. Falling back to no-kernel mode."
        );
        println!("cargo:rustc-cfg=no_vulkan_kernels");
    }

    // Rerun if any new .comp files are added to the directory
    println!("cargo:rerun-if-changed={}", kernel_dir.display());
}

// =============================================================================
// Helpers
// =============================================================================

/// Find the directory containing MSVC `cl.exe` for nvcc's host compiler.
///
/// Searches common Visual Studio installation paths. Returns the directory
/// containing cl.exe (not the executable itself) so it can be added to PATH.
#[cfg(target_os = "windows")]
fn find_msvc_cl_dir() -> Option<PathBuf> {
    let vs_paths = [
        r"C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC",
        r"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC",
        r"C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Tools\MSVC",
        r"C:\Program Files\Microsoft Visual Studio\2022\Professional\VC\Tools\MSVC",
        r"C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Tools\MSVC",
    ];

    for vs_path in &vs_paths {
        let msvc_dir = Path::new(vs_path);
        if !msvc_dir.exists() {
            continue;
        }
        // Find the latest version directory
        if let Ok(entries) = fs::read_dir(msvc_dir) {
            let mut versions: Vec<PathBuf> = entries
                .flatten()
                .map(|e| e.path())
                .filter(|p| p.is_dir())
                .collect();
            versions.sort();
            if let Some(latest) = versions.last() {
                let cl_dir = latest.join("bin").join("Hostx64").join("x64");
                let cl_exe = cl_dir.join("cl.exe");
                if cl_exe.exists() {
                    println!("cargo:warning=Found MSVC cl.exe at: {}", cl_exe.display());
                    return Some(cl_dir);
                }
            }
        }
    }

    None
}

#[cfg(not(target_os = "windows"))]
fn find_msvc_cl_dir() -> Option<PathBuf> {
    None
}

/// Collect all files with the given extension from a directory (non-recursive).
fn collect_files(dir: &Path, extension: &str) -> Vec<PathBuf> {
    let mut files = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(ext) = path.extension() {
                    if ext == extension {
                        files.push(path);
                    }
                }
            }
        }
    }
    files.sort();
    files
}
