//! Local HTTP file and AI bridge server routes.

use futures_util::SinkExt;
use serde::Deserialize;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio_tungstenite::tungstenite::protocol::Message;
use tracing::{info, warn};
use warp::Filter;

use crate::session::AppState;
use crate::utils;

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
pub(crate) fn is_cloudflare_pages_origin(origin: &str) -> bool {
    origin == "https://masterselects.pages.dev"
        || (origin.starts_with("https://") && origin.ends_with(".masterselects.pages.dev"))
}

pub(super) async fn run(port: u16, state: Arc<AppState>, allowed_origins: Arc<Vec<String>>) {
    // CORS setup: static origins from config + Cloudflare Pages production domain.
    // For preview deployments (*.masterselects.pages.dev), use --allowed-origins CLI flag.
    // WebSocket handler has dynamic pattern matching for CF Pages subdomains.
    let cors_origins: Vec<String> = allowed_origins.iter().cloned().collect();
    let cors_headers: Vec<String> = cors_origins.iter().map(|o| o.to_string()).collect();

    let cors = warp::cors()
        .allow_origins(
            cors_headers
                .iter()
                .map(|s| s.as_str())
                .collect::<Vec<&str>>(),
        )
        .allow_methods(vec!["GET", "POST", "OPTIONS"])
        .allow_headers(vec!["Content-Type", "Authorization"]);

    // Auth filter: extracts Authorization header and validates against state token
    let state_for_auth = state.clone();
    let require_auth = warp::header::optional::<String>("authorization")
        .and(with_state(state_for_auth))
        .and_then(
            |auth_header: Option<String>, state: Arc<AppState>| async move {
                if check_http_auth(auth_header, &state.auth_token) {
                    Ok(())
                } else {
                    Err(warp::reject::custom(AuthRequired))
                }
            },
        )
        .untuple_one();

    // GET /file?path=... â€” serve a file (AUTH REQUIRED)
    let state_for_file = state.clone();
    let require_auth_file = require_auth.clone();
    let file_route = warp::path("file")
        .and(warp::get())
        .and(require_auth_file)
        .and(warp::query::<std::collections::HashMap<String, String>>())
        .and(with_state(state_for_file))
        .and_then(serve_file);

    // POST /upload?path=... â€” write binary body to file (AUTH REQUIRED)
    let state_for_upload = state.clone();
    let require_auth_upload = require_auth.clone();
    let upload_route = warp::path("upload")
        .and(warp::post())
        .and(require_auth_upload)
        .and(warp::query::<std::collections::HashMap<String, String>>())
        .and(warp::body::bytes())
        .and(with_state(state_for_upload))
        .and_then(handle_upload);

    // GET /project-root â€” return the default project root path (NO AUTH - safe metadata)
    let project_root_route = warp::path("project-root")
        .and(warp::get())
        .and_then(get_project_root);

    let state_for_status = state.clone();
    let state_for_api_status = state.clone();
    let state_for_post = state.clone();
    let state_for_api_post = state.clone();
    let state_for_startup_token = state.clone();

    // GET /ai-tools and /api/ai-tools â€” status for external AI bridge (NO AUTH - safe metadata)
    let ai_tools_status_route = warp::path("ai-tools")
        .and(warp::get())
        .and(with_state(state_for_status))
        .and_then(get_ai_tools_status);
    let api_ai_tools_status_route = warp::path!("api" / "ai-tools")
        .and(warp::get())
        .and(with_state(state_for_api_status))
        .and_then(get_ai_tools_status);

    // POST /ai-tools and /api/ai-tools â€” forward a tool call (AUTH REQUIRED)
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

    // GET /startup-token â€” returns the auth token for local discovery (localhost only, no auth)
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

/// GET /startup-token â€” returns the auth token for localhost clients to discover
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
            info!(
                "HTTP: Serving file: {} ({} bytes)",
                path.display(),
                data.len()
            );
            Ok(warp::reply::with_header(data, "Content-Type", content_type))
        }
        Err(_) => Err(warp::reject::not_found()),
    }
}

/// POST /upload?path=<absolute_path> â€” write binary body to disk
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
                // Rename failed â€” fallback to direct write
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

/// GET /project-root â€” return the default project root path
async fn get_project_root() -> Result<impl warp::Reply, warp::Rejection> {
    let root = utils::get_project_root();
    Ok(warp::reply::json(&serde_json::json!({
        "ok": true,
        "path": root.to_string_lossy()
    })))
}
