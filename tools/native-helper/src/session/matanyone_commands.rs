//! MatAnyone2 status and lifecycle commands.

use tracing::{info, warn};

use super::Session;
use crate::matanyone;
use crate::protocol::{error_codes, Response};

impl Session {
    pub(super) async fn handle_matanyone_status(&self, id: &str) -> Response {
        let env_info = matanyone::get_env_info();
        let model_info = matanyone::get_model_info();
        let cuda_info = matanyone::env::detect_cuda().await;
        let cuda_available = cuda_info.available;
        let (process_status, server_port) = {
            let mut process = self.state.matanyone_process.lock().await;
            let status = process.reconcile_status().await;
            (status, process.port())
        };
        let server_running = process_status == matanyone::process::ProcessStatus::Ready;
        let server_error = match &process_status {
            matanyone::process::ProcessStatus::Error(message) => Some(message.clone()),
            _ => None,
        };

        // Flat response matching what the frontend expects
        Response::ok(
            id,
            serde_json::json!({
                "setup_status": if !cuda_available { "gpu_required" }
                    else if server_running { "running" }
                    else if env_info.matanyone_installed && model_info.downloaded { "installed" }
                    else if env_info.venv_exists { "partially_installed" }
                    else { "not_installed" },
                "python_version": env_info.python_version,
                "cuda_available": cuda_info.available,
                "cuda_version": cuda_info.version,
                "gpu_name": cuda_info.gpu_name,
                "vram_mb": cuda_info.vram_mb,
                "model_downloaded": model_info.downloaded,
                "venv_exists": env_info.venv_exists,
                "deps_installed": env_info.deps_installed,
                "matanyone_installed": env_info.matanyone_installed,
                "installed_revision": env_info.installed_revision,
                "expected_revision": env_info.expected_revision,
                "server_running": server_running,
                "server_port": server_port,
                "server_error": server_error,
            }),
        )
    }

    pub(super) async fn handle_matanyone_stop(&self, id: &str) -> Response {
        let mut proc = self.state.matanyone_process.lock().await;
        match proc.stop().await {
            Ok(()) => {
                info!("MatAnyone2 server stopped");
                Response::ok(id, serde_json::json!({ "stopped": true }))
            }
            Err(e) => {
                warn!("Failed to stop MatAnyone2 server: {}", e);
                Response::error(id, error_codes::INTERNAL_ERROR, e)
            }
        }
    }

    pub(super) async fn handle_matanyone_uninstall(&self, id: &str) -> Response {
        // Stop the server first if running
        {
            let mut proc = self.state.matanyone_process.lock().await;
            let _ = proc.stop().await;
        }

        // Delete model files
        if let Err(e) = matanyone::delete_model().await {
            warn!("Failed to delete MatAnyone2 models: {}", e);
            return Response::error(
                id,
                error_codes::INTERNAL_ERROR,
                format!("Failed to delete models: {}", e),
            );
        }

        // Delete the data directory (venv, uv, source)
        let data_dir = matanyone::get_data_dir();
        if data_dir.exists() {
            if let Err(e) = tokio::fs::remove_dir_all(&data_dir).await {
                warn!("Failed to remove MatAnyone2 data dir: {}", e);
                return Response::error(
                    id,
                    error_codes::INTERNAL_ERROR,
                    format!("Failed to remove data directory: {}", e),
                );
            }
            info!("Removed MatAnyone2 data directory: {}", data_dir.display());
        }

        info!("MatAnyone2 uninstalled successfully");
        Response::ok(id, serde_json::json!({ "uninstalled": true }))
    }
}
