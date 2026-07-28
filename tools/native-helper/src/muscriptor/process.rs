//! Lifecycle management for the persistent MuScriptor Python sidecar.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::Path;
use std::process::Stdio;
use std::time::{Duration, Instant};

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tracing::{debug, info, warn};

const PORT_RANGE_START: u16 = 9900;
const PORT_RANGE_END: u16 = 9929;
const READY_TIMEOUT: Duration = Duration::from_secs(900);
const POLL_INTERVAL: Duration = Duration::from_millis(500);

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProcessStatus {
    Stopped,
    Starting,
    Ready,
    Error(String),
}

pub struct MuscriptorProcess {
    child: Option<Child>,
    port: u16,
    status: ProcessStatus,
    variant: Option<String>,
    requested_device: Option<String>,
    device: Option<String>,
}

impl MuscriptorProcess {
    pub fn new() -> Self {
        Self {
            child: None,
            port: 0,
            status: ProcessStatus::Stopped,
            variant: None,
            requested_device: None,
            device: None,
        }
    }

    pub fn status(&self) -> &ProcessStatus {
        &self.status
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    pub fn variant(&self) -> Option<&str> {
        self.variant.as_deref()
    }

    pub fn device(&self) -> Option<&str> {
        self.device.as_deref()
    }

    pub async fn start(
        &mut self,
        python: &Path,
        script: &Path,
        variant: &str,
        model_path: &Path,
        device: Option<&str>,
        cache_dir: &Path,
    ) -> Result<u16, String> {
        let requested_device = device.unwrap_or("auto");
        let launch_device = device.filter(|value| !value.eq_ignore_ascii_case("auto"));
        if self.status == ProcessStatus::Ready
            && self.variant.as_deref() == Some(variant)
            && self.requested_device.as_deref() == Some(requested_device)
            && self.health_check()
        {
            return Ok(self.port);
        }
        self.stop().await?;
        let port = find_free_port().ok_or_else(|| {
            format!("No free MuScriptor port in {PORT_RANGE_START}-{PORT_RANGE_END}")
        })?;
        self.status = ProcessStatus::Starting;
        self.port = port;
        self.variant = Some(variant.to_string());
        self.requested_device = Some(requested_device.to_string());
        self.device = None;

        let mut command = Command::new(python);
        command
            .arg(script)
            .args(["--port", &port.to_string(), "--variant", variant])
            .arg("--model-path")
            .arg(model_path)
            .arg("--cache-dir")
            .arg(cache_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        if let Some(device) = launch_device {
            command.args(["--device", device]);
        }
        command.env("HF_HOME", cache_dir);
        hide_console(&mut command);
        let mut child = command.spawn().map_err(|e| {
            let message = format!("Failed to start MuScriptor sidecar: {e}");
            self.status = ProcessStatus::Error(message.clone());
            message
        })?;
        if let Some(stderr) = child.stderr.take() {
            tokio::spawn(drain_sidecar_output(stderr, true));
        }
        if let Some(stdout) = child.stdout.take() {
            tokio::spawn(drain_sidecar_output(stdout, false));
        }
        self.child = Some(child);

        let deadline = Instant::now() + READY_TIMEOUT;
        while Instant::now() < deadline {
            if let Some(child) = self.child.as_mut() {
                match child.try_wait() {
                    Ok(Some(status)) => {
                        let message = format!("MuScriptor sidecar exited during startup: {status}");
                        self.child = None;
                        self.status = ProcessStatus::Error(message.clone());
                        return Err(message);
                    }
                    Ok(None) => {}
                    Err(e) => return Err(format!("Failed to inspect MuScriptor sidecar: {e}")),
                }
            }
            match http_health_status(self.port) {
                Ok(HealthStatus::Ready { device }) => {
                    self.device = Some(device.clone());
                    self.status = ProcessStatus::Ready;
                    info!(port, variant, device, "MuScriptor sidecar ready");
                    return Ok(port);
                }
                Ok(HealthStatus::ModelError(error)) => {
                    let message = format!("MuScriptor model load failed: {error}");
                    let _ = self.stop().await;
                    self.status = ProcessStatus::Error(message.clone());
                    return Err(message);
                }
                Ok(HealthStatus::Loading) | Err(_) => {}
            }
            tokio::time::sleep(POLL_INTERVAL).await;
        }

        let message = format!(
            "MuScriptor model did not become ready within {} seconds",
            READY_TIMEOUT.as_secs()
        );
        let _ = self.stop().await;
        self.status = ProcessStatus::Error(message.clone());
        Err(message)
    }

    pub async fn stop(&mut self) -> Result<(), String> {
        let Some(mut child) = self.child.take() else {
            self.status = ProcessStatus::Stopped;
            self.port = 0;
            self.variant = None;
            self.requested_device = None;
            self.device = None;
            return Ok(());
        };
        if let Some(pid) = child.id() {
            #[cfg(windows)]
            {
                let mut taskkill = Command::new("taskkill");
                taskkill
                    .args(["/PID", &pid.to_string(), "/T", "/F"])
                    .stdout(Stdio::null())
                    .stderr(Stdio::null());
                hide_console(&mut taskkill);
                let _ = taskkill.status().await;
            }
        }
        if child.try_wait().ok().flatten().is_none() {
            let _ = child.kill().await;
        }
        let _ = child.wait().await;
        self.status = ProcessStatus::Stopped;
        self.port = 0;
        self.variant = None;
        self.requested_device = None;
        self.device = None;
        Ok(())
    }

    pub fn health_check(&self) -> bool {
        self.port != 0
            && matches!(
                http_health_status(self.port),
                Ok(HealthStatus::Ready { .. })
            )
    }
}

async fn drain_sidecar_output<R>(reader: R, is_stderr: bool)
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut lines = BufReader::new(reader).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        if line.trim().is_empty() {
            continue;
        }
        if is_stderr {
            warn!(target: "muscriptor_sidecar", "{}", line);
        } else {
            debug!(target: "muscriptor_sidecar", "{}", line);
        }
    }
}

impl Drop for MuscriptorProcess {
    fn drop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.start_kill();
        }
    }
}

fn find_free_port() -> Option<u16> {
    (PORT_RANGE_START..=PORT_RANGE_END).find(|port| {
        let address: SocketAddr = ([127, 0, 0, 1], *port).into();
        std::net::TcpListener::bind(address).is_ok()
    })
}

#[derive(Debug, PartialEq)]
enum HealthStatus {
    Loading,
    Ready { device: String },
    ModelError(String),
}

#[derive(serde::Deserialize)]
struct HealthResponse {
    status: String,
    #[serde(default)]
    device: Option<String>,
    #[serde(default)]
    error: Option<String>,
}

fn http_health_status(port: u16) -> Result<HealthStatus, String> {
    let address: SocketAddr = ([127, 0, 0, 1], port).into();
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_millis(300))
        .map_err(|error| format!("Health connection failed: {error}"))?;
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let request =
        format!("GET /health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    stream
        .write_all(request.as_bytes())
        .map_err(|error| format!("Health request failed: {error}"))?;
    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|error| format!("Health response failed: {error}"))?;
    parse_health_response(&response)
}

fn parse_health_response(response: &str) -> Result<HealthStatus, String> {
    let (headers, body) = response
        .split_once("\r\n\r\n")
        .ok_or_else(|| "Malformed MuScriptor health response".to_string())?;
    let status_code = headers
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|value| value.parse::<u16>().ok())
        .ok_or_else(|| "Malformed MuScriptor health status".to_string())?;
    if !(200..300).contains(&status_code) {
        return Err(format!("MuScriptor health HTTP {status_code}"));
    }
    let health: HealthResponse = serde_json::from_str(body)
        .map_err(|error| format!("Invalid MuScriptor health response: {error}"))?;
    match health.status.as_str() {
        "loading" => Ok(HealthStatus::Loading),
        "ready" => Ok(HealthStatus::Ready {
            device: health
                .device
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| "MuScriptor health omitted the runtime device".to_string())?,
        }),
        "model_error" => Ok(HealthStatus::ModelError(
            health
                .error
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "Unknown model initialization error".to_string()),
        )),
        other => Err(format!("Unexpected MuScriptor health status: {other}")),
    }
}

#[cfg(windows)]
fn hide_console(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x08000000);
}

#[cfg(not(windows))]
fn hide_console(_command: &mut Command) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn starts_stopped() {
        let process = MuscriptorProcess::new();
        assert_eq!(process.status(), &ProcessStatus::Stopped);
        assert_eq!(process.port(), 0);
    }

    #[test]
    fn closed_port_is_not_healthy() {
        assert!(http_health_status(1).is_err());
    }

    #[test]
    fn health_response_reports_actual_device() {
        let response = concat!(
            "HTTP/1.0 200 OK\r\nContent-Type: application/json\r\n\r\n",
            r#"{"status":"ready","device":"cuda","error":null}"#,
        );
        assert_eq!(
            parse_health_response(response).unwrap(),
            HealthStatus::Ready {
                device: "cuda".to_string()
            }
        );
    }

    #[test]
    fn health_response_surfaces_model_error() {
        let response = concat!(
            "HTTP/1.0 200 OK\r\n\r\n",
            r#"{"status":"model_error","device":"cpu","error":"bad weights"}"#,
        );
        assert_eq!(
            parse_health_response(response).unwrap(),
            HealthStatus::ModelError("bad weights".to_string())
        );
    }
}
