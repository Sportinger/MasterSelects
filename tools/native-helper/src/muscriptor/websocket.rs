//! WebSocket orchestration for long-running MuScriptor commands.

use std::path::Path;
use std::sync::Arc;

use futures_util::SinkExt;
use tokio_tungstenite::tungstenite::protocol::Message;

use crate::download::WsSender;
use crate::protocol::{error_codes, Command, Response};
use crate::session::AppState;

use super::{env, inference};

pub fn dispatch(command: Command, sender: WsSender, state: Arc<AppState>) {
    match command {
        Command::MuscriptorSetup { id } => {
            tokio::spawn(setup(id, sender));
        }
        Command::MuscriptorDownloadModel {
            id,
            variant,
            hf_token,
        } => {
            tokio::spawn(download_model(id, variant, hf_token, sender));
        }
        Command::MuscriptorStart {
            id,
            variant,
            device,
        } => {
            tokio::spawn(start(id, variant, device, sender, state));
        }
        Command::MuscriptorTranscribe {
            id,
            audio_path,
            instruments,
        } => {
            tokio::spawn(transcribe(id, audio_path, instruments, sender, state));
        }
        Command::MuscriptorCancel { id, job_id } => {
            tokio::spawn(cancel(id, job_id, sender, state));
        }
        _ => unreachable!("non-streaming command passed to MuScriptor dispatcher"),
    }
}

async fn send(sender: &WsSender, response: Response) {
    if let Ok(json) = serde_json::to_string(&response) {
        let _ = sender.lock().await.send(Message::Text(json)).await;
    }
}

fn send_detached(sender: WsSender, response: Response) {
    tokio::spawn(async move { send(&sender, response).await });
}

async fn setup(id: String, sender: WsSender) {
    let progress_sender = sender.clone();
    let progress_id = id.clone();
    let result = super::setup_environment(move |step, percent, message| {
        send_detached(
            progress_sender.clone(),
            Response::setup_progress(&progress_id, step, percent, message),
        );
    })
    .await;
    let response = match result {
        Ok(environment) => Response::ok(
            &id,
            serde_json::json!({
                "type": "complete",
                "setup_status": "installed",
                "env": environment,
            }),
        ),
        Err(error) => Response::error(&id, error_codes::MUSCRIPTOR_SETUP_FAILED, error),
    };
    send(&sender, response).await;
}

async fn download_model(id: String, variant: String, hf_token: Option<String>, sender: WsSender) {
    let variant = match super::validate_variant(&variant) {
        Ok(variant) => variant,
        Err(error) => {
            send(
                &sender,
                Response::error(&id, error_codes::MUSCRIPTOR_MODEL_DOWNLOAD_FAILED, error),
            )
            .await;
            return;
        }
    };
    let progress_sender = sender.clone();
    let progress_id = id.clone();
    let result = super::download_model(variant, hf_token, move |percent, message| {
        send_detached(
            progress_sender.clone(),
            Response::setup_progress(&progress_id, "download_model", percent, message),
        );
    })
    .await;
    let response = match result {
        Ok(()) => Response::ok(
            &id,
            serde_json::json!({
                "type": "complete",
                "variant": variant.as_str(),
                "models_downloaded": super::get_env_info()
                    .downloaded_variants
                    .iter()
                    .map(|value| value.as_str())
                    .collect::<Vec<_>>(),
            }),
        ),
        Err(error) => Response::error(&id, error_codes::MUSCRIPTOR_MODEL_DOWNLOAD_FAILED, error),
    };
    send(&sender, response).await;
}

async fn start(
    id: String,
    variant: String,
    device: Option<String>,
    sender: WsSender,
    state: Arc<AppState>,
) {
    let variant = match super::validate_variant(&variant) {
        Ok(variant) => variant,
        Err(error) => {
            send(
                &sender,
                Response::error(&id, error_codes::MUSCRIPTOR_NOT_INSTALLED, error),
            )
            .await;
            return;
        }
    };
    send(
        &sender,
        Response::setup_progress(
            &id,
            "start_server",
            0.0,
            "Loading MuScriptor model into local sidecar...",
        ),
    )
    .await;
    let script = match super::ensure_server_script().await {
        Ok(script) => script,
        Err(error) => {
            send(
                &sender,
                Response::error(&id, error_codes::MUSCRIPTOR_NOT_INSTALLED, error),
            )
            .await;
            return;
        }
    };
    let model_path = match env::get_model_path(variant) {
        Ok(path) => path,
        Err(error) => {
            send(
                &sender,
                Response::error(&id, error_codes::MUSCRIPTOR_NOT_INSTALLED, error),
            )
            .await;
            return;
        }
    };
    let mut process = state.muscriptor_process.lock().await;
    let result = process
        .start(
            &super::get_venv_python(),
            &script,
            variant.as_str(),
            &model_path,
            device.as_deref(),
            &env::get_cache_path(),
        )
        .await;
    let response = match result {
        Ok(port) => Response::ok(
            &id,
            serde_json::json!({
                "type": "complete",
                "started": true,
                "port": port,
                "server_port": port,
                "active_variant": variant.as_str(),
                "active_device": process.device(),
            }),
        ),
        Err(error) => Response::error(&id, error_codes::MUSCRIPTOR_NOT_INSTALLED, error),
    };
    send(&sender, response).await;
}

async fn transcribe(
    id: String,
    audio_path: String,
    instruments: Option<Vec<String>>,
    sender: WsSender,
    state: Arc<AppState>,
) {
    let audio = Path::new(&audio_path);
    if !audio.is_absolute() || !state.is_path_allowed(audio) {
        send(
            &sender,
            Response::error(
                &id,
                error_codes::PERMISSION_DENIED,
                "MuScriptor audio_path must be inside an allowed root",
            ),
        )
        .await;
        return;
    }
    if !audio.is_file() {
        send(
            &sender,
            Response::error(
                &id,
                error_codes::FILE_NOT_FOUND,
                "MuScriptor audio file was not found",
            ),
        )
        .await;
        return;
    }
    let port = state.muscriptor_process.lock().await.port();
    if port == 0 {
        send(
            &sender,
            Response::error(
                &id,
                error_codes::MUSCRIPTOR_NOT_RUNNING,
                "MuScriptor sidecar is not running",
            ),
        )
        .await;
        return;
    }
    let progress_sender = sender.clone();
    let progress_id = id.clone();
    let result = inference::run_transcription(
        port,
        inference::TranscriptionRequest {
            audio_path,
            instruments,
        },
        move |progress| {
            send_detached(
                progress_sender.clone(),
                Response::ok(
                    &progress_id,
                    serde_json::json!({
                        "type": "progress",
                        "step": "transcribe",
                        "percent": progress.percent,
                        "job_id": progress.job_id,
                        "completed": progress.completed,
                        "total": progress.total,
                        "status": progress.status,
                    }),
                ),
            );
        },
    )
    .await;
    let response = match result {
        Ok(result) => Response::ok(
            &id,
            serde_json::json!({ "job_id": result.job_id, "notes": result.notes }),
        ),
        Err(error) => Response::error(&id, error_codes::MUSCRIPTOR_TRANSCRIPTION_FAILED, error),
    };
    send(&sender, response).await;
}

async fn cancel(id: String, job_id: String, sender: WsSender, state: Arc<AppState>) {
    let mut process = state.muscriptor_process.lock().await;
    let response = if process.port() == 0 {
        Response::error(
            &id,
            error_codes::MUSCRIPTOR_NOT_RUNNING,
            "MuScriptor sidecar is not running",
        )
    } else {
        // MuScriptor's generator can spend a long time inside one model chunk,
        // where a cooperative Python event cannot be observed. Terminating the
        // provider-owned sidecar is the only hard cancellation boundary. The
        // cached model and isolated environment remain intact; a later Start
        // command reloads them into a fresh process.
        match process.stop().await {
            Ok(()) => Response::ok(
                &id,
                serde_json::json!({
                    "cancelled": true,
                    "job_id": job_id,
                    "restart_required": true,
                }),
            ),
            Err(error) => Response::error(&id, error_codes::MUSCRIPTOR_TRANSCRIPTION_FAILED, error),
        }
    };
    send(&sender, response).await;
}
