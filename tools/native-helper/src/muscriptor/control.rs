//! Non-streaming MuScriptor WebSocket command handlers.

use tokio::sync::Mutex;
use tracing::{info, warn};

use crate::matanyone;
use crate::protocol::{error_codes, Response};

use super::env::{self, AVAILABLE_INSTRUMENTS};
use super::process::{MuscriptorProcess, ProcessStatus};

pub async fn status(id: &str, process: &Mutex<MuscriptorProcess>) -> Response {
    let env_info = env::get_env_info();
    let cuda = matanyone::detect_cuda().await;
    let process = process.lock().await;
    let server_running = process.status() == &ProcessStatus::Ready && process.health_check();
    let process_error = match process.status() {
        ProcessStatus::Error(error) => Some(error.as_str()),
        _ => None,
    };
    let models_downloaded: Vec<&str> = env_info
        .downloaded_variants
        .iter()
        .map(|variant| variant.as_str())
        .collect();
    let setup_status = if server_running {
        "running"
    } else if process_error.is_some() {
        "error"
    } else if env_info.muscriptor_installed {
        "installed"
    } else if env_info.venv_exists {
        "partially_installed"
    } else {
        "not_installed"
    };
    Response::ok(
        id,
        serde_json::json!({
            "setup_status": setup_status,
            "python_version": env::venv_python_version(),
            "venv_exists": env_info.venv_exists,
            "deps_installed": env_info.muscriptor_installed,
            "models_downloaded": models_downloaded,
            "server_running": server_running,
            "server_port": process.port(),
            "active_variant": process.variant(),
            "active_device": process.device(),
            "cuda_available": cuda.available,
            "cuda_version": cuda.version,
            "gpu_name": cuda.gpu_name,
            "vram_mb": cuda.vram_mb,
            "temp_directory": env::get_temp_dir(),
            "available_instruments": AVAILABLE_INSTRUMENTS,
            "installed_revision": env_info.installed_revision,
            "expected_revision": env_info.expected_revision,
            "error": process_error,
        }),
    )
}

pub async fn stop(id: &str, process: &Mutex<MuscriptorProcess>) -> Response {
    let mut process = process.lock().await;
    match process.stop().await {
        Ok(()) => Response::ok(id, serde_json::json!({ "stopped": true })),
        Err(error) => Response::error(id, error_codes::INTERNAL_ERROR, error),
    }
}

pub async fn uninstall(id: &str, process: &Mutex<MuscriptorProcess>) -> Response {
    {
        let mut process = process.lock().await;
        if let Err(error) = process.stop().await {
            warn!("Failed to stop MuScriptor before uninstall: {error}");
        }
    }
    let data_dir = env::get_data_dir();
    if data_dir.exists() {
        if let Err(error) = tokio::fs::remove_dir_all(&data_dir).await {
            return Response::error(
                id,
                error_codes::INTERNAL_ERROR,
                format!("Failed to remove MuScriptor data: {error}"),
            );
        }
    }
    info!(path = %data_dir.display(), "MuScriptor provider data removed");
    Response::ok(id, serde_json::json!({ "uninstalled": true }))
}
