//! Connection-owned persistent OptiX preview. The worker accepts only a fixed local job directory.
use crate::{
    optix::{render_permit, worker_path},
    session::AppState,
};
use std::{
    path::PathBuf,
    process::Stdio,
    sync::{Arc, OnceLock},
    time::Duration,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::{OwnedSemaphorePermit, Semaphore},
};

struct Worker {
    child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
    id: String,
    root: PathBuf,
    _slot: OwnedSemaphorePermit,
}
impl Worker {
    async fn response(&mut self) -> Result<serde_json::Value, String> {
        let mut line = String::new();
        self.output
            .read_line(&mut line)
            .await
            .map_err(|e| e.to_string())?;
        if line.is_empty() || line.len() > 8192 {
            return Err("Native preview worker stopped or returned an invalid response".into());
        }
        serde_json::from_str(&line).map_err(|e| e.to_string())
    }
}
impl Drop for Worker {
    fn drop(&mut self) {
        let _ = self.child.start_kill();
        // Only the UUID directory created here can be removed.
        if uuid::Uuid::parse_str(&self.id).is_ok()
            && self.root
                == std::env::temp_dir()
                    .join("masterselects-optix")
                    .join(&self.id)
        {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }
}

#[derive(Default)]
pub struct PreviewSession {
    worker: Option<Worker>,
}
impl PreviewSession {
    async fn close(&mut self) {
        if let Some(mut worker) = self.worker.take() {
            let _ = worker.child.kill().await;
        }
    }
    pub async fn run(
        &mut self,
        state: &AppState,
        action: &str,
        id: Option<&str>,
        samples: Option<u32>,
        frame: Option<&[u8]>,
        reset: bool,
    ) -> Result<serde_json::Value, String> {
        if action == "preview-open" {
            self.close().await;
            static SLOT: OnceLock<Arc<Semaphore>> = OnceLock::new();
            let slot = SLOT
                .get_or_init(|| Arc::new(Semaphore::new(1)))
                .clone()
                .try_acquire_owned()
                .map_err(|_| "Native preview is already open in another connection")?;
            let _render = render_permit()?;
            let executable = worker_path()?;
            if !executable.is_file() || !executable.with_extension("ptx").is_file() {
                return Err("Install the OptiX preview worker beside the helper".into());
            }
            let id = uuid::Uuid::new_v4().to_string();
            let root = std::env::temp_dir().join("masterselects-optix").join(&id);
            tokio::fs::create_dir_all(&root)
                .await
                .map_err(|e| e.to_string())?;
            let mut command = Command::new(executable);
            command
                .arg("--preview")
                .arg(&root)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .kill_on_drop(true);
            #[cfg(windows)]
            command.creation_flags(0x08000000);
            let mut child = command.spawn().map_err(|e| e.to_string())?;
            let input = child.stdin.take().ok_or("Missing preview stdin")?;
            let output = BufReader::new(child.stdout.take().ok_or("Missing preview stdout")?);
            let mut worker = Worker {
                child,
                input,
                output,
                id: id.clone(),
                root: root.clone(),
                _slot: slot,
            };
            match tokio::time::timeout(Duration::from_secs(30), worker.response()).await {
                Ok(Ok(value)) if value["ready"] == true => {}
                _ => return Err("OptiX preview could not initialize within 30 seconds".into()),
            }
            state.grant_path(root.clone());
            self.worker = Some(worker);
            return Ok(serde_json::json!({"jobId":id,"inputPath":root.join("scene.mspx")}));
        }
        let worker = self
            .worker
            .as_mut()
            .ok_or("No native preview in this connection")?;
        if id != Some(worker.id.as_str()) {
            return Err("Preview job belongs to another connection".into());
        }
        if action == "preview-close" {
            self.close().await;
            return Ok(serde_json::json!({"closed":true}));
        }
        let _render = render_permit()?;
        let command = match action {
            "preview-load" => {
                let bytes = tokio::fs::metadata(worker.root.join("scene.mspx"))
                    .await
                    .map_err(|e| e.to_string())?
                    .len();
                if !(64..=1_073_741_824).contains(&bytes) {
                    return Err("Invalid preview snapshot size".into());
                }
                "load\n".as_bytes().to_vec()
            }
            "preview-frame" => {
                let samples = samples.unwrap_or(1);
                if !(1..=4).contains(&samples) || frame.map(|f| f.len()) != Some(416) {
                    return Err("Preview requires 1..4 samples and a 416-byte frame".into());
                }
                let mut bytes = format!("frame {} {}\n", samples, u8::from(reset)).into_bytes();
                bytes.extend_from_slice(frame.unwrap());
                bytes
            }
            _ => return Err("Unknown native preview command".into()),
        };
        let timeout = if action == "preview-load" { 30 } else { 10 };
        let result = tokio::time::timeout(Duration::from_secs(timeout), async {
            worker
                .input
                .write_all(&command)
                .await
                .map_err(|e| e.to_string())?;
            worker.input.flush().await.map_err(|e| e.to_string())?;
            worker.response().await
        })
        .await;
        match result {
            Ok(Ok(metrics)) => Ok(
                serde_json::json!({"metrics":metrics,"outputPath":worker.root.join("preview.rgba-depth")}),
            ),
            failure => {
                self.close().await;
                Err(match failure {
                    Ok(Err(message)) => message,
                    _ => "Native preview timed out; worker stopped".into(),
                })
            }
        }
    }
}
