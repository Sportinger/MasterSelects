//! uv bootstrap, artifact download, and archive extraction.

use super::*;
use tracing::{debug, info};

/// Download the `uv` package manager from its official GitHub release.
pub(super) async fn download_uv(progress: &impl Fn(SetupStep, f32, &str)) -> Result<PathBuf> {
    let target = get_uv_target();
    let extension = if cfg!(windows) { "zip" } else { "tar.gz" };
    let url =
        format!("https://github.com/astral-sh/uv/releases/latest/download/uv-{target}.{extension}");
    let dest_dir = get_uv_dir();
    let dest_bin = get_uv_binary_path();

    if dest_bin.exists() {
        info!("uv already present at {}", dest_bin.display());
        return Ok(dest_bin);
    }

    progress(
        SetupStep::DownloadUv,
        0.0,
        "Downloading uv package manager...",
    );
    tokio::fs::create_dir_all(&dest_dir)
        .await
        .context("Failed to create uv directory")?;

    let archive_path = dest_dir.join(format!("uv-download.{extension}"));
    download_file(&url, &archive_path).await?;
    progress(SetupStep::DownloadUv, 0.5, "Extracting uv...");
    extract_uv_archive(&archive_path, &dest_dir).await?;

    let extracted_dir = dest_dir.join(format!("uv-{target}"));
    let binary_name = if cfg!(windows) { "uv.exe" } else { "uv" };
    let extracted_bin = extracted_dir.join(binary_name);
    if extracted_bin.exists() && extracted_bin != dest_bin {
        tokio::fs::rename(&extracted_bin, &dest_bin)
            .await
            .context("Failed to move uv binary")?;
        let _ = tokio::fs::remove_dir_all(&extracted_dir).await;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        tokio::fs::set_permissions(&dest_bin, std::fs::Permissions::from_mode(0o755))
            .await
            .context("Failed to set executable permissions on uv")?;
    }

    let _ = tokio::fs::remove_file(&archive_path).await;
    if !dest_bin.exists() {
        bail!(
            "uv binary not found at {} after extraction",
            dest_bin.display()
        );
    }
    progress(SetupStep::DownloadUv, 1.0, "uv downloaded successfully");
    Ok(dest_bin)
}

pub(super) fn get_uv_target() -> &'static str {
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
    } else if cfg!(target_arch = "aarch64") {
        "aarch64-unknown-linux-gnu"
    } else {
        "x86_64-unknown-linux-gnu"
    }
}

pub(super) async fn download_file(url: &str, dest: &Path) -> Result<()> {
    let curl_result = silent_cmd("curl")
        .args(["-fSL", "--retry", "3", "-o"])
        .arg(dest.as_os_str())
        .arg(url)
        .output()
        .await;
    match curl_result {
        Ok(output) if output.status.success() => return Ok(()),
        Ok(output) => debug!(
            "curl failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ),
        Err(error) => debug!("curl not available: {error}"),
    }

    #[cfg(windows)]
    {
        let script = format!(
            "Invoke-WebRequest -Uri '{}' -OutFile '{}' -UseBasicParsing",
            url,
            dest.display()
        );
        let result = silent_cmd("powershell")
            .args(["-NoProfile", "-Command", &script])
            .output()
            .await;
        match result {
            Ok(output) if output.status.success() => return Ok(()),
            Ok(output) => debug!(
                "PowerShell download failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ),
            Err(error) => debug!("PowerShell not available: {error}"),
        }
    }

    #[cfg(not(windows))]
    {
        let result = silent_cmd("wget")
            .args(["-q", "-O"])
            .arg(dest.as_os_str())
            .arg(url)
            .output()
            .await;
        match result {
            Ok(output) if output.status.success() => return Ok(()),
            Ok(output) => debug!(
                "wget failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ),
            Err(error) => debug!("wget not available: {error}"),
        }
    }

    bail!("Failed to download {url}: no working HTTP client found")
}

async fn extract_uv_archive(archive_path: &Path, dest_dir: &Path) -> Result<()> {
    #[cfg(windows)]
    {
        return extract_zip(archive_path, dest_dir).await;
    }
    #[cfg(not(windows))]
    {
        let result = silent_cmd("tar")
            .args(["-xzf"])
            .arg(archive_path)
            .arg("-C")
            .arg(dest_dir)
            .output()
            .await
            .context("Failed to run tar for uv extraction")?;
        if !result.status.success() {
            bail!(
                "uv archive extraction failed: {}",
                String::from_utf8_lossy(&result.stderr).trim()
            );
        }
        Ok(())
    }
}

/// Extract the pinned MatAnyone GitHub source archive, which is ZIP on every OS.
pub(super) async fn extract_zip(zip_path: &Path, dest_dir: &Path) -> Result<()> {
    #[cfg(windows)]
    {
        let script = format!(
            "Expand-Archive -Path '{}' -DestinationPath '{}' -Force",
            zip_path.display(),
            dest_dir.display()
        );
        let result = silent_cmd("powershell")
            .args(["-NoProfile", "-Command", &script])
            .output()
            .await
            .context("Failed to run PowerShell for zip extraction")?;
        if !result.status.success() {
            bail!(
                "Zip extraction failed: {}",
                String::from_utf8_lossy(&result.stderr).trim()
            );
        }
        return Ok(());
    }
    #[cfg(not(windows))]
    {
        let result = silent_cmd("unzip")
            .args(["-o", "-q"])
            .arg(zip_path)
            .arg("-d")
            .arg(dest_dir)
            .output()
            .await
            .context("Failed to run unzip")?;
        if !result.status.success() {
            bail!(
                "Zip extraction failed: {}",
                String::from_utf8_lossy(&result.stderr).trim()
            );
        }
        Ok(())
    }
}
