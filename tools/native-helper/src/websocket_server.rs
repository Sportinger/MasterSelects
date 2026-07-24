//! WebSocket connection, authentication, and command dispatch.

use anyhow::Result;
use futures_util::{SinkExt, StreamExt};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::protocol::Message;
use tokio_tungstenite::WebSocketStream;
use tracing::{debug, error, info, warn};

use crate::download;
use crate::matanyone;
use crate::muscriptor;
use crate::protocol::{error_codes, Command, Response};
use crate::session::{AppState, Session};

pub(super) async fn handle_connection(
    stream: TcpStream,
    addr: SocketAddr,
    state: Arc<AppState>,
    allowed_origins: Arc<Vec<String>>,
) -> Result<()> {
    info!("New connection from {}", addr);

    let ws =
        tokio_tungstenite::accept_hdr_async(stream, |request: &http::Request<()>, response| {
            if let Some(origin) = request.headers().get("Origin") {
                let origin_str = origin.to_str().unwrap_or("");
                let allowed = origin_str.starts_with("http://localhost")
                    || origin_str.starts_with("http://127.0.0.1")
                    || origin_str.starts_with("https://localhost")
                    || origin_str.starts_with("https://127.0.0.1")
                    || crate::http_server::is_cloudflare_pages_origin(origin_str)
                    || allowed_origins.iter().any(|o| o == origin_str);
                if !allowed {
                    warn!(
                        "Rejected WebSocket connection from disallowed origin: {}",
                        origin_str
                    );
                    return Err(http::Response::builder()
                        .status(http::StatusCode::FORBIDDEN)
                        .body(None)
                        .unwrap());
                }
            }
            // When origin is absent (CLI tools, non-browser clients), allow connection.
            // They will need to authenticate via token.
            Ok(response)
        })
        .await?;

    handle_websocket(ws, addr, state).await
}

/// Extract the `id` field from any Command variant for error responses
fn get_command_id(cmd: &Command) -> &str {
    match cmd {
        Command::Auth { id, .. }
        | Command::Info { id }
        | Command::Ping { id }
        | Command::RegisterClient { id, .. }
        | Command::AiToolResult { id, .. }
        | Command::DownloadYoutube { id, .. }
        | Command::Download { id, .. }
        | Command::ListFormats { id, .. }
        | Command::GetFile { id, .. }
        | Command::Locate { id, .. }
        | Command::WriteFile { id, .. }
        | Command::CreateDir { id, .. }
        | Command::ListDir { id, .. }
        | Command::Delete { id, .. }
        | Command::Exists { id, .. }
        | Command::Rename { id, .. }
        | Command::GrantPath { id, .. }
        | Command::PickFolder { id, .. }
        | Command::MatAnyoneStatus { id }
        | Command::MatAnyoneSetup { id, .. }
        | Command::MatAnyoneDownloadModel { id }
        | Command::MatAnyoneStart { id }
        | Command::MatAnyoneStop { id }
        | Command::MatAnyoneMatte { id, .. }
        | Command::MatAnyoneCancel { id, .. }
        | Command::MatAnyoneUninstall { id }
        | Command::MuscriptorStatus { id }
        | Command::MuscriptorSetup { id }
        | Command::MuscriptorDownloadModel { id, .. }
        | Command::MuscriptorStart { id, .. }
        | Command::MuscriptorStop { id }
        | Command::MuscriptorTranscribe { id, .. }
        | Command::MuscriptorCancel { id, .. }
        | Command::MuscriptorUninstall { id } => id,
    }
}

async fn handle_websocket(
    ws: WebSocketStream<TcpStream>,
    addr: SocketAddr,
    state: Arc<AppState>,
) -> Result<()> {
    let (write, mut read) = ws.split();
    let write = Arc::new(tokio::sync::Mutex::new(write));
    let session_id = uuid::Uuid::new_v4().to_string();
    let mut session = Session::new(state.clone());

    // Track authentication state for this connection.
    // If no auth token is configured, all connections are pre-authenticated.
    let mut authenticated = state.auth_token.is_none();

    while let Some(msg) = read.next().await {
        let msg = match msg {
            Ok(m) => m,
            Err(e) => {
                error!("WebSocket error from {}: {}", addr, e);
                break;
            }
        };

        match msg {
            Message::Text(text) => {
                let cmd: Command = match serde_json::from_str(&text) {
                    Ok(c) => c,
                    Err(e) => {
                        let response = Response::error("", "PARSE_ERROR", e.to_string());
                        let json = serde_json::to_string(&response)?;
                        let mut w = write.lock().await;
                        w.send(Message::Text(json)).await?;
                        continue;
                    }
                };

                // Log only the discriminant. Command payloads may contain auth
                // or transient HuggingFace tokens and must never reach logs.
                debug!(command = cmd.name(), "Received command");

                // â”€â”€ Auth gate â”€â”€
                // Auth and Ping are always allowed. All other commands require authentication.
                match &cmd {
                    Command::Auth { id, token } => {
                        let response = match &state.auth_token {
                            Some(expected) if expected == token => {
                                authenticated = true;
                                session.set_authenticated(true);
                                info!("Client {} authenticated via WebSocket", addr);
                                Response::ok(id, serde_json::json!({"authenticated": true}))
                            }
                            Some(_) => {
                                warn!("Invalid auth token from {}", addr);
                                Response::error(id, error_codes::INVALID_TOKEN, "Invalid token")
                            }
                            None => {
                                authenticated = true;
                                session.set_authenticated(true);
                                Response::ok(id, serde_json::json!({"authenticated": true}))
                            }
                        };
                        let json = serde_json::to_string(&response)?;
                        let mut w = write.lock().await;
                        w.send(Message::Text(json)).await?;
                        continue;
                    }
                    Command::Ping { .. } => {
                        // Ping is always allowed (for connectivity checks)
                    }
                    _ => {
                        if !authenticated {
                            // Extract id from the command for the error response
                            let cmd_id = get_command_id(&cmd);
                            let response = Response::error(
                                cmd_id,
                                error_codes::AUTH_REQUIRED,
                                "Authentication required. Send an 'auth' command with a valid token first.",
                            );
                            let json = serde_json::to_string(&response)?;
                            let mut w = write.lock().await;
                            w.send(Message::Text(json)).await?;
                            continue;
                        }
                    }
                }

                match cmd {
                    // Auth is handled above in the auth gate
                    Command::Auth { .. } => unreachable!(),

                    Command::RegisterClient {
                        id,
                        role,
                        capabilities,
                        session_name,
                        app_version,
                    } => {
                        if role == "editor" {
                            state
                                .register_editor_client(crate::session::EditorClient {
                                    session_id: session_id.clone(),
                                    sender: write.clone(),
                                    role: role.clone(),
                                    capabilities: capabilities.clone(),
                                    session_name: session_name.clone(),
                                    app_version: app_version.clone(),
                                })
                                .await;
                            info!("Registered editor client from {}", addr);
                        }

                        let response = Response::ok(
                            &id,
                            serde_json::json!({
                                "registered": true,
                                "role": role,
                                "session_id": session_id.clone(),
                            }),
                        );
                        let json = serde_json::to_string(&response)?;
                        let mut w = write.lock().await;
                        w.send(Message::Text(json)).await?;
                    }
                    Command::AiToolResult {
                        id,
                        request_id,
                        result,
                    } => {
                        let accepted = state.resolve_ai_request(&request_id, result).await;
                        let response = Response::ok(
                            &id,
                            serde_json::json!({
                                "accepted": accepted,
                                "request_id": request_id,
                            }),
                        );
                        let json = serde_json::to_string(&response)?;
                        let mut w = write.lock().await;
                        w.send(Message::Text(json)).await?;
                    }
                    Command::DownloadYoutube {
                        id,
                        url,
                        format_id,
                        output_dir,
                    }
                    | Command::Download {
                        id,
                        url,
                        format_id,
                        output_dir,
                    } => {
                        let response = download::handle_download(
                            &id,
                            &url,
                            format_id.as_deref(),
                            output_dir.as_deref(),
                            Some(write.clone()),
                        )
                        .await;
                        let json = serde_json::to_string(&response)?;
                        let mut w = write.lock().await;
                        w.send(Message::Text(json)).await?;
                    }
                    Command::ListFormats { id, url } => {
                        let response = download::handle_list_formats(&id, &url).await;
                        let json = serde_json::to_string(&response)?;
                        let mut w = write.lock().await;
                        w.send(Message::Text(json)).await?;
                    }

                    // â”€â”€ MatAnyone2 streaming commands â”€â”€
                    Command::MatAnyoneSetup { id, python_path } => {
                        let ws_sender = write.clone();
                        let id_clone = id.clone();
                        tokio::spawn(async move {
                            let ws = ws_sender.clone();
                            let id_ref = id_clone.clone();

                            let result = matanyone::setup_environment(
                                python_path.map(PathBuf::from),
                                move |step, percent, message| {
                                    let response = Response::setup_progress(
                                        &id_ref,
                                        &step.to_string(),
                                        percent,
                                        message,
                                    );
                                    if let Ok(json) = serde_json::to_string(&response) {
                                        let ws_inner = ws.clone();
                                        // Fire-and-forget progress message; tokio::spawn to avoid blocking the sync callback
                                        tokio::spawn(async move {
                                            let mut w = ws_inner.lock().await;
                                            let _ = w.send(Message::Text(json)).await;
                                        });
                                    }
                                },
                            )
                            .await;

                            let response = match result {
                                Ok(env_info) => Response::ok(
                                    &id_clone,
                                    serde_json::json!({
                                        "type": "complete",
                                        "env": serde_json::to_value(&env_info).unwrap_or_default(),
                                    }),
                                ),
                                Err(e) => Response::error(
                                    &id_clone,
                                    error_codes::MATANYONE_SETUP_FAILED,
                                    e,
                                ),
                            };

                            if let Ok(json) = serde_json::to_string(&response) {
                                let mut w = ws_sender.lock().await;
                                let _ = w.send(Message::Text(json)).await;
                            }
                        });
                    }

                    Command::MatAnyoneDownloadModel { id } => {
                        let ws_sender = write.clone();
                        let id_clone = id.clone();
                        tokio::spawn(async move {
                            let ws = ws_sender.clone();
                            let id_ref = id_clone.clone();

                            let result = matanyone::download_model(move |progress| {
                                let speed_str = format!(
                                    "{:.1} MB/s",
                                    progress.speed_bytes_per_sec / 1_048_576.0
                                );
                                let eta_str = progress.eta_seconds.map(|s| format!("{:.0}s", s));
                                let response = Response::download_progress(
                                    &id_ref,
                                    progress.percent.min(100.0) as u8,
                                    Some(&speed_str),
                                    eta_str.as_deref(),
                                );
                                if let Ok(json) = serde_json::to_string(&response) {
                                    let ws_inner = ws.clone();
                                    tokio::spawn(async move {
                                        let mut w = ws_inner.lock().await;
                                        let _ = w.send(Message::Text(json)).await;
                                    });
                                }
                            })
                            .await;

                            let response = match result {
                                Ok(model_info) => Response::ok(
                                    &id_clone,
                                    serde_json::json!({
                                        "type": "complete",
                                        "downloaded": model_info.downloaded,
                                        "model_path": model_info.model_path,
                                        "size_bytes": model_info.size_bytes,
                                    }),
                                ),
                                Err(e) => Response::error(
                                    &id_clone,
                                    error_codes::MATANYONE_SETUP_FAILED,
                                    e,
                                ),
                            };

                            if let Ok(json) = serde_json::to_string(&response) {
                                let mut w = ws_sender.lock().await;
                                let _ = w.send(Message::Text(json)).await;
                            }
                        });
                    }

                    Command::MatAnyoneStart { id } => {
                        let ws_sender = write.clone();
                        let state_clone = state.clone();
                        let id_clone = id.clone();
                        tokio::spawn(async move {
                            // Send starting progress
                            let starting_response = Response::setup_progress(
                                &id_clone,
                                "start_server",
                                0.0,
                                "Starting MatAnyone2 inference server...",
                            );
                            if let Ok(json) = serde_json::to_string(&starting_response) {
                                let mut w = ws_sender.lock().await;
                                let _ = w.send(Message::Text(json)).await;
                            }

                            let env_info = matanyone::get_env_info();
                            if !env_info.matanyone_installed {
                                let response = Response::error(
                                    &id_clone,
                                    error_codes::MATANYONE_NOT_INSTALLED,
                                    "MatAnyone2 must be installed/updated to the pinned revision before start",
                                );
                                if let Ok(json) = serde_json::to_string(&response) {
                                    let _ = ws_sender.lock().await.send(Message::Text(json)).await;
                                }
                                return;
                            }

                            let cuda_info = matanyone::detect_cuda().await;
                            if !cuda_info.available {
                                let response = Response::error(
                                    &id_clone,
                                    error_codes::MATANYONE_GPU_REQUIRED,
                                    matanyone::GPU_REQUIRED_MESSAGE,
                                );
                                if let Ok(json) = serde_json::to_string(&response) {
                                    let _ = ws_sender.lock().await.send(Message::Text(json)).await;
                                }
                                return;
                            }
                            if let Err(reason) = matanyone::validate_cuda_runtime().await {
                                let response = Response::error(
                                    &id_clone,
                                    error_codes::MATANYONE_GPU_REQUIRED,
                                    reason,
                                );
                                if let Ok(json) = serde_json::to_string(&response) {
                                    let _ = ws_sender.lock().await.send(Message::Text(json)).await;
                                }
                                return;
                            }

                            let python_path = matanyone::get_venv_python();
                            let models_dir = matanyone::get_models_dir();
                            let server_script = match matanyone::ensure_server_script().await {
                                Ok(path) => path,
                                Err(e) => {
                                    let response = Response::error(
                                        &id_clone,
                                        error_codes::MATANYONE_NOT_INSTALLED,
                                        e,
                                    );
                                    if let Ok(json) = serde_json::to_string(&response) {
                                        let mut w = ws_sender.lock().await;
                                        let _ = w.send(Message::Text(json)).await;
                                    }
                                    return;
                                }
                            };

                            let mut proc = state_clone.matanyone_process.lock().await;
                            let result =
                                proc.start(&python_path, &server_script, &models_dir).await;

                            let response = match result {
                                Ok(port) => Response::ok(
                                    &id_clone,
                                    serde_json::json!({
                                        "type": "complete",
                                        "started": true,
                                        "port": port,
                                    }),
                                ),
                                Err(e) => Response::error(
                                    &id_clone,
                                    error_codes::MATANYONE_NOT_INSTALLED,
                                    e,
                                ),
                            };

                            if let Ok(json) = serde_json::to_string(&response) {
                                let mut w = ws_sender.lock().await;
                                let _ = w.send(Message::Text(json)).await;
                            }
                        });
                    }

                    Command::MatAnyoneMatte {
                        id,
                        video_path,
                        mask_path,
                        output_dir,
                        start_frame,
                        end_frame,
                    } => {
                        let ws_sender = write.clone();
                        let state_clone = state.clone();
                        let id_clone = id.clone();
                        tokio::spawn(async move {
                            let video = std::path::Path::new(&video_path);
                            let mask = std::path::Path::new(&mask_path);
                            let output = std::path::Path::new(&output_dir);
                            if !video.is_absolute()
                                || !mask.is_absolute()
                                || !output.is_absolute()
                                || !state_clone.is_path_allowed(video)
                                || !state_clone.is_path_allowed(mask)
                                || !state_clone.is_path_allowed(output)
                            {
                                let response = Response::error(
                                    &id_clone,
                                    error_codes::PERMISSION_DENIED,
                                    "MatAnyone2 paths must be absolute and inside an allowed root",
                                );
                                if let Ok(json) = serde_json::to_string(&response) {
                                    let _ = ws_sender.lock().await.send(Message::Text(json)).await;
                                }
                                return;
                            }
                            if !video.is_file() || !mask.is_file() {
                                let response = Response::error(
                                    &id_clone,
                                    error_codes::FILE_NOT_FOUND,
                                    "MatAnyone2 video or mask file was not found",
                                );
                                if let Ok(json) = serde_json::to_string(&response) {
                                    let _ = ws_sender.lock().await.send(Message::Text(json)).await;
                                }
                                return;
                            }
                            // Get the port from the running process
                            let port = {
                                let proc = state_clone.matanyone_process.lock().await;
                                let p = proc.port();
                                if p == 0 {
                                    let response = Response::error(
                                        &id_clone,
                                        error_codes::MATANYONE_NOT_RUNNING,
                                        "MatAnyone2 server is not running. Start it first.",
                                    );
                                    if let Ok(json) = serde_json::to_string(&response) {
                                        let mut w = ws_sender.lock().await;
                                        let _ = w.send(Message::Text(json)).await;
                                    }
                                    return;
                                }
                                p
                            };

                            let request = crate::matanyone::inference::MatteRequest {
                                video_path,
                                mask_path,
                                output_dir,
                                start_frame,
                                end_frame,
                            };

                            let ws = ws_sender.clone();
                            let id_ref = id_clone.clone();

                            let result = crate::matanyone::inference::run_matte_job(
                                port,
                                request,
                                move |progress| {
                                    let response = Response::ok(
                                        &id_ref,
                                        serde_json::json!({
                                            "type": "progress",
                                            "job_id": progress.job_id,
                                            "status": progress.status,
                                            "current_frame": progress.current_frame,
                                            "total_frames": progress.total_frames,
                                            "percent": progress.percent,
                                        }),
                                    );
                                    if let Ok(json) = serde_json::to_string(&response) {
                                        let ws_inner = ws.clone();
                                        tokio::spawn(async move {
                                            let mut w = ws_inner.lock().await;
                                            let _ = w.send(Message::Text(json)).await;
                                        });
                                    }
                                },
                            )
                            .await;

                            let response = match result {
                                Ok(matte_result) => Response::ok(
                                    &id_clone,
                                    serde_json::json!({
                                        "type": "complete",
                                        "job_id": matte_result.job_id,
                                        "foreground_path": matte_result.foreground_path,
                                        "alpha_path": matte_result.alpha_path,
                                    }),
                                ),
                                Err(e) => Response::error(
                                    &id_clone,
                                    error_codes::MATANYONE_INFERENCE_FAILED,
                                    e,
                                ),
                            };

                            if let Ok(json) = serde_json::to_string(&response) {
                                let mut w = ws_sender.lock().await;
                                let _ = w.send(Message::Text(json)).await;
                            }
                        });
                    }

                    Command::MatAnyoneCancel { id, job_id } => {
                        let ws_sender = write.clone();
                        let state_clone = state.clone();
                        let id_clone = id.clone();
                        tokio::spawn(async move {
                            let port = {
                                let proc = state_clone.matanyone_process.lock().await;
                                proc.port()
                            };
                            if port != 0 {
                                let _ = tokio::time::timeout(
                                    Duration::from_millis(750),
                                    crate::matanyone::inference::cancel_job(port, &job_id),
                                )
                                .await;
                            }

                            // Hard-cancel the sidecar process so GPU work,
                            // worker threads, and any subprocesses are stopped.
                            let result = {
                                let mut proc = state_clone.matanyone_process.lock().await;
                                if proc.port() == 0 {
                                    Ok(false)
                                } else {
                                    proc.stop().await.map(|_| true)
                                }
                            };

                            let response = match result {
                                Ok(server_stopped) => Response::ok(
                                    &id_clone,
                                    serde_json::json!({
                                        "cancelled": true,
                                        "job_id": job_id,
                                        "server_stopped": server_stopped,
                                    }),
                                ),
                                Err(e) => Response::error(
                                    &id_clone,
                                    error_codes::MATANYONE_INFERENCE_FAILED,
                                    e,
                                ),
                            };

                            if let Ok(json) = serde_json::to_string(&response) {
                                let mut w = ws_sender.lock().await;
                                let _ = w.send(Message::Text(json)).await;
                            }
                        });
                    }

                    command @ (Command::MuscriptorSetup { .. }
                    | Command::MuscriptorDownloadModel { .. }
                    | Command::MuscriptorStart { .. }
                    | Command::MuscriptorTranscribe { .. }
                    | Command::MuscriptorCancel { .. }) => {
                        muscriptor::websocket::dispatch(command, write.clone(), state.clone());
                    }

                    other => {
                        if let Some(response) = session.handle_command(other).await {
                            let json = serde_json::to_string(&response)?;
                            let mut w = write.lock().await;
                            w.send(Message::Text(json)).await?;
                        }
                    }
                }
            }

            Message::Ping(data) => {
                let mut w = write.lock().await;
                w.send(Message::Pong(data)).await?;
            }
            Message::Pong(_) => {}
            Message::Close(_) => {
                info!("Client {} disconnected", addr);
                break;
            }
            Message::Binary(_) => {
                warn!("Received unexpected binary data from {}", addr);
            }
            Message::Frame(_) => {}
        }
    }

    state.unregister_client(&session_id).await;
    info!("Connection closed: {}", addr);
    Ok(())
}
