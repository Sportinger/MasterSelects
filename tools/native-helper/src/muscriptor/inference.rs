//! MuScriptor sidecar job submission, polling, progress, and cancellation.

use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

#[derive(Debug, Clone, Serialize)]
pub struct TranscriptionRequest {
    pub audio_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instruments: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Note {
    pub pitch: u8,
    pub start_time: f64,
    pub end_time: f64,
    pub instrument: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TranscriptionProgress {
    pub job_id: String,
    pub status: String,
    pub completed: u32,
    pub total: u32,
    pub percent: f32,
}

#[derive(Debug, Clone, Serialize)]
pub struct TranscriptionResult {
    pub job_id: String,
    pub notes: Vec<Note>,
}

#[derive(Deserialize)]
struct SubmitResponse {
    job_id: String,
}

#[derive(Deserialize)]
struct ProgressResponse {
    status: String,
    #[serde(default)]
    completed: u32,
    #[serde(default)]
    total: u32,
    #[serde(default)]
    notes: Option<Vec<Note>>,
    #[serde(default)]
    message: Option<String>,
}

pub async fn run_transcription(
    port: u16,
    request: TranscriptionRequest,
    progress: impl Fn(TranscriptionProgress),
) -> Result<TranscriptionResult, String> {
    let body = serde_json::to_string(&request)
        .map_err(|e| format!("Failed to serialize transcription request: {e}"))?;
    let submit: SubmitResponse =
        serde_json::from_str(&http_post(port, "/transcribe", &body).await?)
            .map_err(|e| format!("Invalid MuScriptor submit response: {e}"))?;
    let job_id = submit.job_id;
    progress(TranscriptionProgress {
        job_id: job_id.clone(),
        status: "queued".to_string(),
        completed: 0,
        total: 0,
        percent: 0.0,
    });

    let mut poll_failures = 0u8;
    loop {
        tokio::time::sleep(Duration::from_millis(350)).await;
        let response = match http_get(port, &format!("/progress/{job_id}")).await {
            Ok(response) => {
                poll_failures = 0;
                response
            }
            Err(_error) if poll_failures < 9 => {
                poll_failures += 1;
                continue;
            }
            Err(error) => return Err(format!("MuScriptor progress polling failed: {error}")),
        };
        let snapshot: ProgressResponse = serde_json::from_str(&response)
            .map_err(|e| format!("Invalid MuScriptor progress response: {e}"))?;
        let percent = if snapshot.total == 0 {
            0.0
        } else {
            snapshot.completed as f32 / snapshot.total as f32 * 100.0
        };
        progress(TranscriptionProgress {
            job_id: job_id.clone(),
            status: snapshot.status.clone(),
            completed: snapshot.completed,
            total: snapshot.total,
            percent: percent.clamp(0.0, 100.0),
        });

        match snapshot.status.as_str() {
            "complete" => {
                return Ok(TranscriptionResult {
                    job_id,
                    notes: snapshot.notes.unwrap_or_default(),
                })
            }
            "error" => {
                return Err(snapshot
                    .message
                    .unwrap_or_else(|| "MuScriptor transcription failed".to_string()))
            }
            "cancelled" => return Err("MuScriptor transcription cancelled".to_string()),
            "queued" | "processing" => {}
            other => return Err(format!("Unexpected MuScriptor job status: {other}")),
        }
    }
}

async fn http_get(port: u16, path: &str) -> Result<String, String> {
    http_request(port, "GET", path, None).await
}

async fn http_post(port: u16, path: &str, body: &str) -> Result<String, String> {
    http_request(port, "POST", path, Some(body)).await
}

async fn http_request(
    port: u16,
    method: &str,
    path: &str,
    body: Option<&str>,
) -> Result<String, String> {
    let address = format!("127.0.0.1:{port}");
    let mut stream = TcpStream::connect(&address)
        .await
        .map_err(|e| format!("Connection to MuScriptor sidecar failed: {e}"))?;
    let payload = body.unwrap_or("");
    let request = format!(
        "{method} {path} HTTP/1.1\r\nHost: {address}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}",
        payload.len()
    );
    stream
        .write_all(request.as_bytes())
        .await
        .map_err(|e| format!("Failed to write MuScriptor request: {e}"))?;

    let mut bytes = Vec::new();
    stream
        .read_to_end(&mut bytes)
        .await
        .map_err(|e| format!("Failed to read MuScriptor response: {e}"))?;
    let response = String::from_utf8(bytes)
        .map_err(|e| format!("Invalid MuScriptor response encoding: {e}"))?;
    let (headers, body) = response
        .split_once("\r\n\r\n")
        .ok_or_else(|| "Malformed MuScriptor HTTP response".to_string())?;
    let status = headers
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|value| value.parse::<u16>().ok())
        .ok_or_else(|| "Malformed MuScriptor HTTP status".to_string())?;
    if !(200..300).contains(&status) {
        return Err(format!("MuScriptor HTTP {status}: {body}"));
    }
    Ok(body.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_omits_missing_instruments() {
        let json = serde_json::to_string(&TranscriptionRequest {
            audio_path: "audio.wav".to_string(),
            instruments: None,
        })
        .unwrap();
        assert!(!json.contains("instruments"));
    }

    #[test]
    fn note_contract_round_trips() {
        let note: Note = serde_json::from_str(
            r#"{"pitch":60,"start_time":0.5,"end_time":1.25,"instrument":"piano"}"#,
        )
        .unwrap();
        assert_eq!(note.pitch, 60);
        assert_eq!(note.instrument, "piano");
    }
}
