//! WebSocket server implementation

use anyhow::Result;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::tungstenite::protocol::Message;
use tokio_tungstenite::WebSocketStream;
use tracing::{debug, error, info, warn};
use warp::Filter;

#[cfg(windows)]
use std::sync::atomic::Ordering;

use crate::download;
use crate::matanyone;
use crate::protocol::{error_codes, Command, Response};
use crate::session::{AppState, Session};
use crate::utils;

/// Server configuration
pub struct ServerConfig {
    pub port: u16,
    pub allowed_origins: Vec<String>,
    pub auth_token: Option<String>,
}

/// Run the WebSocket server and HTTP file server
pub async fn run(config: ServerConfig) -> Result<()> {
    let ws_addr = format!("127.0.0.1:{}", config.port);
    let http_port = config.port + 1;

    let listener = TcpListener::bind(&ws_addr).await?;
    info!("WebSocket server listening on ws://{}", ws_addr);

    let state = Arc::new(AppState::new(config.auth_token.clone()));
    let allowed_origins = Arc::new(config.allowed_origins.clone());

    let http_state = state.clone();
    let http_origins = allowed_origins.clone();
    tokio::spawn(async move {
        run_http_server(http_port, http_state, http_origins).await;
    });

    while let Ok((stream, addr)) = listener.accept().await {
        let state = state.clone();
        let allowed_origins = allowed_origins.clone();

        tokio::spawn(async move {
            if let Err(e) = handle_connection(stream, addr, state, allowed_origins).await {
                error!("Connection error from {}: {}", addr, e);
            }
        });
    }

    Ok(())
}

/// Run the server with graceful shutdown support (Windows tray mode).
#[cfg(windows)]
pub async fn run_with_shutdown(
    config: ServerConfig,
    tray_state: Arc<crate::tray::TrayState>,
) -> Result<()> {
    let ws_addr = format!("127.0.0.1:{}", config.port);
    let http_port = config.port + 1;

    let listener = TcpListener::bind(&ws_addr).await?;
    info!("WebSocket server listening on ws://{}", ws_addr);

    let state = Arc::new(AppState::new(config.auth_token.clone()));
    let allowed_origins = Arc::new(config.allowed_origins.clone());

    tray_state.running.store(true, Ordering::Relaxed);

    let http_state = state.clone();
    let http_origins = allowed_origins.clone();
    tokio::spawn(async move {
        run_http_server(http_port, http_state, http_origins).await;
    });

    loop {
        tokio::select! {
            result = listener.accept() => {
                match result {
                    Ok((stream, addr)) => {
                        let state = state.clone();
                        let allowed_origins = allowed_origins.clone();
                        let ts = tray_state.clone();

                        ts.connection_count.fetch_add(1, Ordering::Relaxed);

                        tokio::spawn(async move {
                            if let Err(e) = handle_connection(stream, addr, state, allowed_origins).await {
                                error!("Connection error from {}: {}", addr, e);
                            }
                            ts.connection_count.fetch_sub(1, Ordering::Relaxed);
                        });
                    }
                    Err(e) => {
                        error!("Accept error: {}", e);
                    }
                }
            }
            _ = wait_for_quit(&tray_state) => {
                info!("Shutdown requested, stopping server...");
                break;
            }
        }
    }

    Ok(())
}

#[cfg(windows)]
async fn wait_for_quit(tray_state: &Arc<crate::tray::TrayState>) {
    loop {
        if tray_state.quit_requested.load(Ordering::Relaxed) {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
}

#[derive(Debug, Deserialize)]
struct AiToolHttpRequest {
    tool: String,
    #[serde(default)]
    args: serde_json::Value,
}

fn with_state(
    state: Arc<AppState>,
) -> impl Filter<Extract = (Arc<AppState>,), Error = std::convert::Infallible> + Clone {
    warp::any().map(move || state.clone())
}

/// Extract Bearer token from Authorization header
fn extract_bearer_token(header_value: &str) -> Option<&str> {
    header_value.strip_prefix("Bearer ")
}

/// Check if the provided auth header matches the expected token
fn check_http_auth(auth_header: Option<String>, expected_token: &Option<String>) -> bool {
    match expected_token {
        None => true, // No auth required
        Some(expected) => match auth_header {
            Some(header) => extract_bearer_token(&header)
                .map(|t| t == expected)
                .unwrap_or(false),
            None => false,
        },
    }
}

/// Check if an origin matches *.masterselects.pages.dev (Cloudflare Pages previews)
fn is_cloudflare_pages_origin(origin: &str) -> bool {
    origin == "https://masterselects.pages.dev"
        || (origin.starts_with("https://") && origin.ends_with(".masterselects.pages.dev"))
}

async fn run_http_server(port: u16, state: Arc<AppState>, allowed_origins: Arc<Vec<String>>) {
    // CORS setup: static origins from config + Cloudflare Pages production domain.
    // For preview deployments (*.masterselects.pages.dev), use --allowed-origins CLI flag.
    // WebSocket handler has dynamic pattern matching for CF Pages subdomains.
    let cors_origins: Vec<String> = allowed_origins.iter().cloned().collect();
    let cors_headers: Vec<String> = cors_origins.iter().map(|o| o.to_string()).collect();

    let cors = warp::cors()
        .allow_origins(cors_headers.iter().map(|s| s.as_str()).collect::<Vec<&str>>())
        .allow_methods(vec!["GET", "POST", "OPTIONS"])
        .allow_headers(vec!["Content-Type", "Authorization"]);

    // Auth filter: extracts Authorization header and validates against state token
    let state_for_auth = state.clone();
    let require_auth = warp::header::optional::<String>("authorization")
        .and(with_state(state_for_auth))
        .and_then(|auth_header: Option<String>, state: Arc<AppState>| async move {
            if check_http_auth(auth_header, &state.auth_token) {
                Ok(())
            } else {
                Err(warp::reject::custom(AuthRequired))
            }
        })
        .untuple_one();

    // GET /file?path=... — serve a file (AUTH REQUIRED)
    let state_for_file = state.clone();
    let require_auth_file = require_auth.clone();
    let file_route = warp::path("file")
        .and(warp::get())
        .and(require_auth_file)
        .and(warp::query::<std::collections::HashMap<String, String>>())
        .and(with_state(state_for_file))
        .and_then(serve_file);

    // POST /upload?path=... — write binary body to file (AUTH REQUIRED)
    let state_for_upload = state.clone();
    let require_auth_upload = require_auth.clone();
    let upload_route = warp::path("upload")
        .and(warp::post())
        .and(require_auth_upload)
        .and(warp::query::<std::collections::HashMap<String, String>>())
        .and(warp::body::bytes())
        .and(with_state(state_for_upload))
        .and_then(handle_upload);

    // GET /project-root — return the default project root path (NO AUTH - safe metadata)
    let project_root_route = warp::path("project-root")
        .and(warp::get())
        .and_then(get_project_root);

    let state_for_status = state.clone();
    let state_for_api_status = state.clone();
    let state_for_post = state.clone();
    let state_for_api_post = state.clone();
    let state_for_startup_token = state.clone();

    // GET /ai-tools and /api/ai-tools — status for external AI bridge (NO AUTH - safe metadata)
    let ai_tools_status_route = warp::path("ai-tools")
        .and(warp::get())
        .and(with_state(state_for_status))
        .and_then(get_ai_tools_status);
    let api_ai_tools_status_route = warp::path!("api" / "ai-tools")
        .and(warp::get())
        .and(with_state(state_for_api_status))
        .and_then(get_ai_tools_status);

    // POST /ai-tools and /api/ai-tools — forward a tool call (AUTH REQUIRED)
    let require_auth_ai = require_auth.clone();
    let ai_tools_route = warp::path("ai-tools")
        .and(warp::post())
        .and(require_auth_ai)
        .and(warp::body::json::<AiToolHttpRequest>())
        .and(with_state(state_for_post))
        .and_then(handle_ai_tools_request);
    let require_auth_api_ai = require_auth.clone();
    let api_ai_tools_route = warp::path!("api" / "ai-tools")
        .and(warp::post())
        .and(require_auth_api_ai)
        .and(warp::body::json::<AiToolHttpRequest>())
        .and(with_state(state_for_api_post))
        .and_then(handle_ai_tools_request);

    // GET /startup-token — returns the auth token for local discovery (localhost only, no auth)
    let startup_token_route = warp::path("startup-token")
        .and(warp::get())
        .and(with_state(state_for_startup_token))
        .and_then(get_startup_token);

    let routes = file_route
        .or(upload_route)
        .or(project_root_route)
        .or(ai_tools_status_route)
        .or(api_ai_tools_status_route)
        .or(ai_tools_route)
        .or(api_ai_tools_route)
        .or(startup_token_route)
        .recover(handle_rejection)
        .with(cors);

    info!("HTTP file server listening on http://127.0.0.1:{}", port);
    warp::serve(routes).run(([127, 0, 0, 1], port)).await;
}

/// Custom rejection for auth failures
#[derive(Debug)]
struct AuthRequired;
impl warp::reject::Reject for AuthRequired {}

/// Handle rejections to return proper JSON error responses
async fn handle_rejection(
    err: warp::Rejection,
) -> Result<impl warp::Reply, std::convert::Infallible> {
    if err.find::<AuthRequired>().is_some() {
        Ok(warp::reply::with_status(
            warp::reply::json(&serde_json::json!({
                "ok": false,
                "error": "Authentication required"
            })),
            warp::http::StatusCode::UNAUTHORIZED,
        ))
    } else {
        Ok(warp::reply::with_status(
            warp::reply::json(&serde_json::json!({
                "ok": false,
                "error": "Not found"
            })),
            warp::http::StatusCode::NOT_FOUND,
        ))
    }
}

/// GET /startup-token — returns the auth token for localhost clients to discover
async fn get_startup_token(state: Arc<AppState>) -> Result<impl warp::Reply, warp::Rejection> {
    match &state.auth_token {
        Some(token) => Ok(warp::reply::json(&serde_json::json!({
            "ok": true,
            "token": token,
        }))),
        None => Ok(warp::reply::json(&serde_json::json!({
            "ok": true,
            "token": null,
            "auth_disabled": true,
        }))),
    }
}

async fn get_ai_tools_status(state: Arc<AppState>) -> Result<impl warp::Reply, warp::Rejection> {
    let editor = state.get_editor_client().await;
    let pending = state.pending_ai_request_count().await;

    Ok(warp::reply::json(&serde_json::json!({
        "ok": true,
        "editor_connected": editor.is_some(),
        "pending": pending,
        "editor": editor.as_ref().map(|client| serde_json::json!({
            "role": client.role,
            "session_name": client.session_name,
            "app_version": client.app_version,
            "capabilities": client.capabilities,
        })),
    })))
}

async fn handle_ai_tools_request(
    body: AiToolHttpRequest,
    state: Arc<AppState>,
) -> Result<impl warp::Reply, warp::Rejection> {
    let editor = match state.get_editor_client().await {
        Some(client) => client,
        None => {
            return Ok(warp::reply::json(&serde_json::json!({
                "success": false,
                "error": "No editor session connected to Native Helper"
            })));
        }
    };

    let args = if body.args.is_null() {
        serde_json::json!({})
    } else {
        body.args
    };

    let request_id = format!("ai-{}", uuid::Uuid::new_v4().simple());
    let (tx, rx) = tokio::sync::oneshot::channel();
    state.add_ai_request(request_id.clone(), tx).await;

    let payload = serde_json::json!({
        "type": "ai_tool_request",
        "request_id": request_id,
        "tool": body.tool,
        "args": args,
    });

    let send_result = {
        let mut sender = editor.sender.lock().await;
        sender.send(Message::Text(payload.to_string())).await
    };

    if send_result.is_err() {
        state.remove_ai_request(&request_id).await;
        return Ok(warp::reply::json(&serde_json::json!({
            "success": false,
            "error": "Failed to forward request to editor session"
        })));
    }

    match tokio::time::timeout(Duration::from_secs(30), rx).await {
        Ok(Ok(result)) => Ok(warp::reply::json(&result)),
        Ok(Err(_)) => Ok(warp::reply::json(&serde_json::json!({
            "success": false,
            "error": "Editor session disconnected while handling AI request"
        }))),
        Err(_) => {
            state.remove_ai_request(&request_id).await;
            Ok(warp::reply::json(&serde_json::json!({
                "success": false,
                "error": "Timeout: editor did not respond within 30s"
            })))
        }
    }
}

/// Guess Content-Type from file extension
fn guess_content_type(path: &std::path::Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or("") {
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "avi" => "video/x-msvideo",
        "mkv" => "video/x-matroska",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "aac" => "audio/aac",
        "m4a" => "audio/mp4",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "obj" => "model/obj",
        "gltf" => "model/gltf+json",
        "glb" => "model/gltf-binary",
        "fbx" => "application/octet-stream",
        "ply" => "application/octet-stream",
        "splat" => "application/octet-stream",
        "json" => "application/json",
        "xml" => "application/xml",
        "txt" => "text/plain",
        "html" | "htm" => "text/html",
        "css" => "text/css",
        "js" => "application/javascript",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
    }
}

async fn serve_file(
    params: std::collections::HashMap<String, String>,
    state: Arc<AppState>,
) -> Result<impl warp::Reply, warp::Rejection> {
    let path = params.get("path").ok_or_else(warp::reject::not_found)?;
    let path = PathBuf::from(path);

    if !path.is_absolute() {
        return Err(warp::reject::not_found());
    }

    if !state.is_path_allowed(&path) {
        warn!("HTTP: Rejected file request for: {}", path.display());
        return Err(warp::reject::not_found());
    }

    if !path.exists() {
        return Err(warp::reject::not_found());
    }

    let content_type = guess_content_type(&path);

    match tokio::fs::read(&path).await {
        Ok(data) => {
            info!("HTTP: Serving file: {} ({} bytes)", path.display(), data.len());
            Ok(warp::reply::with_header(data, "Content-Type", content_type))
        }
        Err(_) => Err(warp::reject::not_found()),
    }
}

/// POST /upload?path=<absolute_path> — write binary body to disk
async fn handle_upload(
    params: std::collections::HashMap<String, String>,
    body: warp::hyper::body::Bytes,
    state: Arc<AppState>,
) -> Result<impl warp::Reply, warp::Rejection> {
    let path = params.get("path").ok_or_else(warp::reject::not_found)?;
    let path = PathBuf::from(path);

    if !path.is_absolute() {
        warn!("HTTP upload: Rejected non-absolute path");
        return Err(warp::reject::not_found());
    }

    if !state.is_path_allowed(&path) {
        warn!("HTTP upload: Rejected path: {}", path.display());
        return Err(warp::reject::not_found());
    }

    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            if let Err(e) = tokio::fs::create_dir_all(parent).await {
                warn!("HTTP upload: Cannot create parent dirs: {}", e);
                return Err(warp::reject::not_found());
            }
        }
    }

    let size = body.len();

    // Atomic write: .tmp then rename
    let tmp_path = path.with_extension(format!(
        "{}.tmp",
        path.extension().and_then(|e| e.to_str()).unwrap_or("")
    ));

    match tokio::fs::write(&tmp_path, &body).await {
        Ok(()) => {
            if let Err(_) = tokio::fs::rename(&tmp_path, &path).await {
                // Rename failed — fallback to direct write
                let _ = tokio::fs::remove_file(&tmp_path).await;
                if let Err(e) = tokio::fs::write(&path, &body).await {
                    warn!("HTTP upload: Write failed: {}", e);
                    return Err(warp::reject::not_found());
                }
            }
            info!("HTTP upload: {} ({} bytes)", path.display(), size);
            Ok(warp::reply::json(&serde_json::json!({
                "ok": true,
                "written": true,
                "size": size
            })))
        }
        Err(e) => {
            warn!("HTTP upload: Write failed: {}", e);
            Err(warp::reject::not_found())
        }
    }
}

/// GET /project-root — return the default project root path
async fn get_project_root() -> Result<impl warp::Reply, warp::Rejection> {
    let root = utils::get_project_root();
    Ok(warp::reply::json(&serde_json::json!({
        "ok": true,
        "path": root.to_string_lossy()
    })))
}

async fn handle_connection(
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
                    || is_cloudflare_pages_origin(origin_str)
                    || allowed_origins.iter().any(|o| o == origin_str);
                if !allowed {
                    warn!("Rejected WebSocket connection from disallowed origin: {}", origin_str);
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
        | Command::MatAnyoneUninstall { id } => id,
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

                debug!("Received command: {:?}", cmd);

                // ── Auth gate ──
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
                    Command::AiToolResult { id, request_id, result } => {
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
                        id, url, format_id, output_dir,
                    }
                    | Command::Download {
                        id, url, format_id, output_dir,
                    } => {
                        let response = download::handle_download(
                            &id, &url, format_id.as_deref(), output_dir.as_deref(),
                            Some(write.clone()),
                        ).await;
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

                    // ── MatAnyone2 streaming commands ──

                    Command::MatAnyoneSetup { id, python_path: _ } => {
                        let ws_sender = write.clone();
                        let id_clone = id.clone();
                        tokio::spawn(async move {
                            let ws = ws_sender.clone();
                            let id_ref = id_clone.clone();

                            let result = matanyone::setup_environment(move |step, percent, message| {
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
                            })
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
                                let speed_str = format!("{:.1} MB/s", progress.speed_bytes_per_sec / 1_048_576.0);
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
                            let result = proc.start(&python_path, &server_script, &models_dir).await;

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
                        id, video_path, mask_path, output_dir, start_frame, end_frame,
                    } => {
                        let ws_sender = write.clone();
                        let state_clone = state.clone();
                        let id_clone = id.clone();
                        tokio::spawn(async move {
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

                            if port == 0 {
                                let response = Response::error(
                                    &id_clone,
                                    error_codes::MATANYONE_NOT_RUNNING,
                                    "MatAnyone2 server is not running",
                                );
                                if let Ok(json) = serde_json::to_string(&response) {
                                    let mut w = ws_sender.lock().await;
                                    let _ = w.send(Message::Text(json)).await;
                                }
                                return;
                            }

                            let result = crate::matanyone::inference::cancel_job(port, &job_id).await;

                            let response = match result {
                                Ok(()) => Response::ok(
                                    &id_clone,
                                    serde_json::json!({
                                        "cancelled": true,
                                        "job_id": job_id,
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
