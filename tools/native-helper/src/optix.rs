//! Bounded, authenticated still-render jobs for an optional sibling OptiX executable.
use crate::{
    protocol::{error_codes, Response},
    session::AppState,
};
use std::{path::PathBuf, sync::OnceLock, time::Duration};
use tokio::{process::Command, sync::Semaphore};

#[derive(Default)]
pub struct OptixSession {
    job: Option<(String, PathBuf)>,
}

fn worker_path() -> Result<PathBuf, String> {
    let name = if cfg!(windows) {
        "masterselects-optix.exe"
    } else {
        "masterselects-optix"
    };
    Ok(std::env::current_exe()
        .map_err(|e| e.to_string())?
        .with_file_name(name))
}

impl OptixSession {
    pub async fn handle(
        &mut self,
        state: &AppState,
        id: &str,
        action: &str,
        job_id: Option<&str>,
        samples: Option<u32>,
    ) -> Response {
        match self.run(state, action, job_id, samples).await {
            Ok(value) => Response::ok(id, value),
            Err(message) => Response::error(id, error_codes::INTERNAL_ERROR, message),
        }
    }
    async fn run(
        &mut self,
        state: &AppState,
        action: &str,
        job_id: Option<&str>,
        samples: Option<u32>,
    ) -> Result<serde_json::Value, String> {
        let worker = worker_path()?;
        if action == "status" {
            return Ok(
                serde_json::json!({"available": worker.is_file() && worker.with_extension("ptx").is_file()}),
            );
        }
        if action == "begin" {
            if !worker.is_file() || !worker.with_extension("ptx").is_file() {
                return Err(
                    "Build the optional OptiX worker beside the native helper first.".into(),
                );
            }
            self.discard();
            let key = uuid::Uuid::new_v4().to_string();
            let root = std::env::temp_dir().join("masterselects-optix").join(&key);
            tokio::fs::create_dir_all(&root)
                .await
                .map_err(|e| e.to_string())?;
            state.grant_path(root.clone());
            let input = root.join("scene.mspx");
            self.job = Some((key.clone(), root));
            return Ok(serde_json::json!({"jobId": key, "inputPath": input}));
        }
        let (key, root) = self.job.as_ref().ok_or("No OptiX job in this connection")?;
        if job_id != Some(key.as_str()) {
            return Err("OptiX job belongs to another connection".into());
        }
        if action == "discard" {
            self.discard();
            return Ok(serde_json::json!({"discarded": true}));
        }
        if action != "render" {
            return Err("Unknown OptiX action".into());
        }
        let samples = samples.unwrap_or(1);
        if !(1..=64).contains(&samples) {
            return Err("Samples must be 1..64".into());
        }
        static RENDER: OnceLock<Semaphore> = OnceLock::new();
        let _permit = RENDER
            .get_or_init(|| Semaphore::new(1))
            .try_acquire()
            .map_err(|_| "Another native render is active")?;
        let input = root.join("scene.mspx");
        let output = root.join("result.rgba32f");
        let size = tokio::fs::metadata(&input)
            .await
            .map_err(|e| e.to_string())?
            .len();
        if !(64..=1_073_741_824).contains(&size) {
            return Err("Invalid snapshot size (maximum 1 GiB)".into());
        }
        let mut command = Command::new(worker);
        command
            .arg(input)
            .arg(&output)
            .arg(samples.to_string())
            .kill_on_drop(true);
        #[cfg(windows)]
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
        let result = tokio::time::timeout(Duration::from_secs(120), command.output())
            .await
            .map_err(|_| "Native render timed out after 120 seconds; worker stopped")?
            .map_err(|e| format!("Cannot launch OptiX worker: {e}"))?;
        if !result.status.success() {
            return Err(String::from_utf8_lossy(&result.stderr)
                .chars()
                .take(4096)
                .collect());
        }
        let metrics: serde_json::Value = serde_json::from_slice(&result.stdout)
            .map_err(|e| format!("Invalid worker metrics: {e}"))?;
        Ok(serde_json::json!({"outputPath": output, "metrics": metrics}))
    }
    fn discard(&mut self) {
        if let Some((key, root)) = self.job.take() {
            // Only remove the exact random directory created by this session.
            let owned = std::env::temp_dir().join("masterselects-optix").join(&key);
            if root == owned && uuid::Uuid::parse_str(&key).is_ok() {
                let _ = std::fs::remove_dir_all(root);
            }
        }
    }
}
impl Drop for OptixSession {
    fn drop(&mut self) {
        self.discard();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn rejects_render_without_owned_job_and_foreign_job_id() {
        let state = AppState::new(None);
        let mut session = OptixSession::default();
        assert!(session
            .run(&state, "render", Some("../foreign"), Some(1))
            .await
            .is_err());
        session.job = Some(("owned".into(), PathBuf::from("unowned")));
        assert!(session
            .run(&state, "render", Some("foreign"), Some(1))
            .await
            .unwrap_err()
            .contains("another connection"));
        assert!(session
            .run(&state, "render", Some("owned"), Some(0))
            .await
            .unwrap_err()
            .contains("Samples"));
    }
}
