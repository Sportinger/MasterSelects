//! Self-update via GitHub Releases API
//!
//! Checks for newer `native-helper-v*` releases, downloads the MSI asset,
//! and launches `msiexec /i` to upgrade in-place.

#![cfg(windows)]

use std::path::{Path, PathBuf};

use anyhow::Result;

const GITHUB_API_RELEASES: &str =
    "https://api.github.com/repos/Sportinger/MasterSelects/releases";
const USER_AGENT: &str = "MasterSelects-Helper";
const TAG_PREFIX: &str = "native-helper-v";

/// Information about an available update
#[derive(Clone, Debug)]
pub struct UpdateInfo {
    pub version: String,
    pub download_url: String,
}

/// Query the GitHub Releases API for a newer native-helper release.
/// Returns `Some(UpdateInfo)` if a newer version with an MSI asset exists.
pub fn check_for_update() -> Result<Option<UpdateInfo>> {
    let body = ureq::get(GITHUB_API_RELEASES)
        .set("User-Agent", USER_AGENT)
        .set("Accept", "application/vnd.github.v3+json")
        .query("per_page", "10")
        .call()?
        .into_string()?;

    let releases: Vec<serde_json::Value> = serde_json::from_str(&body)?;
    let current = env!("CARGO_PKG_VERSION");

    for release in &releases {
        let tag = release["tag_name"].as_str().unwrap_or("");
        if !tag.starts_with(TAG_PREFIX) {
            continue;
        }

        let version = tag.trim_start_matches(TAG_PREFIX);
        if !is_newer(version, current) {
            // Releases are sorted newest-first; if this one isn't newer, none will be
            break;
        }

        // Find the MSI asset
        if let Some(assets) = release["assets"].as_array() {
            for asset in assets {
                let name = asset["name"].as_str().unwrap_or("");
                if name.ends_with(".msi") {
                    let url = asset["browser_download_url"]
                        .as_str()
                        .unwrap_or("")
                        .to_string();
                    if !url.is_empty() {
                        return Ok(Some(UpdateInfo {
                            version: version.to_string(),
                            download_url: url,
                        }));
                    }
                }
            }
        }
        break;
    }

    Ok(None)
}

/// Download the MSI from `url` to a temp file. Returns the path.
pub fn download_update(url: &str) -> Result<PathBuf> {
    let temp_path = std::env::temp_dir().join("MasterSelects-Helper-update.msi");

    let resp = ureq::get(url)
        .set("User-Agent", USER_AGENT)
        .call()?;

    let mut file = std::fs::File::create(&temp_path)?;
    std::io::copy(&mut resp.into_reader(), &mut file)?;

    Ok(temp_path)
}

/// Launch `msiexec /i <msi>` to install the update.
/// The MSI's MajorUpgrade handles removing the old version.
pub fn install_update(msi_path: &Path) -> Result<()> {
    // Launch msiexec detached — it will show the installer UI
    std::process::Command::new("msiexec")
        .arg("/i")
        .arg(msi_path)
        .spawn()?;
    Ok(())
}

/// Simple semver comparison: is `remote` strictly newer than `local`?
fn is_newer(remote: &str, local: &str) -> bool {
    let parse = |s: &str| -> (u32, u32, u32) {
        let mut parts = s.split('.').filter_map(|p| p.parse::<u32>().ok());
        (
            parts.next().unwrap_or(0),
            parts.next().unwrap_or(0),
            parts.next().unwrap_or(0),
        )
    };
    parse(remote) > parse(local)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_newer() {
        assert!(is_newer("0.3.0", "0.2.0"));
        assert!(is_newer("1.0.0", "0.9.9"));
        assert!(is_newer("0.2.1", "0.2.0"));
        assert!(!is_newer("0.2.0", "0.2.0"));
        assert!(!is_newer("0.1.0", "0.2.0"));
    }
}
