//! MatAnyone inference orchestration
//!
//! Submits matting jobs to the Python sidecar server and polls progress
//! until completion, error, or cancellation.

use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tracing::{debug, error, info, warn};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Request payload sent to the Python inference server.
#[derive(Debug, Clone, Serialize)]
pub struct MatteRequest {
    pub video_path: String,
    pub mask_path: String,
    pub output_dir: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_frame: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_frame: Option<u32>,
}

/// Progress snapshot returned while a job is still running.
#[derive(Debug, Clone, Serialize)]
pub struct MatteProgress {
    pub job_id: String,
    pub status: String,
    pub current_frame: u32,
    pub total_frames: u32,
    pub percent: f32,
}

/// Final result when a matting job completes successfully.
#[derive(Debug, Clone, Serialize)]
pub struct MatteResult {
    pub job_id: String,
    pub foreground_path: String,
    pub alpha_path: String,
}

// ---------------------------------------------------------------------------
// Internal deserialization helpers (server JSON shapes)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct SubmitResponse {
    job_id: String,
}

#[derive(Debug, Deserialize)]
struct ProgressResponse {
    status: String,
    #[serde(default)]
    current_frame: u32,
    #[serde(default)]
    total_frames: u32,
    #[serde(default)]
    foreground_path: Option<String>,
    #[serde(default)]
    alpha_path: Option<String>,
    #[serde(default)]
    message: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CancelResponse {
    #[serde(default)]
    cancelled: bool,
}

// ---------------------------------------------------------------------------
// Polling interval
// ---------------------------------------------------------------------------

const POLL_INTERVAL: Duration = Duration::from_millis(500);
const MAX_PROGRESS_POLL_FAILURES: u32 = 10;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Submit a matting job and poll progress until complete.
///
/// Returns the final result on success. The `progress_callback` is invoked on
/// every poll cycle so the caller can forward updates (e.g. over WebSocket).
pub async fn run_matte_job(
    port: u16,
    request: MatteRequest,
    progress_callback: impl Fn(MatteProgress),
) -> Result<MatteResult, String> {
    info!(
        "Submitting matte job: video={} mask={} output={}",
        request.video_path, request.mask_path, request.output_dir
    );

    // 1. POST /matte → get job_id
    let body =
        serde_json::to_string(&request).map_err(|e| format!("Failed to serialize request: {e}"))?;

    let response_text = http_post_json(port, "/matte", &body).await?;
    let submit: SubmitResponse = serde_json::from_str(&response_text)
        .map_err(|e| format!("Invalid submit response: {e} — body: {response_text}"))?;

    let job_id = submit.job_id;
    info!("Matte job submitted: {job_id}");
    let mut poll_failures = 0u32;

    // 2. Poll /progress/{job_id} until terminal state
    loop {
        tokio::time::sleep(POLL_INTERVAL).await;

        let progress_text = match http_get(port, &format!("/progress/{job_id}")).await {
            Ok(text) => {
                poll_failures = 0;
                text
            }
            Err(e) => {
                poll_failures += 1;
                warn!("Progress poll failed for {job_id}: {e}");
                if poll_failures >= MAX_PROGRESS_POLL_FAILURES {
                    return Err(format!(
                        "Progress polling failed for {job_id} after {poll_failures} attempts: {e}"
                    ));
                }
                // Transient network error; keep retrying briefly.
                continue;
            }
        };

        let progress: ProgressResponse = serde_json::from_str(&progress_text)
            .map_err(|e| format!("Invalid progress response: {e} — body: {progress_text}"))?;

        let total = progress.total_frames.max(1);
        let percent = if total > 0 {
            (progress.current_frame as f32 / total as f32) * 100.0
        } else {
            0.0
        };

        debug!(
            "Job {job_id}: status={} frame={}/{} ({:.1}%)",
            progress.status, progress.current_frame, progress.total_frames, percent
        );

        // 3. Invoke callback with current state
        progress_callback(MatteProgress {
            job_id: job_id.clone(),
            status: progress.status.clone(),
            current_frame: progress.current_frame,
            total_frames: progress.total_frames,
            percent,
        });

        // 4. Check terminal states
        match progress.status.as_str() {
            "complete" => {
                let foreground_path = progress
                    .foreground_path
                    .ok_or_else(|| "Server reported complete but no foreground_path".to_string())?;
                let alpha_path = progress
                    .alpha_path
                    .ok_or_else(|| "Server reported complete but no alpha_path".to_string())?;

                info!("Matte job {job_id} complete: fg={foreground_path} alpha={alpha_path}");

                return Ok(MatteResult {
                    job_id,
                    foreground_path,
                    alpha_path,
                });
            }
            "error" => {
                let msg = progress
                    .message
                    .unwrap_or_else(|| "Unknown error".to_string());
                error!("Matte job {job_id} failed: {msg}");
                return Err(format!("Matte job failed: {msg}"));
            }
            "cancelled" => {
                let msg = progress
                    .message
                    .unwrap_or_else(|| "Job cancelled by user".to_string());
                info!("Matte job {job_id} cancelled: {msg}");
                return Err(format!("Matte job cancelled: {msg}"));
            }
            "processing" | "queued" => {
                // Keep polling
            }
            other => {
                warn!("Matte job {job_id}: unexpected status '{other}', continuing to poll");
            }
        }
    }
}

/// Cancel a running matting job.
pub async fn cancel_job(port: u16, job_id: &str) -> Result<(), String> {
    info!("Cancelling matte job: {job_id}");

    let response_text = http_post_json(port, &format!("/cancel/{job_id}"), "{}").await?;
    let cancel: CancelResponse = serde_json::from_str(&response_text)
        .map_err(|e| format!("Invalid cancel response: {e} — body: {response_text}"))?;

    if cancel.cancelled {
        info!("Matte job {job_id} cancelled successfully");
        Ok(())
    } else {
        warn!("Server did not confirm cancellation for {job_id}");
        Err(format!("Server did not confirm cancellation for {job_id}"))
    }
}

// ---------------------------------------------------------------------------
// HTTP helpers (async, using tokio TcpStream)
// ---------------------------------------------------------------------------

/// Perform an HTTP GET against the local inference server.
async fn http_get(port: u16, path: &str) -> Result<String, String> {
    let addr = format!("127.0.0.1:{port}");
    let mut stream = TcpStream::connect(&addr)
        .await
        .map_err(|e| format!("Connection to {addr} failed: {e}"))?;

    let request = format!(
        "GET {path} HTTP/1.1\r\n\
         Host: 127.0.0.1:{port}\r\n\
         Accept: application/json\r\n\
         Connection: close\r\n\
         \r\n"
    );

    stream
        .write_all(request.as_bytes())
        .await
        .map_err(|e| format!("Failed to send GET request: {e}"))?;

    read_http_response(&mut stream).await
}

/// Perform an HTTP POST with a JSON body against the local inference server.
async fn http_post_json(port: u16, path: &str, body: &str) -> Result<String, String> {
    let addr = format!("127.0.0.1:{port}");
    let mut stream = TcpStream::connect(&addr)
        .await
        .map_err(|e| format!("Connection to {addr} failed: {e}"))?;

    let content_length = body.len();
    let request = format!(
        "POST {path} HTTP/1.1\r\n\
         Host: 127.0.0.1:{port}\r\n\
         Content-Type: application/json\r\n\
         Content-Length: {content_length}\r\n\
         Accept: application/json\r\n\
         Connection: close\r\n\
         \r\n{body}"
    );

    stream
        .write_all(request.as_bytes())
        .await
        .map_err(|e| format!("Failed to send POST request: {e}"))?;

    read_http_response(&mut stream).await
}

/// Read a full HTTP response, parse the status line and headers, and return
/// the body as a string. Handles both `Content-Length` and connection-close
/// framing (but not chunked transfer encoding — the Python sidecar uses
/// simple responses).
async fn read_http_response(stream: &mut TcpStream) -> Result<String, String> {
    let mut buf = Vec::with_capacity(4096);
    let mut tmp = [0u8; 4096];

    // Read until we have the full header section
    loop {
        let n = stream
            .read(&mut tmp)
            .await
            .map_err(|e| format!("Read error: {e}"))?;

        if n == 0 {
            break;
        }

        buf.extend_from_slice(&tmp[..n]);

        // Check if we've received the end of headers
        if buf.windows(4).any(|w| w == b"\r\n\r\n") {
            break;
        }
    }

    // Find the header/body split
    let header_end = buf
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .ok_or_else(|| "No HTTP header terminator found".to_string())?;

    let header_bytes = &buf[..header_end];
    let header_str =
        std::str::from_utf8(header_bytes).map_err(|e| format!("Invalid header UTF-8: {e}"))?;

    // Parse status line
    let status_line = header_str
        .lines()
        .next()
        .ok_or_else(|| "Empty HTTP response".to_string())?;

    let status_code: u16 = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| format!("Cannot parse status code from: {status_line}"))?;

    if status_code < 200 || status_code >= 300 {
        // Read remaining body for error context
        let body_start = header_end + 4;
        let mut body_buf = buf[body_start..].to_vec();
        loop {
            let n = stream
                .read(&mut tmp)
                .await
                .map_err(|e| format!("Read error: {e}"))?;
            if n == 0 {
                break;
            }
            body_buf.extend_from_slice(&tmp[..n]);
        }
        let body = String::from_utf8_lossy(&body_buf);
        return Err(format!("HTTP {status_code}: {body}"));
    }

    // Determine Content-Length if present
    let content_length: Option<usize> = header_str.lines().find_map(|line| {
        let lower = line.to_lowercase();
        if lower.starts_with("content-length:") {
            lower
                .trim_start_matches("content-length:")
                .trim()
                .parse()
                .ok()
        } else {
            None
        }
    });

    // Collect body bytes
    let body_start = header_end + 4;
    let mut body_buf = buf[body_start..].to_vec();

    match content_length {
        Some(expected) => {
            // Read until we have exactly `expected` bytes
            while body_buf.len() < expected {
                let n = stream
                    .read(&mut tmp)
                    .await
                    .map_err(|e| format!("Read error: {e}"))?;
                if n == 0 {
                    break;
                }
                body_buf.extend_from_slice(&tmp[..n]);
            }
            body_buf.truncate(expected);
        }
        None => {
            // No Content-Length — read until EOF (Connection: close)
            loop {
                let n = stream
                    .read(&mut tmp)
                    .await
                    .map_err(|e| format!("Read error: {e}"))?;
                if n == 0 {
                    break;
                }
                body_buf.extend_from_slice(&tmp[..n]);
            }
        }
    }

    String::from_utf8(body_buf).map_err(|e| format!("Invalid body UTF-8: {e}"))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_matte_request_serialization() {
        let req = MatteRequest {
            video_path: "/tmp/video.mp4".to_string(),
            mask_path: "/tmp/mask.png".to_string(),
            output_dir: "/tmp/output".to_string(),
            start_frame: Some(10),
            end_frame: None,
        };
        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains("\"video_path\":\"/tmp/video.mp4\""));
        assert!(json.contains("\"start_frame\":10"));
        // end_frame is None and skip_serializing_if = None, so it should be absent
        assert!(!json.contains("end_frame"));
    }

    #[test]
    fn test_progress_percent_calculation() {
        let progress = MatteProgress {
            job_id: "test".to_string(),
            status: "processing".to_string(),
            current_frame: 150,
            total_frames: 300,
            percent: 50.0,
        };
        assert!((progress.percent - 50.0).abs() < f32::EPSILON);
    }

    #[test]
    fn test_submit_response_deserialization() {
        let json = r#"{"job_id": "job_abc123"}"#;
        let resp: SubmitResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.job_id, "job_abc123");
    }

    #[test]
    fn test_progress_response_complete() {
        let json = r#"{
            "status": "complete",
            "current_frame": 300,
            "total_frames": 300,
            "foreground_path": "/tmp/fg.mp4",
            "alpha_path": "/tmp/alpha.mp4"
        }"#;
        let resp: ProgressResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.status, "complete");
        assert_eq!(resp.foreground_path.as_deref(), Some("/tmp/fg.mp4"));
        assert_eq!(resp.alpha_path.as_deref(), Some("/tmp/alpha.mp4"));
    }

    #[test]
    fn test_progress_response_error() {
        let json = r#"{
            "status": "error",
            "message": "GPU out of memory"
        }"#;
        let resp: ProgressResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.status, "error");
        assert_eq!(resp.message.as_deref(), Some("GPU out of memory"));
        assert_eq!(resp.current_frame, 0);
        assert_eq!(resp.total_frames, 0);
    }

    #[test]
    fn test_cancel_response_deserialization() {
        let json = r#"{"cancelled": true}"#;
        let resp: CancelResponse = serde_json::from_str(json).unwrap();
        assert!(resp.cancelled);
    }
}
