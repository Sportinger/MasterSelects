//! Per-connection session management

mod file_commands;
mod matanyone_commands;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use tokio::sync::{oneshot, Mutex};
use tracing::{info, warn};

use crate::download::{self, WsSender};
use crate::matanyone;
use crate::muscriptor;
use crate::protocol::{error_codes, Command, Response, SystemInfo};
use crate::utils;

/// Open native folder picker. On Windows uses RFD; on macOS uses osascript
/// (avoids RFD's main-thread requirement in terminal/non-windowed env).
fn pick_folder_native(
    title: &str,
    default_path: Option<String>,
) -> Result<Option<PathBuf>, anyhow::Error> {
    #[cfg(windows)]
    {
        let mut dialog = rfd::FileDialog::new().set_title(title);
        if let Some(ref dp) = default_path {
            dialog = dialog.set_directory(dp);
        }
        Ok(dialog.pick_folder())
    }

    #[cfg(target_os = "macos")]
    {
        // osascript runs in its own process, so no main-thread constraint.
        // User cancel -> exit code 1, empty output.
        let prompt = title.replace('"', "\\\"");
        let script = if let Some(ref dp) = default_path {
            let path = std::path::Path::new(dp);
            if path.exists() && path.is_dir() {
                format!(
                    "POSIX path of (choose folder with prompt \"{}\" default location (POSIX file \"{}\"))",
                    prompt,
                    path.to_string_lossy().replace('\\', "\\\\").replace('"', "\\\"")
                )
            } else {
                format!("POSIX path of (choose folder with prompt \"{}\")", prompt)
            }
        } else {
            format!("POSIX path of (choose folder with prompt \"{}\")", prompt)
        };

        let output = std::process::Command::new("osascript")
            .arg("-e")
            .arg(&script)
            .output()?;

        if output.status.success() {
            let path_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if path_str.is_empty() {
                Ok(None)
            } else {
                Ok(Some(PathBuf::from(path_str)))
            }
        } else {
            // User cancelled or error
            Ok(None)
        }
    }

    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        let _ = (title, default_path);
        Err(anyhow::anyhow!(
            "Native folder picker is not available on this platform when running from terminal. \
             Please specify the path manually in the web app."
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn muscriptor_temp_is_allowed_without_granting_local_app_data() {
        let state = AppState::new(None);
        let temp_file = muscriptor::env::get_temp_dir()
            .join("job")
            .join("audio.wav");
        assert!(state.is_path_allowed(&temp_file));
        if let Some(local_data) = dirs::data_local_dir() {
            assert!(!state.is_path_allowed(&local_data.join("unrelated-secret.txt")));
        }
    }
}

/// Generate a random auth token
pub fn generate_auth_token() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    (0..32)
        .map(|_| rng.sample(rand::distributions::Alphanumeric) as char)
        .collect()
}

#[derive(Clone)]
pub struct EditorClient {
    pub session_id: String,
    pub sender: WsSender,
    pub role: String,
    pub capabilities: Vec<String>,
    pub session_name: Option<String>,
    pub app_version: Option<String>,
}

/// Shared application state
pub struct AppState {
    pub auth_token: Option<String>,
    editor_client: Mutex<Option<EditorClient>>,
    pending_ai_requests: Mutex<HashMap<String, oneshot::Sender<serde_json::Value>>>,
    granted_paths: RwLock<Vec<PathBuf>>,
    pub matanyone_process: Mutex<matanyone::process::MatAnyoneProcess>,
    pub muscriptor_process: Mutex<muscriptor::process::MuscriptorProcess>,
}

impl AppState {
    pub fn new(auth_token: Option<String>) -> Self {
        Self {
            auth_token,
            editor_client: Mutex::new(None),
            pending_ai_requests: Mutex::new(HashMap::new()),
            granted_paths: RwLock::new(Vec::new()),
            matanyone_process: Mutex::new(matanyone::process::MatAnyoneProcess::new()),
            muscriptor_process: Mutex::new(muscriptor::process::MuscriptorProcess::new()),
        }
    }

    pub fn grant_path(&self, path: PathBuf) {
        if !path.is_absolute() {
            return;
        }

        let mut granted = self
            .granted_paths
            .write()
            .unwrap_or_else(|e| e.into_inner());
        if !granted.iter().any(|existing| existing == &path) {
            info!("Granted file access root: {}", path.display());
            granted.push(path);
        }
    }

    pub fn is_path_allowed(&self, path: &Path) -> bool {
        let granted = self.granted_paths.read().unwrap_or_else(|e| e.into_inner());
        let mut scoped_prefixes = granted.clone();
        // Browser uploads for MuScriptor land only in this provider-owned temp
        // root. Do not grant the broader LocalAppData directory.
        scoped_prefixes.push(muscriptor::env::get_temp_dir());
        utils::is_path_allowed_with_extra(path, &scoped_prefixes)
    }

    pub async fn register_editor_client(&self, client: EditorClient) {
        let mut editor = self.editor_client.lock().await;
        *editor = Some(client);
    }

    pub async fn get_editor_client(&self) -> Option<EditorClient> {
        self.editor_client.lock().await.clone()
    }

    pub async fn unregister_client(&self, session_id: &str) {
        let mut editor = self.editor_client.lock().await;
        if editor
            .as_ref()
            .map(|client| client.session_id == session_id)
            .unwrap_or(false)
        {
            *editor = None;
        }
    }

    pub async fn add_ai_request(&self, request_id: String, tx: oneshot::Sender<serde_json::Value>) {
        self.pending_ai_requests.lock().await.insert(request_id, tx);
    }

    pub async fn remove_ai_request(&self, request_id: &str) {
        self.pending_ai_requests.lock().await.remove(request_id);
    }

    pub async fn resolve_ai_request(&self, request_id: &str, result: serde_json::Value) -> bool {
        let tx = self.pending_ai_requests.lock().await.remove(request_id);
        if let Some(tx) = tx {
            let _ = tx.send(result);
            true
        } else {
            false
        }
    }

    pub async fn pending_ai_request_count(&self) -> usize {
        self.pending_ai_requests.lock().await.len()
    }
}

/// Per-connection session
pub struct Session {
    state: Arc<AppState>,
    authenticated: bool,
}

impl Session {
    pub fn new(state: Arc<AppState>) -> Self {
        let authenticated = state.auth_token.is_none();

        Self {
            state,
            authenticated,
        }
    }

    /// Set the authentication state (called from server.rs after successful auth)
    pub fn set_authenticated(&mut self, value: bool) {
        self.authenticated = value;
    }

    /// Handle a command, return response
    /// Note: Download/ListFormats and AI bridge commands are handled directly in server.rs.
    pub async fn handle_command(&mut self, cmd: Command) -> Option<Response> {
        // Auth required for most commands
        if !self.authenticated {
            if let Command::Auth { .. } = cmd {
                // Allow auth command
            } else {
                return Some(Response::error(
                    "",
                    error_codes::AUTH_REQUIRED,
                    "Authentication required",
                ));
            }
        }

        match cmd {
            Command::Auth { id, token } => Some(self.handle_auth(&id, &token)),

            Command::Info { id } => Some(self.handle_info(&id).await),

            Command::Ping { id } => Some(Response::ok(&id, serde_json::json!({"pong": true}))),

            Command::GetFile { id, path } => Some(self.handle_get_file(&id, &path)),

            Command::Locate {
                id,
                filename,
                search_dirs,
            } => Some(self.handle_locate(&id, &filename, &search_dirs)),

            // File system commands
            Command::WriteFile {
                id,
                path,
                data,
                encoding,
            } => Some(self.handle_write_file(&id, &path, &data, encoding.as_deref())),
            Command::CreateDir {
                id,
                path,
                recursive,
            } => Some(self.handle_create_dir(&id, &path, recursive.unwrap_or(true))),
            Command::ListDir { id, path } => Some(self.handle_list_dir(&id, &path)),
            Command::Delete {
                id,
                path,
                recursive,
            } => Some(self.handle_delete(&id, &path, recursive.unwrap_or(false))),
            Command::Exists { id, path } => Some(self.handle_exists(&id, &path)),
            Command::Rename {
                id,
                old_path,
                new_path,
            } => Some(self.handle_rename(&id, &old_path, &new_path)),

            Command::GrantPath { id, path } => {
                let path = PathBuf::from(path);
                if !path.is_absolute() {
                    Some(Response::error(
                        &id,
                        error_codes::INVALID_PATH,
                        "Path must be absolute",
                    ))
                } else {
                    self.state.grant_path(path);
                    Some(Response::ok(&id, serde_json::json!({ "granted": true })))
                }
            }

            Command::PickFolder {
                id,
                title,
                default_path,
            } => {
                let title = title.unwrap_or_else(|| "Select folder".to_string());
                let default_path = default_path.clone();
                let id = id.clone();

                // RFD on macOS requires main thread in NonWindowed env (terminal).
                // Use osascript subprocess on macOS instead. RFD works on Windows.
                let result =
                    tokio::task::spawn_blocking(move || pick_folder_native(&title, default_path))
                        .await;

                match result {
                    Ok(Ok(Some(path))) => {
                        self.state.grant_path(path.clone());
                        Some(Response::ok(
                            &id,
                            serde_json::json!({ "path": path.to_string_lossy() }),
                        ))
                    }
                    Ok(Ok(None)) => Some(Response::ok(
                        &id,
                        serde_json::json!({ "path": serde_json::Value::Null, "cancelled": true }),
                    )),
                    Ok(Err(e)) => Some(Response::error(
                        &id,
                        error_codes::INTERNAL_ERROR,
                        format!("Folder picker failed: {}", e),
                    )),
                    Err(e) => Some(Response::error(
                        &id,
                        error_codes::INTERNAL_ERROR,
                        format!("Folder picker task failed: {}", e),
                    )),
                }
            }

            // ── MatAnyone2 commands handled here ──
            Command::MatAnyoneStatus { id } => Some(self.handle_matanyone_status(&id).await),

            Command::MatAnyoneStop { id } => Some(self.handle_matanyone_stop(&id).await),

            Command::MatAnyoneUninstall { id } => Some(self.handle_matanyone_uninstall(&id).await),

            Command::MuscriptorStatus { id } => {
                Some(muscriptor::control::status(&id, &self.state.muscriptor_process).await)
            }

            Command::MuscriptorStop { id } => {
                Some(muscriptor::control::stop(&id, &self.state.muscriptor_process).await)
            }

            Command::MuscriptorUninstall { id } => {
                Some(muscriptor::control::uninstall(&id, &self.state.muscriptor_process).await)
            }

            // Download and streaming MatAnyone2 commands are handled in server.rs with WsSender
            Command::DownloadYoutube { id, .. }
            | Command::Download { id, .. }
            | Command::ListFormats { id, .. }
            | Command::RegisterClient { id, .. }
            | Command::AiToolResult { id, .. }
            | Command::MatAnyoneSetup { id, .. }
            | Command::MatAnyoneDownloadModel { id, .. }
            | Command::MatAnyoneStart { id, .. }
            | Command::MatAnyoneMatte { id, .. }
            | Command::MatAnyoneCancel { id, .. }
            | Command::MuscriptorSetup { id }
            | Command::MuscriptorDownloadModel { id, .. }
            | Command::MuscriptorStart { id, .. }
            | Command::MuscriptorTranscribe { id, .. }
            | Command::MuscriptorCancel { id, .. } => Some(Response::error(
                &id,
                error_codes::INTERNAL_ERROR,
                "This command should be handled by server",
            )),
        }
    }

    fn handle_auth(&mut self, id: &str, token: &str) -> Response {
        match &self.state.auth_token {
            Some(expected) if expected == token => {
                self.authenticated = true;
                info!("Client authenticated");
                Response::ok(id, serde_json::json!({"authenticated": true}))
            }
            Some(_) => {
                warn!("Invalid auth token");
                Response::error(id, error_codes::INVALID_TOKEN, "Invalid token")
            }
            None => {
                self.authenticated = true;
                Response::ok(id, serde_json::json!({"authenticated": true}))
            }
        }
    }

    async fn handle_info(&self, id: &str) -> Response {
        let ytdlp_available = download::find_ytdlp().is_some();
        let editor_connected = self
            .state
            .editor_client
            .try_lock()
            .map(|guard| guard.is_some())
            .unwrap_or(false);

        // Check MatAnyone2 status
        let env_info = matanyone::get_env_info();
        let model_info = matanyone::get_model_info();
        let cuda_info = matanyone::detect_cuda().await;
        let matanyone_process_status = {
            let mut process = self.state.matanyone_process.lock().await;
            process.reconcile_status().await
        };

        let matanyone_available =
            cuda_info.available && env_info.matanyone_installed && model_info.downloaded;
        let matanyone_status = if !cuda_info.available {
            "gpu_required".to_string()
        } else if !env_info.venv_exists || !env_info.matanyone_installed {
            "not_installed".to_string()
        } else if let matanyone::process::ProcessStatus::Error(ref msg) = matanyone_process_status {
            format!("error: {}", msg)
        } else if matanyone_process_status == matanyone::process::ProcessStatus::Ready {
            "running".to_string()
        } else {
            "installed".to_string()
        };

        let info = SystemInfo {
            version: env!("CARGO_PKG_VERSION").to_string(),
            ytdlp_available,
            download_dir: utils::get_download_dir().to_string_lossy().to_string(),
            project_root: utils::get_project_root().to_string_lossy().to_string(),
            fs_commands: true,
            ai_bridge: true,
            editor_connected,
            matanyone_available,
            matanyone_status,
        };

        Response::ok(id, serde_json::to_value(info).unwrap())
    }

    // ── MatAnyone2 handlers ──
}
