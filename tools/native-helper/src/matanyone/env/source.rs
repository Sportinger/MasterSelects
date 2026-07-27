//! Pinned MatAnyone2 source installation and dependency patching.

use super::bootstrap::{download_file, extract_zip};
use super::platform::check_package_importable;
use super::*;
use tracing::{info, warn};

/// Download and install MatAnyone2 from GitHub.
pub(super) async fn install_matanyone(
    uv_path: &Path,
    progress: &impl Fn(SetupStep, f32, &str),
) -> Result<()> {
    let venv_python = get_venv_python();

    let marker_path = get_data_dir().join(SOURCE_REVISION_MARKER);
    let installed_revision = tokio::fs::read_to_string(&marker_path)
        .await
        .ok()
        .map(|value| value.trim().to_string());

    // Importability alone is not enough: update stale or unmarked installs.
    if check_package_importable(&venv_python, "matanyone2").await
        && installed_revision.as_deref() == Some(MATANYONE_REVISION)
    {
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
    let zip_url = format!("https://github.com/pq-yang/MatAnyone2/archive/{MATANYONE_REVISION}.zip");
    let zip_path = data_dir.join("matanyone2-source.zip");

    tokio::fs::create_dir_all(&data_dir)
        .await
        .context("Failed to create data directory")?;

    download_file(&zip_url, &zip_path).await?;

    progress(SetupStep::InstallMatAnyone, 0.3, "Extracting MatAnyone2...");

    // Extract
    extract_zip(&zip_path, &data_dir).await?;
    let _ = tokio::fs::remove_file(&zip_path).await;

    // GitHub commit archives extract to `MatAnyone2-<revision>/`.
    let extracted_dir = data_dir.join(format!("MatAnyone2-{MATANYONE_REVISION}"));
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
    patch_duplicate_hatch_force_include(&target_dir).await;

    progress(
        SetupStep::InstallMatAnyone,
        0.5,
        "Installing MatAnyone2 package...",
    );

    info!("Installing MatAnyone2 from {}", target_dir.display());

    // Pre-install charset-normalizer as cchardet replacement
    let venv_str = get_venv_dir().to_string_lossy().to_string();
    let _ = matanyone_uv_cmd(uv_path)
        .args(["pip", "install", "charset-normalizer", "-p", &venv_str])
        .output()
        .await;

    let src_str = target_dir.to_string_lossy().to_string();

    let output = matanyone_uv_cmd(uv_path)
        .args(["pip", "install", &src_str, "-p", &venv_str])
        .output()
        .await
        .context("Failed to run uv pip install for MatAnyone2")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!("Failed to install MatAnyone2: {}", stderr.trim());
    }

    tokio::fs::write(&marker_path, MATANYONE_REVISION)
        .await
        .context("Failed to record MatAnyone2 source revision")?;

    progress(SetupStep::InstallMatAnyone, 1.0, "MatAnyone2 installed");
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
                    info!(
                        "Patched {} — replaced cchardet with charset-normalizer",
                        filename
                    );
                }
            }
        }
    }
}

/// MatAnyone2 already includes the `matanyone2` package in its wheel target.
/// Force-including its config directory a second time makes Hatch reject the
/// wheel because files such as `config/__init__.py` collide.
async fn patch_duplicate_hatch_force_include(project_dir: &Path) {
    let path = project_dir.join("pyproject.toml");
    let Ok(content) = tokio::fs::read_to_string(&path).await else {
        return;
    };
    let patched = remove_duplicate_hatch_force_include(&content);
    if patched != content {
        if let Err(error) = tokio::fs::write(&path, patched).await {
            warn!("Failed to patch {}: {}", path.display(), error);
        } else {
            info!(
                "Removed duplicate Hatch force-include from {}",
                path.display()
            );
        }
    }
}

fn remove_duplicate_hatch_force_include(content: &str) -> String {
    content
        .replace(
            "[tool.hatch.build.targets.wheel.force-include]\r\n\"matanyone2/config\" = \"matanyone2/config\"\r\n",
            "",
        )
        .replace(
            "[tool.hatch.build.targets.wheel.force-include]\n\"matanyone2/config\" = \"matanyone2/config\"\n",
            "",
        )
}

#[cfg(test)]
mod tests {
    use super::remove_duplicate_hatch_force_include;

    #[test]
    fn removes_duplicate_hatch_config_inclusion() {
        let source = concat!(
            "[tool.hatch.build.targets.wheel]\n",
            "packages = [\"matanyone2\"]\n\n",
            "[tool.hatch.build.targets.wheel.force-include]\n",
            "\"matanyone2/config\" = \"matanyone2/config\"\n\n",
            "[tool.hatch.build.targets.sdist]\n",
        );
        let patched = remove_duplicate_hatch_force_include(source);
        assert!(patched.contains("packages = [\"matanyone2\"]"));
        assert!(!patched.contains("force-include"));
        assert!(patched.contains("[tool.hatch.build.targets.sdist]"));
    }
}
