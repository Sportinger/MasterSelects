//! MatAnyone2 Python inference server process management.
//!
//! Spawns a Python HTTP server as a child process on a free local port,
//! monitors its health via `/health`, and provides graceful shutdown.

use std::io::{Read, Write as IoWrite};
use std::net::{SocketAddr, TcpStream};
use std::path::Path;
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tracing::{debug, error, info, warn};

/// Port range to scan for an available port.
const PORT_RANGE_START: u16 = 9878;
const PORT_RANGE_END: u16 = 9899;

/// Default timeout when waiting for the server to become ready (seconds).
const DEFAULT_READY_TIMEOUT_SECS: u64 = 60;

/// Interval between health-check polls while waiting for readiness (milliseconds).
const HEALTH_POLL_INTERVAL_MS: u64 = 500;

/// Grace period before forcefully killing the child process (seconds).
const GRACEFUL_STOP_TIMEOUT_SECS: u64 = 5;

/// Maximum number of stderr lines to collect for diagnostics.
const MAX_STDERR_LINES: usize = 40;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Current lifecycle status of the Python inference server.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProcessStatus {
    Stopped,
    Starting,
    Ready,
    Error(String),
}

/// Manages a single MatAnyone2 Python inference server subprocess.
pub struct MatAnyoneProcess {
    child: Option<Child>,
    port: u16,
    status: ProcessStatus,
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

impl MatAnyoneProcess {
    /// Create a new, idle process handle.
    pub fn new() -> Self {
        Self {
            child: None,
            port: 0,
            status: ProcessStatus::Stopped,
        }
    }

    /// Start the Python inference server.
    ///
    /// * `python_path`   - Path to the Python executable inside the venv.
    /// * `server_script` - Path to `matanyone2_server.py`.
    /// * `models_dir`    - Path to the directory containing model weights.
    ///
    /// Returns the port on which the server is listening.
    pub async fn start(
        &mut self,
        python_path: &Path,
        server_script: &Path,
        models_dir: &Path,
    ) -> Result<u16, String> {
        // Prevent double-start.
        if self.status == ProcessStatus::Starting || self.status == ProcessStatus::Ready {
            return Ok(self.port);
        }

        self.status = ProcessStatus::Starting;

        // Find a free port.
        let port = find_free_port().ok_or_else(|| {
            let msg = format!(
                "No free port found in range {PORT_RANGE_START}-{PORT_RANGE_END}"
            );
            self.status = ProcessStatus::Error(msg.clone());
            msg
        })?;

        info!(
            port,
            python = %python_path.display(),
            script = %server_script.display(),
            models = %models_dir.display(),
            "Starting MatAnyone2 inference server"
        );

        let mut command = Command::new(python_path);
        command
            .arg(server_script)
            .arg("--port")
            .arg(port.to_string())
            .arg("--models-dir")
            .arg(models_dir)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);
        hide_console_window(&mut command);

        let child = command
            .spawn()
            .map_err(|e| {
                let msg = format!("Failed to spawn Python process: {e}");
                error!("{}", msg);
                self.status = ProcessStatus::Error(msg.clone());
                msg
            })?;

        self.child = Some(child);
        self.port = port;

        info!(port, "MatAnyone2 process spawned, waiting for readiness");

        // Wait for the server to report healthy.
        match self.wait_ready(DEFAULT_READY_TIMEOUT_SECS).await {
            Ok(()) => {
                self.status = ProcessStatus::Ready;
                info!(port, "MatAnyone2 inference server is ready");
                Ok(port)
            }
            Err(e) => {
                error!("MatAnyone2 server failed to become ready: {}", e);
                // Collect stderr for diagnostics before tearing down.
                self.collect_stderr_diagnostic().await;
                let _ = self.stop().await;
                self.status = ProcessStatus::Error(e.clone());
                Err(e)
            }
        }
    }

    /// Stop the inference server gracefully.
    ///
    /// On Unix the child receives SIGTERM first; if it does not exit within
    /// [`GRACEFUL_STOP_TIMEOUT_SECS`] it is killed with SIGKILL.
    /// On Windows `child.kill()` is used directly (no SIGTERM support).
    pub async fn stop(&mut self) -> Result<(), String> {
        let child = match self.child.take() {
            Some(c) => c,
            None => {
                self.status = ProcessStatus::Stopped;
                return Ok(());
            }
        };

        info!(port = self.port, "Stopping MatAnyone2 inference server");

        let stop_result = stop_child(child).await;

        self.status = ProcessStatus::Stopped;
        self.port = 0;

        stop_result
    }

    /// Returns `true` when the server responds to `GET /health` with
    /// `{"status": "ready"}`.
    pub async fn health_check(&self) -> bool {
        if self.port == 0 {
            return false;
        }
        http_health_check(self.port)
    }

    /// Current lifecycle status.
    pub fn status(&self) -> &ProcessStatus {
        &self.status
    }

    /// Port the server is bound to (0 when stopped).
    pub fn port(&self) -> u16 {
        self.port
    }

    /// Poll `/health` every 500 ms until the server reports ready or
    /// `timeout_secs` elapses.
    pub async fn wait_ready(&self, timeout_secs: u64) -> Result<(), String> {
        let deadline = Instant::now() + Duration::from_secs(timeout_secs);

        while Instant::now() < deadline {
            // If the port is not open yet the server may still be loading models.
            if !is_port_open(self.port) {
                tokio::time::sleep(Duration::from_millis(HEALTH_POLL_INTERVAL_MS)).await;
                continue;
            }

            if http_health_check(self.port) {
                return Ok(());
            }

            tokio::time::sleep(Duration::from_millis(HEALTH_POLL_INTERVAL_MS)).await;
        }

        Err(format!(
            "MatAnyone2 server did not become ready within {timeout_secs}s"
        ))
    }

    /// Check whether the child process has exited unexpectedly.
    /// Returns `true` if the process has crashed or exited.
    pub async fn has_crashed(&mut self) -> bool {
        let child = match self.child.as_mut() {
            Some(c) => c,
            None => return self.status != ProcessStatus::Stopped,
        };

        match child.try_wait() {
            Ok(Some(exit_status)) => {
                let msg = format!("MatAnyone2 process exited unexpectedly: {exit_status}");
                warn!("{}", msg);
                self.status = ProcessStatus::Error(msg);
                self.child = None;
                true
            }
            Ok(None) => false, // still running
            Err(e) => {
                let msg = format!("Failed to check MatAnyone2 process status: {e}");
                warn!("{}", msg);
                self.status = ProcessStatus::Error(msg);
                true
            }
        }
    }

    /// Read available stderr output from the child for diagnostic logging.
    ///
    /// Collects up to [`MAX_STDERR_LINES`] lines using a short timeout so the
    /// caller is never blocked for long.
    async fn collect_stderr_diagnostic(&mut self) {
        let child = match self.child.as_mut() {
            Some(c) => c,
            None => return,
        };

        let stderr = match child.stderr.take() {
            Some(s) => s,
            None => return,
        };

        let mut reader = BufReader::new(stderr);
        let mut lines_collected: usize = 0;

        // Read lines with a timeout so we don't block forever if the process
        // is still running and producing output.
        let collect_future = async {
            let mut line = String::new();
            while lines_collected < MAX_STDERR_LINES {
                line.clear();
                match reader.read_line(&mut line).await {
                    Ok(0) => break, // EOF
                    Ok(_) => {
                        let trimmed = line.trim_end();
                        if !trimmed.is_empty() {
                            warn!(target: "matanyone_stderr", "{}", trimmed);
                            lines_collected += 1;
                        }
                    }
                    Err(_) => break,
                }
            }
        };

        // Allow at most 2 seconds for stderr collection.
        let _ = tokio::time::timeout(Duration::from_secs(2), collect_future).await;

        if lines_collected > 0 {
            debug!(
                "Collected {} lines of stderr from MatAnyone2 process",
                lines_collected
            );
        }
    }
}

#[cfg(windows)]
fn hide_console_window(command: &mut Command) -> &mut Command {
    use std::os::windows::process::CommandExt;

    command.creation_flags(0x08000000)
}

#[cfg(not(windows))]
fn hide_console_window(command: &mut Command) -> &mut Command {
    command
}

impl Drop for MatAnyoneProcess {
    fn drop(&mut self) {
        // Best-effort synchronous kill so we never leak a subprocess.
        if let Some(mut child) = self.child.take() {
            let _ = child.start_kill();
        }
    }
}

// ---------------------------------------------------------------------------
// Free functions (port / HTTP helpers)
// ---------------------------------------------------------------------------

/// Scan [`PORT_RANGE_START`]..=[`PORT_RANGE_END`] and return the first port
/// that is not currently in use.
fn find_free_port() -> Option<u16> {
    for port in PORT_RANGE_START..=PORT_RANGE_END {
        let addr: SocketAddr = ([127, 0, 0, 1], port).into();
        // Attempt to bind; success means the port is free.
        if std::net::TcpListener::bind(addr).is_ok() {
            debug!(port, "Found free port for MatAnyone2 server");
            return Some(port);
        }
    }
    None
}

/// Quick check whether *anything* is listening on `127.0.0.1:{port}`.
fn is_port_open(port: u16) -> bool {
    let addr: SocketAddr = ([127, 0, 0, 1], port).into();
    TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok()
}

/// Perform an HTTP `GET /health` against the local server and verify the
/// response contains `"ready"`.
///
/// Uses a raw [`TcpStream`] to avoid pulling in an extra HTTP client crate.
fn http_health_check(port: u16) -> bool {
    let addr: SocketAddr = ([127, 0, 0, 1], port).into();

    let mut stream = match TcpStream::connect_timeout(&addr, Duration::from_millis(500)) {
        Ok(s) => s,
        Err(_) => return false,
    };

    if stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .is_err()
    {
        return false;
    }
    if stream
        .set_write_timeout(Some(Duration::from_secs(2)))
        .is_err()
    {
        return false;
    }

    let request = format!(
        "GET /health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }

    let mut response = String::new();
    if stream.read_to_string(&mut response).is_err() || response.is_empty() {
        return false;
    }

    // Check for a 200 status line and that the body contains "ready".
    response.contains("200") && response.contains("\"ready\"")
}

/// Send SIGTERM to a process by PID (Unix only).
///
/// Shells out to `kill -15 <pid>` to avoid a direct `libc` dependency.
/// Returns `true` if the signal was sent successfully.
#[cfg(unix)]
fn send_sigterm(pid: u32) -> bool {
    std::process::Command::new("kill")
        .args(["-15", &pid.to_string()])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Stop a child process, attempting a graceful shutdown first on Unix.
async fn stop_child(mut child: Child) -> Result<(), String> {
    #[cfg(unix)]
    {
        // Try SIGTERM for a graceful shutdown.
        if let Some(pid) = child.id() {
            if send_sigterm(pid) {
                debug!(pid, "Sent SIGTERM to MatAnyone2 process");

                // Wait up to GRACEFUL_STOP_TIMEOUT_SECS for exit.
                let deadline =
                    Instant::now() + Duration::from_secs(GRACEFUL_STOP_TIMEOUT_SECS);
                loop {
                    match child.try_wait() {
                        Ok(Some(status)) => {
                            info!("MatAnyone2 process exited: {}", status);
                            return Ok(());
                        }
                        Ok(None) if Instant::now() < deadline => {
                            tokio::time::sleep(Duration::from_millis(100)).await;
                        }
                        _ => break,
                    }
                }

                // Still alive after grace period -- force kill.
                warn!("MatAnyone2 process did not exit in time, sending SIGKILL");
            } else {
                warn!(pid, "Failed to send SIGTERM to MatAnyone2 process");
            }
        }

        child.kill().await.map_err(|e| {
            format!("Failed to kill MatAnyone2 process: {e}")
        })?;
        let _ = child.wait().await;
        info!("MatAnyone2 process terminated (SIGKILL)");
        return Ok(());
    }

    #[cfg(not(unix))]
    {
        // Windows (and other platforms) have no SIGTERM; kill directly.
        child.kill().await.map_err(|e| {
            format!("Failed to kill MatAnyone2 process: {e}")
        })?;
        let _ = child.wait().await;
        info!("MatAnyone2 process terminated");
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_find_free_port() {
        // Should always find at least one free port in the range on a dev machine.
        let port = find_free_port();
        assert!(port.is_some());
        let port = port.unwrap();
        assert!((PORT_RANGE_START..=PORT_RANGE_END).contains(&port));
    }

    #[test]
    fn test_new_process_is_stopped() {
        let proc = MatAnyoneProcess::new();
        assert_eq!(proc.status(), &ProcessStatus::Stopped);
        assert_eq!(proc.port(), 0);
    }

    #[test]
    fn test_health_check_fails_on_closed_port() {
        // An unoccupied port should fail the health check.
        assert!(!http_health_check(1));
    }

    #[test]
    fn test_health_check_reads_split_response_body() {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        use std::thread;

        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();

        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request_buf = [0u8; 512];
            let _ = stream.read(&mut request_buf);
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n")
                .unwrap();
            stream.flush().unwrap();
            thread::sleep(Duration::from_millis(50));
            stream.write_all(br#"{"status":"ready"}"#).unwrap();
        });

        assert!(http_health_check(port));
        handle.join().unwrap();
    }

    #[test]
    fn test_is_port_open_closed() {
        // An unlikely-to-be-used high port should be closed.
        assert!(!is_port_open(19999));
    }

    #[test]
    fn test_process_status_serialization() {
        let status = ProcessStatus::Ready;
        let json = serde_json::to_string(&status).unwrap();
        assert_eq!(json, "\"ready\"");

        let status = ProcessStatus::Error("boom".into());
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("boom"));
    }
}
