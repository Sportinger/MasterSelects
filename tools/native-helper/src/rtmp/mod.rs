//! Per-WebSocket RTMP relay entry points and browser media framing.

mod flv;
mod queue;
mod relay;

use std::sync::Arc;

use bytes::Bytes;
use futures_util::stream::SplitSink;
use tokio::net::TcpStream;
use tokio::sync::{watch, Mutex};
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::protocol::Message;
use tokio_tungstenite::WebSocketStream;

use crate::protocol::{error_codes, Command, Response, RtmpAudioConfig, RtmpVideoConfig};

use queue::{media_queue, MediaSender};

pub(crate) type WsWrite = Arc<Mutex<SplitSink<WebSocketStream<TcpStream>, Message>>>;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum MediaKind {
    VideoConfig,
    AudioConfig,
    Video,
    Audio,
}

impl MediaKind {
    fn from_byte(value: u8) -> Option<Self> {
        match value {
            1 => Some(Self::VideoConfig),
            2 => Some(Self::AudioConfig),
            3 => Some(Self::Video),
            4 => Some(Self::Audio),
            _ => None,
        }
    }

    pub(super) fn is_video(self) -> bool {
        self == Self::Video
    }
}

pub(crate) struct MediaFrame {
    kind: MediaKind,
    keyframe: bool,
    timestamp_ms: u32,
    payload: Bytes,
}

impl MediaFrame {
    fn parse(message: &[u8]) -> Result<Self, &'static str> {
        if message.len() < 12 {
            return Err("RTMP media frame is shorter than its 12-byte header");
        }
        let kind = MediaKind::from_byte(message[0]).ok_or("Unknown RTMP media frame kind")?;
        let timestamp_us = u64::from_le_bytes(
            message[4..12]
                .try_into()
                .map_err(|_| "Invalid RTMP media timestamp")?,
        );
        Ok(Self {
            kind,
            keyframe: message[1] & 1 != 0,
            timestamp_ms: (timestamp_us / 1_000) as u32,
            payload: Bytes::copy_from_slice(&message[12..]),
        })
    }
}

pub(crate) struct RelayHandle {
    media: MediaSender,
    shutdown: watch::Sender<bool>,
    task: JoinHandle<()>,
}

impl RelayHandle {
    pub(crate) fn start(
        id: String,
        url: String,
        stream_key: String,
        video: RtmpVideoConfig,
        audio: RtmpAudioConfig,
        ws: WsWrite,
    ) -> Result<Self, String> {
        validate_encoding_config(&video, &audio)?;
        if stream_key.is_empty() {
            return Err("RTMP stream key must not be empty".to_string());
        }
        let target = relay::RtmpTarget::parse(&url)?;
        let (media, receiver, queue_stats) = media_queue();
        let (shutdown, shutdown_rx) = watch::channel(false);
        let task = tokio::spawn(relay::run(
            relay::RelayConfig {
                id,
                target,
                stream_key,
            },
            receiver,
            queue_stats,
            shutdown_rx,
            ws,
        ));
        Ok(Self {
            media,
            shutdown,
            task,
        })
    }

    pub(crate) fn send_binary(&self, message: &[u8]) -> Result<(), &'static str> {
        self.media.try_send(MediaFrame::parse(message)?);
        Ok(())
    }

    pub(crate) fn is_finished(&self) -> bool {
        self.task.is_finished()
    }

    pub(crate) async fn stop(self) {
        let _ = self.shutdown.send(true);
        let mut task = self.task;
        if tokio::time::timeout(std::time::Duration::from_secs(10), &mut task)
            .await
            .is_err()
        {
            task.abort();
            let _ = task.await;
        }
    }
}

pub(crate) async fn dispatch(
    command: Command,
    active: &mut Option<RelayHandle>,
    ws: WsWrite,
) -> Response {
    match command {
        Command::RtmpStart {
            id,
            url,
            stream_key,
            video,
            audio,
        } => {
            if active.is_some() {
                return Response::error(
                    id,
                    error_codes::RTMP_ALREADY_ACTIVE,
                    "An RTMP relay is already active on this connection",
                );
            }
            match RelayHandle::start(id.clone(), url, stream_key, video, audio, ws) {
                Ok(handle) => {
                    *active = Some(handle);
                    Response::ok(id, serde_json::json!({"started": true}))
                }
                Err(message) => Response::error(id, error_codes::RTMP_INVALID_TARGET, message),
            }
        }
        Command::RtmpStop { id } => match active.take() {
            Some(handle) => {
                handle.stop().await;
                Response::ok(id, serde_json::json!({"stopped": true}))
            }
            None => Response::error(
                id,
                error_codes::RTMP_NOT_ACTIVE,
                "No RTMP relay is active on this connection",
            ),
        },
        _ => unreachable!("non-RTMP command passed to RTMP dispatcher"),
    }
}

fn validate_encoding_config(
    video: &RtmpVideoConfig,
    audio: &RtmpAudioConfig,
) -> Result<(), String> {
    if video.width == 0
        || video.height == 0
        || !video.fps.is_finite()
        || video.fps <= 0.0
        || video.bitrate_kbps == 0
    {
        return Err("Invalid RTMP video encoding configuration".to_string());
    }
    if audio.sample_rate == 0 || audio.channels == 0 || audio.bitrate_kbps == 0 {
        return Err("Invalid RTMP audio encoding configuration".to_string());
    }
    Ok(())
}
