//! MuScriptor provider environment and gated model-cache management.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tokio::process::Command;
use tracing::info;

use crate::matanyone;

pub const MUSCRIPTOR_REVISION: &str = "302343e8992bdfc619f77f1988168374ed5d675d";
const SOURCE_MARKER: &str = "source-revision";
const DOWNLOAD_HEARTBEAT_INTERVAL: std::time::Duration = std::time::Duration::from_secs(15);
const BUNDLED_SERVER_SCRIPT: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/python/muscriptor_server.py"
));

pub const AVAILABLE_INSTRUMENTS: &[&str] = &[
    "acoustic_piano",
    "electric_piano",
    "chromatic_percussion",
    "organ",
    "acoustic_guitar",
    "clean_electric_guitar",
    "distorted_electric_guitar",
    "acoustic_bass",
    "electric_bass",
    "violin",
    "viola",
    "cello",
    "contrabass",
    "orchestral_harp",
    "timpani",
    "string_ensemble",
    "synth_strings",
    "voice",
    "orchestra_hit",
    "trumpet",
    "trombone",
    "tuba",
    "french_horn",
    "brass_section",
    "soprano_and_alto_sax",
    "tenor_sax",
    "baritone_sax",
    "oboe",
    "english_horn",
    "bassoon",
    "clarinet",
    "flutes",
    "synth_lead",
    "synth_pad",
    "drums",
];

pub fn get_temp_dir() -> PathBuf {
    get_data_dir().join("temp")
}

pub fn get_cache_path() -> PathBuf {
    get_cache_dir()
}

pub fn venv_python_version() -> Option<String> {
    let mut command = std::process::Command::new(get_venv_python());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let output = command.arg("--version").output().ok()?;
    let bytes = if output.stdout.is_empty() {
        output.stderr
    } else {
        output.stdout
    };
    String::from_utf8(bytes)
        .ok()
        .map(|value| value.trim().trim_start_matches("Python ").to_string())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ModelVariant {
    Small,
    Medium,
    Large,
}

impl ModelVariant {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Small => "small",
            Self::Medium => "medium",
            Self::Large => "large",
        }
    }

    fn repo(self) -> String {
        format!("MuScriptor/muscriptor-{}", self.as_str())
    }

    /// Immutable HuggingFace commit containing the config and weights for this
    /// variant. Keep this independent from `MUSCRIPTOR_REVISION`: source and
    /// model repositories have separate release histories.
    pub fn model_revision(self) -> &'static str {
        match self {
            Self::Small => "8c127f603b807520fa465c838e9bfee8a91ada4e",
            Self::Medium => "f32236969308476e01fd3aae67357de5feb05a2d",
            Self::Large => "8809fdfbed2affa7ade94a7059e746e3880720e7",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct EnvInfo {
    pub venv_path: PathBuf,
    pub venv_exists: bool,
    pub muscriptor_installed: bool,
    pub installed_revision: Option<String>,
    pub expected_revision: &'static str,
    pub cache_path: PathBuf,
    pub downloaded_variants: Vec<ModelVariant>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ModelMarker {
    source_revision: String,
    model_revision: String,
    model_path: PathBuf,
    config_path: PathBuf,
}

pub fn validate_variant(value: &str) -> Result<ModelVariant, String> {
    match value.trim().to_ascii_lowercase().as_str() {
        "small" => Ok(ModelVariant::Small),
        "medium" => Ok(ModelVariant::Medium),
        "large" => Ok(ModelVariant::Large),
        _ => Err("Invalid MuScriptor variant; expected small, medium, or large".to_string()),
    }
}

pub fn get_data_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("MasterSelects")
        .join("muscriptor")
}

fn get_venv_dir() -> PathBuf {
    get_data_dir().join("env")
}

pub fn get_venv_python() -> PathBuf {
    if cfg!(windows) {
        get_venv_dir().join("Scripts").join("python.exe")
    } else {
        get_venv_dir().join("bin").join("python")
    }
}

fn get_cache_dir() -> PathBuf {
    get_data_dir().join("cache")
}

fn get_revision_marker() -> PathBuf {
    get_data_dir().join(SOURCE_MARKER)
}

fn get_model_marker(variant: ModelVariant) -> PathBuf {
    get_data_dir()
        .join("models")
        .join(format!("{}.ready", variant.as_str()))
}

fn read_model_marker(variant: ModelVariant) -> Option<ModelMarker> {
    let marker: ModelMarker =
        serde_json::from_slice(&std::fs::read(get_model_marker(variant)).ok()?).ok()?;
    (marker.source_revision == MUSCRIPTOR_REVISION
        && marker.model_revision == variant.model_revision()
        && marker.model_path.is_file()
        && marker.config_path.is_file())
    .then_some(marker)
}

pub fn get_model_path(variant: ModelVariant) -> Result<PathBuf, String> {
    read_model_marker(variant)
        .map(|marker| marker.model_path)
        .ok_or_else(|| format!("MuScriptor {} model is not downloaded", variant.as_str()))
}

pub fn get_server_script_path() -> PathBuf {
    get_data_dir().join("muscriptor_server.py")
}

fn read_trimmed(path: &Path) -> Option<String> {
    std::fs::read_to_string(path)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn package_importable() -> bool {
    let python = get_venv_python();
    if !python.exists() {
        return false;
    }
    silent_std_command(&python)
        .args(["-c", "import muscriptor"])
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

pub fn get_env_info() -> EnvInfo {
    let installed_revision = read_trimmed(&get_revision_marker());
    let downloaded_variants = [
        ModelVariant::Small,
        ModelVariant::Medium,
        ModelVariant::Large,
    ]
    .into_iter()
    .filter(|variant| read_model_marker(*variant).is_some())
    .collect();

    EnvInfo {
        venv_path: get_venv_dir(),
        venv_exists: get_venv_python().is_file(),
        muscriptor_installed: package_importable()
            && installed_revision.as_deref() == Some(MUSCRIPTOR_REVISION),
        installed_revision,
        expected_revision: MUSCRIPTOR_REVISION,
        cache_path: get_cache_dir(),
        downloaded_variants,
    }
}

pub async fn ensure_server_script() -> Result<PathBuf, String> {
    let path = get_server_script_path();
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create MuScriptor directory: {e}"))?;
    }
    let needs_write = tokio::fs::read_to_string(&path)
        .await
        .map(|existing| existing != BUNDLED_SERVER_SCRIPT)
        .unwrap_or(true);
    if needs_write {
        tokio::fs::write(&path, BUNDLED_SERVER_SCRIPT)
            .await
            .map_err(|e| format!("Failed to write MuScriptor sidecar: {e}"))?;
    }
    Ok(path)
}

pub async fn setup_environment(progress: impl Fn(&str, f32, &str)) -> Result<EnvInfo, String> {
    progress(
        "prepare",
        0.0,
        "Preparing isolated MuScriptor environment...",
    );
    tokio::fs::create_dir_all(get_data_dir())
        .await
        .map_err(|e| format!("Failed to create MuScriptor data directory: {e}"))?;
    tokio::fs::create_dir_all(get_temp_dir())
        .await
        .map_err(|e| format!("Failed to create MuScriptor temp directory: {e}"))?;

    let uv = matanyone::env::ensure_uv_available().await?;
    progress("prepare", 15.0, "Managed Python runtime is ready");

    if !get_venv_python().is_file() {
        let mut command = matanyone::env::managed_uv_cmd(&uv, get_data_dir().join("uv-cache"));
        command.args([
            "venv",
            &get_venv_dir().to_string_lossy(),
            "--python",
            "3.11",
        ]);
        let output = command
            .output()
            .await
            .map_err(|e| format!("Failed to create MuScriptor venv: {e}"))?;
        if !output.status.success() {
            return Err(format!(
                "Failed to create MuScriptor venv: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
    }
    progress("venv", 30.0, "MuScriptor virtual environment is ready");

    let revision_matches =
        read_trimmed(&get_revision_marker()).as_deref() == Some(MUSCRIPTOR_REVISION);
    if !revision_matches || !package_importable() {
        let source =
            format!("https://github.com/muscriptor/muscriptor/archive/{MUSCRIPTOR_REVISION}.zip");
        let mut command = matanyone::env::managed_uv_cmd(&uv, get_data_dir().join("uv-cache"));
        command.args([
            "pip",
            "install",
            "--upgrade",
            &source,
            "-p",
            &get_venv_dir().to_string_lossy(),
        ]);
        progress("install", 40.0, "Installing pinned MuScriptor runtime...");
        let output = command
            .output()
            .await
            .map_err(|e| format!("Failed to install MuScriptor: {e}"))?;
        if !output.status.success() {
            return Err(format!(
                "Failed to install MuScriptor: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        tokio::fs::write(get_revision_marker(), MUSCRIPTOR_REVISION)
            .await
            .map_err(|e| format!("Failed to record MuScriptor revision: {e}"))?;
    }
    progress("install", 90.0, "Pinned MuScriptor runtime installed");

    if !package_importable() {
        return Err("MuScriptor validation import failed".to_string());
    }
    ensure_server_script().await?;
    progress("validate", 100.0, "MuScriptor setup complete");
    info!(
        revision = MUSCRIPTOR_REVISION,
        "MuScriptor environment ready"
    );
    Ok(get_env_info())
}

pub async fn download_model(
    variant: ModelVariant,
    hf_token: Option<String>,
    progress: impl Fn(f32, &str),
) -> Result<(), String> {
    if !get_env_info().muscriptor_installed {
        return Err("MuScriptor runtime is not installed".to_string());
    }
    tokio::fs::create_dir_all(get_cache_dir())
        .await
        .map_err(|e| format!("Failed to create MuScriptor cache: {e}"))?;
    if let Some(parent) = get_model_marker(variant).parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create MuScriptor model directory: {e}"))?;
    }

    progress(0.0, "Connecting to gated HuggingFace model repository...");
    let script = concat!(
        "from huggingface_hub import hf_hub_download\n",
        "import sys\n",
        "repo=sys.argv[1]\n",
        "revision=sys.argv[2]\n",
        "import json\n",
        "config=hf_hub_download(repo_id=repo, revision=revision, filename='config.json')\n",
        "model=hf_hub_download(repo_id=repo, revision=revision, filename='model.safetensors')\n",
        "print(json.dumps({'config_path': config, 'model_path': model}))\n",
    );
    let mut command = silent_command(get_venv_python());
    command
        .args(["-c", script, &variant.repo(), variant.model_revision()])
        .env("HF_HOME", get_cache_dir())
        .env("HF_HUB_DISABLE_PROGRESS_BARS", "1");
    if let Some(token) = hf_token.filter(|value| !value.trim().is_empty()) {
        // Intentionally transient: never write or log this credential.
        command.env("HF_TOKEN", token);
    }
    progress(5.0, "Downloading model weights...");
    let output = wait_for_download_with_heartbeats(command, &progress).await?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let safe_message = redact_hf_token(stderr.trim());
        return Err(if safe_message.is_empty() {
            "HuggingFace model download failed".to_string()
        } else {
            safe_message
        });
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let payload = stdout
        .lines()
        .rev()
        .find(|line| line.trim_start().starts_with('{'))
        .ok_or_else(|| "HuggingFace download did not report cached model paths".to_string())?;
    #[derive(Deserialize)]
    struct DownloadPaths {
        model_path: PathBuf,
        config_path: PathBuf,
    }
    let paths: DownloadPaths = serde_json::from_str(payload)
        .map_err(|e| format!("Invalid HuggingFace download result: {e}"))?;
    if !paths.model_path.is_file() || !paths.config_path.is_file() {
        return Err("HuggingFace download completed without usable model files".to_string());
    }
    let marker = ModelMarker {
        source_revision: MUSCRIPTOR_REVISION.to_string(),
        model_revision: variant.model_revision().to_string(),
        model_path: paths.model_path,
        config_path: paths.config_path,
    };
    tokio::fs::write(
        get_model_marker(variant),
        serde_json::to_vec_pretty(&marker)
            .map_err(|e| format!("Failed to serialize model marker: {e}"))?,
    )
    .await
    .map_err(|e| format!("Failed to record downloaded model: {e}"))?;
    progress(100.0, "MuScriptor model downloaded");
    Ok(())
}

async fn wait_for_download_with_heartbeats(
    mut command: Command,
    progress: &impl Fn(f32, &str),
) -> Result<std::process::Output, String> {
    let output = command.output();
    tokio::pin!(output);
    let mut heartbeat = tokio::time::interval(DOWNLOAD_HEARTBEAT_INTERVAL);
    heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    // Consume the interval's immediate first tick; the caller just emitted the
    // initial download progress event.
    heartbeat.tick().await;

    loop {
        tokio::select! {
            result = &mut output => {
                return result.map_err(|e| format!("Failed to start HuggingFace download: {e}"));
            }
            _ = heartbeat.tick() => {
                progress(5.0, "Model download is still active...");
            }
        }
    }
}

fn redact_hf_token(message: &str) -> String {
    let mut output = String::with_capacity(message.len());
    let bytes = message.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index..].starts_with(b"hf_") {
            output.push_str("[REDACTED]");
            index += 3;
            while index < bytes.len()
                && (bytes[index].is_ascii_alphanumeric() || matches!(bytes[index], b'_' | b'-'))
            {
                index += 1;
            }
        } else {
            let ch = message[index..]
                .chars()
                .next()
                .expect("valid utf-8 boundary");
            output.push(ch);
            index += ch.len_utf8();
        }
    }
    output
}

fn silent_command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
}

fn silent_std_command(program: impl AsRef<std::ffi::OsStr>) -> std::process::Command {
    let mut command = std::process::Command::new(program);
    command.stdout(std::process::Stdio::null());
    command.stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn variants_are_strict() {
        assert_eq!(validate_variant("small").unwrap(), ModelVariant::Small);
        assert!(validate_variant("default").is_err());
    }

    #[test]
    fn token_redaction_removes_hf_secrets() {
        let value = redact_hf_token("request token='hf_secret123', failed");
        assert_eq!(value, "request token='[REDACTED]', failed");
        assert!(!value.contains("secret123"));
    }

    #[test]
    fn provider_paths_are_separate_from_matanyone() {
        assert_ne!(get_data_dir(), matanyone::get_data_dir());
    }

    #[test]
    fn model_revisions_are_immutable_and_separate_from_source_revision() {
        for variant in [
            ModelVariant::Small,
            ModelVariant::Medium,
            ModelVariant::Large,
        ] {
            let revision = variant.model_revision();
            assert_eq!(revision.len(), 40);
            assert!(revision.chars().all(|value| value.is_ascii_hexdigit()));
            assert_ne!(revision, MUSCRIPTOR_REVISION);
        }
    }
}
