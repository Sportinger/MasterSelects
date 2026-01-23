//! MasterSelects Helper Lite - YouTube downloader only (no FFmpeg required)

use anyhow::Result;
use clap::Parser;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::net::{TcpListener, TcpStream};
use tokio::process::Command as TokioCommand;
use tokio_tungstenite::tungstenite::protocol::Message;
use tracing::{info, warn, error};
use warp::Filter;

#[derive(Parser, Debug)]
#[command(name = "masterselects-helper-lite")]
#[command(about = "YouTube downloader helper for MasterSelects (no FFmpeg)")]
#[command(version)]
struct Args {
    #[arg(short, long, default_value = "9876")]
    port: u16,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
enum Command {
    Ping { id: String },
    Info { id: String },
    ListFormats { id: String, url: String },
    DownloadYoutube {
        id: String,
        url: String,
        format_id: Option<String>,
        output_dir: Option<String>,
    },
    GetFile { id: String, path: String },
}

#[derive(Debug, Serialize)]
struct Response {
    id: String,
    ok: bool,
    #[serde(flatten)]
    data: serde_json::Value,
}

impl Response {
    fn ok(id: &str, data: serde_json::Value) -> Self {
        Self { id: id.to_string(), ok: true, data }
    }
    fn error(id: &str, code: &str, message: impl Into<String>) -> Self {
        Self {
            id: id.to_string(),
            ok: false,
            data: serde_json::json!({ "error": { "code": code, "message": message.into() } }),
        }
    }
}

/// Cross-platform download directory
fn get_download_dir() -> PathBuf {
    let base = std::env::temp_dir();
    base.join("masterselects-downloads")
}

/// Cross-platform allowed paths
fn is_path_allowed(path: &std::path::Path) -> bool {
    let temp_dir = std::env::temp_dir();
    let downloads_dir = dirs::download_dir();

    let path_str = path.to_string_lossy().to_lowercase();
    let temp_str = temp_dir.to_string_lossy().to_lowercase();

    if path_str.starts_with(&temp_str) {
        return true;
    }

    if let Some(dl) = downloads_dir {
        let dl_str = dl.to_string_lossy().to_lowercase();
        if path_str.starts_with(&dl_str) {
            return true;
        }
    }

    false
}

async fn handle_command(cmd: Command) -> Response {
    match cmd {
        Command::Ping { id } => Response::ok(&id, serde_json::json!({ "pong": true })),

        Command::Info { id } => {
            // Check if yt-dlp is available
            let ytdlp_available = TokioCommand::new("yt-dlp")
                .arg("--version")
                .output()
                .await
                .map(|o| o.status.success())
                .unwrap_or(false);

            Response::ok(&id, serde_json::json!({
                "version": env!("CARGO_PKG_VERSION"),
                "lite": true,
                "ytdlp_available": ytdlp_available,
                "download_dir": get_download_dir().to_string_lossy(),
            }))
        }

        Command::ListFormats { id, url } => {
            handle_list_formats(&id, &url).await
        }

        Command::DownloadYoutube { id, url, format_id, output_dir } => {
            handle_download(&id, &url, format_id.as_deref(), output_dir.as_deref()).await
        }

        Command::GetFile { id, path } => {
            handle_get_file(&id, &path)
        }
    }
}

async fn handle_list_formats(id: &str, url: &str) -> Response {
    use std::process::Stdio;

    if !url.contains("youtube.com") && !url.contains("youtu.be") {
        return Response::error(id, "INVALID_URL", "Not a valid YouTube URL");
    }

    let result = TokioCommand::new("yt-dlp")
        .args(["--dump-json", "--no-playlist", url])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await;

    match result {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            match serde_json::from_str::<serde_json::Value>(&stdout) {
                Ok(info) => {
                    let title = info.get("title").and_then(|v| v.as_str()).unwrap_or("Unknown");
                    let uploader = info.get("uploader").and_then(|v| v.as_str()).unwrap_or("Unknown");
                    let duration = info.get("duration").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    let thumbnail = info.get("thumbnail").and_then(|v| v.as_str()).unwrap_or("");

                    // Parse formats
                    let mut recommendations = Vec::new();
                    if let Some(formats) = info.get("formats").and_then(|v| v.as_array()) {
                        let mut by_height: HashMap<i64, Vec<&serde_json::Value>> = HashMap::new();

                        for fmt in formats {
                            let acodec = fmt.get("acodec").and_then(|v| v.as_str()).unwrap_or("none");
                            let vcodec = fmt.get("vcodec").and_then(|v| v.as_str()).unwrap_or("none");
                            let ext = fmt.get("ext").and_then(|v| v.as_str()).unwrap_or("");

                            // Skip audio-only and AV1
                            if vcodec == "none" || vcodec.contains("av01") {
                                continue;
                            }

                            if let Some(height) = fmt.get("height").and_then(|v| v.as_i64()) {
                                if height >= 360 {
                                    by_height.entry(height).or_default().push(fmt);
                                }
                            }
                        }

                        // Get best format per resolution, prefer H.264
                        let mut heights: Vec<_> = by_height.keys().copied().collect();
                        heights.sort_by(|a, b| b.cmp(a));

                        for height in heights.into_iter().take(6) {
                            if let Some(fmts) = by_height.get(&height) {
                                // Prefer H.264 (avc1) over VP9
                                let best = fmts.iter()
                                    .max_by_key(|f| {
                                        let vcodec = f.get("vcodec").and_then(|v| v.as_str()).unwrap_or("");
                                        let tbr = f.get("tbr").and_then(|v| v.as_f64()).unwrap_or(0.0);
                                        let codec_score = if vcodec.contains("avc") { 1000.0 } else { 0.0 };
                                        (codec_score + tbr) as i64
                                    });

                                if let Some(fmt) = best {
                                    let format_id = fmt.get("format_id").and_then(|v| v.as_str()).unwrap_or("");
                                    let vcodec = fmt.get("vcodec").and_then(|v| v.as_str()).unwrap_or("");
                                    let fps = fmt.get("fps").and_then(|v| v.as_f64()).unwrap_or(30.0);
                                    let filesize = fmt.get("filesize").and_then(|v| v.as_i64())
                                        .or_else(|| fmt.get("filesize_approx").and_then(|v| v.as_i64()));

                                    let codec_name = if vcodec.contains("avc") { "H.264" }
                                        else if vcodec.contains("vp9") { "VP9" }
                                        else { vcodec };

                                    recommendations.push(serde_json::json!({
                                        "format_id": format_id,
                                        "height": height,
                                        "fps": fps,
                                        "codec": codec_name,
                                        "filesize": filesize,
                                        "label": format!("{}p {} ({:.0}fps)", height, codec_name, fps),
                                    }));
                                }
                            }
                        }
                    }

                    Response::ok(id, serde_json::json!({
                        "title": title,
                        "uploader": uploader,
                        "duration": duration,
                        "thumbnail": thumbnail,
                        "recommendations": recommendations,
                    }))
                }
                Err(e) => Response::error(id, "PARSE_ERROR", format!("Failed to parse yt-dlp output: {}", e)),
            }
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Response::error(id, "YTDLP_ERROR", stderr.to_string())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            Response::error(id, "YTDLP_NOT_FOUND", "yt-dlp not found. Install with: pip install yt-dlp")
        }
        Err(e) => Response::error(id, "ERROR", e.to_string()),
    }
}

async fn handle_download(id: &str, url: &str, format_id: Option<&str>, output_dir: Option<&str>) -> Response {
    use std::process::Stdio;

    if !url.contains("youtube.com") && !url.contains("youtu.be") {
        return Response::error(id, "INVALID_URL", "Not a valid YouTube URL");
    }

    let download_dir = output_dir.map(PathBuf::from).unwrap_or_else(get_download_dir);

    if let Err(e) = std::fs::create_dir_all(&download_dir) {
        return Response::error(id, "PERMISSION_DENIED", format!("Cannot create directory: {}", e));
    }

    info!("Downloading: {} to {:?}", url, download_dir);

    let output_template = download_dir.join("%(title)s.%(ext)s").to_string_lossy().to_string();

    let format_str = if let Some(fid) = format_id {
        format!("{}+bestaudio[ext=m4a]/{}+bestaudio/best", fid, fid)
    } else {
        "bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best".to_string()
    };

    let result = TokioCommand::new("yt-dlp")
        .args([
            "-f", &format_str,
            "--merge-output-format", "mp4",
            "-o", &output_template,
            "--print", "after_move:filepath",
            "--no-playlist",
            url,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await;

    match result {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let output_path = stdout.lines().last().unwrap_or("").trim();

            if output_path.is_empty() {
                return Response::error(id, "DOWNLOAD_FAILED", "yt-dlp did not return output path");
            }

            info!("Download complete: {}", output_path);
            Response::ok(id, serde_json::json!({ "path": output_path }))
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            warn!("yt-dlp failed: {}", stderr);
            Response::error(id, "DOWNLOAD_FAILED", stderr.lines().last().unwrap_or("Unknown error"))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            Response::error(id, "YTDLP_NOT_FOUND", "yt-dlp not found. Install with: pip install yt-dlp")
        }
        Err(e) => Response::error(id, "DOWNLOAD_FAILED", e.to_string()),
    }
}

fn handle_get_file(id: &str, path: &str) -> Response {
    use std::io::Read;

    let path = std::path::Path::new(path);

    if !path.is_absolute() {
        return Response::error(id, "INVALID_PATH", "Path must be absolute");
    }

    if !is_path_allowed(path) {
        return Response::error(id, "PERMISSION_DENIED", "Path not in allowed directory");
    }

    if !path.exists() {
        return Response::error(id, "FILE_NOT_FOUND", format!("File not found: {}", path.display()));
    }

    match std::fs::read(path) {
        Ok(data) => {
            use base64::Engine;
            let encoded = base64::engine::general_purpose::STANDARD.encode(&data);
            info!("Serving file: {} ({} bytes)", path.display(), data.len());
            Response::ok(id, serde_json::json!({
                "size": data.len(),
                "path": path.display().to_string(),
                "data": encoded,
            }))
        }
        Err(e) => Response::error(id, "FILE_NOT_FOUND", format!("Cannot read: {}", e)),
    }
}

async fn handle_websocket(stream: TcpStream) {
    let ws_stream = match tokio_tungstenite::accept_async(stream).await {
        Ok(ws) => ws,
        Err(e) => {
            error!("WebSocket handshake failed: {}", e);
            return;
        }
    };

    info!("New WebSocket connection");
    let (mut write, mut read) = ws_stream.split();

    while let Some(msg) = read.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                match serde_json::from_str::<Command>(&text) {
                    Ok(cmd) => {
                        let response = handle_command(cmd).await;
                        let json = serde_json::to_string(&response).unwrap();
                        if let Err(e) = write.send(Message::Text(json)).await {
                            error!("Failed to send response: {}", e);
                            break;
                        }
                    }
                    Err(e) => {
                        warn!("Invalid command: {}", e);
                        let resp = Response::error("unknown", "INVALID_COMMAND", e.to_string());
                        let json = serde_json::to_string(&resp).unwrap();
                        let _ = write.send(Message::Text(json)).await;
                    }
                }
            }
            Ok(Message::Close(_)) => break,
            Err(e) => {
                error!("WebSocket error: {}", e);
                break;
            }
            _ => {}
        }
    }

    info!("WebSocket connection closed");
}

async fn serve_file(params: HashMap<String, String>) -> Result<impl warp::Reply, warp::Rejection> {
    let path = params.get("path").ok_or_else(warp::reject::not_found)?;
    let path = PathBuf::from(path);

    if !path.is_absolute() || !is_path_allowed(&path) || !path.exists() {
        return Err(warp::reject::not_found());
    }

    match tokio::fs::read(&path).await {
        Ok(data) => {
            info!("HTTP: Serving {} ({} bytes)", path.display(), data.len());
            Ok(warp::reply::with_header(
                data,
                "Content-Type",
                "application/octet-stream",
            ))
        }
        Err(_) => Err(warp::reject::not_found()),
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();

    tracing_subscriber::fmt()
        .with_target(false)
        .compact()
        .init();

    let ws_addr = format!("127.0.0.1:{}", args.port);
    let http_port = args.port + 1;

    println!();
    println!("========================================");
    println!("  MasterSelects Helper Lite v{}", env!("CARGO_PKG_VERSION"));
    println!("  (YouTube downloader - no FFmpeg)");
    println!("========================================");
    println!("  WebSocket: ws://127.0.0.1:{}", args.port);
    println!("  HTTP:      http://127.0.0.1:{}", http_port);
    println!("  Downloads: {}", get_download_dir().display());
    println!("========================================");
    println!();

    // HTTP file server
    let file_route = warp::path("file")
        .and(warp::get())
        .and(warp::query::<HashMap<String, String>>())
        .and_then(serve_file);

    let cors = warp::cors()
        .allow_any_origin()
        .allow_methods(vec!["GET"]);

    let http_server = warp::serve(file_route.with(cors))
        .run(([127, 0, 0, 1], http_port));

    tokio::spawn(http_server);
    info!("HTTP file server on port {}", http_port);

    // WebSocket server
    let listener = TcpListener::bind(&ws_addr).await?;
    info!("WebSocket server on port {}", args.port);

    loop {
        let (stream, addr) = listener.accept().await?;
        tokio::spawn(handle_websocket(stream));
    }
}
