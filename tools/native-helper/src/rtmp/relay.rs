//! RTMP handshake, client-session driving, and media publication.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{anyhow, Context, Result};
use bytes::Bytes;
use futures_util::SinkExt;
use rml_rtmp::handshake::{Handshake, HandshakeProcessResult, PeerType};
use rml_rtmp::sessions::{
    ClientSession, ClientSessionConfig, ClientSessionEvent, ClientSessionResult, PublishRequestType,
};
use rml_rtmp::time::RtmpTimestamp;
use tokio::io::{AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::tcp::OwnedWriteHalf;
use tokio::net::TcpStream;
use tokio::sync::watch;
use tokio::time::{interval, timeout, MissedTickBehavior};
use tokio_tungstenite::tungstenite::protocol::Message;
use tracing::{debug, error, info, trace};
use url::{Host, Url};

use crate::protocol::{Response, RtmpStatsEvent};

use super::flv::{audio_body, video_body};
use super::queue::{MediaReceiver, QueueStats};
use super::{MediaFrame, MediaKind, WsWrite};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
const WRITE_TIMEOUT: Duration = Duration::from_secs(8);

pub(super) struct RelayConfig {
    pub(super) id: String,
    pub(super) target: RtmpTarget,
    pub(super) stream_key: String,
}

pub(super) struct RtmpTarget {
    connect_host: String,
    display_host: String,
    port: u16,
    app: String,
    tc_url: String,
}

impl RtmpTarget {
    pub(super) fn parse(raw: &str) -> Result<Self, String> {
        let parsed = Url::parse(raw).map_err(|_| "Invalid RTMP target URL".to_string())?;
        if parsed.scheme() != "rtmp" {
            return Err("RTMP target URL must use the rtmp scheme".to_string());
        }
        if !parsed.username().is_empty() || parsed.password().is_some() {
            return Err("RTMP target URL must not contain credentials".to_string());
        }
        let host = parsed
            .host()
            .ok_or_else(|| "RTMP target URL must contain a host".to_string())?;
        let (connect_host, display_host) = match host {
            Host::Domain(value) => (value.to_string(), value.to_string()),
            Host::Ipv4(value) => (value.to_string(), value.to_string()),
            Host::Ipv6(value) => (value.to_string(), format!("[{value}]")),
        };
        let port = parsed.port().unwrap_or(1935);
        let app = parsed
            .path_segments()
            .and_then(|mut segments| segments.next())
            .filter(|segment| !segment.is_empty())
            .ok_or_else(|| "RTMP target URL must contain an application path".to_string())?
            .to_string();
        let tc_url = format!("rtmp://{display_host}:{port}/{app}");
        Ok(Self {
            connect_host,
            display_host,
            port,
            app,
            tc_url,
        })
    }
}

pub(super) async fn run(
    config: RelayConfig,
    receiver: MediaReceiver,
    queue_stats: Arc<QueueStats>,
    shutdown: watch::Receiver<bool>,
    ws: WsWrite,
) {
    let id = config.id.clone();
    let redaction_key = config.stream_key.clone();
    let stats = Arc::new(RelayStats {
        started_at: Instant::now(),
        sent_bytes: AtomicU64::new(0),
        queue: queue_stats,
    });
    let stats_task = tokio::spawn(report_stats(ws.clone(), id.clone(), stats.clone()));
    push_status(&ws, &id, "connecting", None).await;

    let result = run_inner(config, receiver, shutdown, ws.clone(), stats).await;
    stats_task.abort();
    let _ = stats_task.await;
    match result {
        Ok(()) => {
            info!("RTMP relay ended");
            push_status(&ws, &id, "ended", None).await;
        }
        Err(cause) => {
            let message = redact_secret(&format!("{cause:#}"), &redaction_key);
            error!(error = %message, "RTMP relay failed");
            push_status(&ws, &id, "error", Some(message)).await;
        }
    }
}

async fn run_inner(
    config: RelayConfig,
    mut receiver: MediaReceiver,
    mut shutdown: watch::Receiver<bool>,
    ws: WsWrite,
    stats: Arc<RelayStats>,
) -> Result<()> {
    let safe_host = redact_secret(&config.target.display_host, &config.stream_key);
    let safe_app = redact_secret(&config.target.app, &config.stream_key);
    info!(
        host = %safe_host,
        port = config.target.port,
        app = %safe_app,
        "Starting RTMP relay"
    );
    let connect_result = tokio::select! {
        result = timeout(
            CONNECT_TIMEOUT,
            TcpStream::connect((config.target.connect_host.as_str(), config.target.port)),
        ) => Some(result),
        _ = shutdown.changed() => None,
    };
    let Some(connect_result) = connect_result else {
        return Ok(());
    };
    let mut socket = connect_result
        .map_err(|_| anyhow!("RTMP TCP connection timed out"))?
        .with_context(|| {
            format!(
                "Could not connect to RTMP host {}:{}",
                config.target.display_host, config.target.port
            )
        })?;
    let handshake_result = tokio::select! {
        result = timeout(HANDSHAKE_TIMEOUT, perform_handshake(&mut socket, &stats)) => Some(result),
        _ = shutdown.changed() => None,
    };
    let Some(handshake_result) = handshake_result else {
        let _ = socket.shutdown().await;
        return Ok(());
    };
    let remaining = handshake_result.map_err(|_| anyhow!("RTMP handshake timed out"))??;
    push_status(&ws, &config.id, "connected", None).await;

    let (reader, writer) = socket.into_split();
    let mut session_config = ClientSessionConfig::new();
    session_config.chunk_size = 4096;
    session_config.tc_url = Some(config.target.tc_url.clone());
    let (session, initial_results) =
        ClientSession::new(session_config).context("Could not initialize RTMP client session")?;
    let mut publisher = Publisher {
        session,
        writer,
        stream_key: config.stream_key,
        id: config.id,
        ws,
        stats,
        publishing: false,
        video_config: None,
        audio_config: None,
        last_video_timestamp: None,
        last_audio_timestamp: None,
    };
    publisher.handle_results(initial_results).await?;
    let connect_request = publisher
        .session
        .request_connection(config.target.app)
        .context("Could not create RTMP connection request")?;
    publisher.handle_results(vec![connect_request]).await?;
    if !remaining.is_empty() {
        let results = publisher
            .session
            .handle_input(&remaining)
            .context("Could not process RTMP bytes following handshake")?;
        publisher.handle_results(results).await?;
    }

    let mut reader = reader;
    let mut read_buffer = vec![0_u8; 64 * 1024];
    loop {
        tokio::select! {
            changed = shutdown.changed() => {
                if changed.is_err() || *shutdown.borrow() {
                    publisher.graceful_shutdown().await;
                    return Ok(());
                }
            }
            read = reader.read(&mut read_buffer) => {
                let count = read.context("RTMP TCP read failed")?;
                if count == 0 {
                    return Err(anyhow!("RTMP server closed the connection"));
                }
                let results = publisher
                    .session
                    .handle_input(&read_buffer[..count])
                    .context("Could not process RTMP server response")?;
                publisher.handle_results(results).await?;
            }
            frame = receiver.recv(), if publisher.publishing => {
                match frame {
                    Some(frame) => publisher.publish_frame(frame).await?,
                    None => {
                        publisher.graceful_shutdown().await;
                        return Ok(());
                    }
                }
            }
        }
    }
}

async fn perform_handshake(socket: &mut TcpStream, stats: &RelayStats) -> Result<Vec<u8>> {
    let mut handshake = Handshake::new(PeerType::Client);
    let initial = handshake
        .generate_outbound_p0_and_p1()
        .context("Could not generate RTMP client handshake")?;
    write_all_timed(socket, &initial, stats).await?;
    let mut buffer = [0_u8; 4096];
    loop {
        let count = socket
            .read(&mut buffer)
            .await
            .context("RTMP handshake read failed")?;
        if count == 0 {
            return Err(anyhow!("RTMP server closed during handshake"));
        }
        match handshake
            .process_bytes(&buffer[..count])
            .context("RTMP handshake was rejected")?
        {
            HandshakeProcessResult::InProgress { response_bytes } => {
                write_all_timed(socket, &response_bytes, stats).await?;
            }
            HandshakeProcessResult::Completed {
                response_bytes,
                remaining_bytes,
            } => {
                write_all_timed(socket, &response_bytes, stats).await?;
                debug!("RTMP handshake completed");
                return Ok(remaining_bytes);
            }
        }
    }
}

struct Publisher {
    session: ClientSession,
    writer: OwnedWriteHalf,
    stream_key: String,
    id: String,
    ws: WsWrite,
    stats: Arc<RelayStats>,
    publishing: bool,
    video_config: Option<Bytes>,
    audio_config: Option<Bytes>,
    last_video_timestamp: Option<u32>,
    last_audio_timestamp: Option<u32>,
}

impl Publisher {
    async fn handle_results(&mut self, results: Vec<ClientSessionResult>) -> Result<()> {
        let mut pending = VecDeque::from(results);
        while let Some(result) = pending.pop_front() {
            match result {
                ClientSessionResult::OutboundResponse(packet) => {
                    write_all_timed(&mut self.writer, &packet.bytes, &self.stats).await?;
                }
                ClientSessionResult::RaisedEvent(event) => match event {
                    ClientSessionEvent::ConnectionRequestAccepted => {
                        let request = self
                            .session
                            .request_publishing(self.stream_key.clone(), PublishRequestType::Live)
                            .context("Could not create RTMP publish request")?;
                        pending.push_back(request);
                    }
                    ClientSessionEvent::ConnectionRequestRejected { description } => {
                        return Err(anyhow!("RTMP connection request rejected: {description}"));
                    }
                    ClientSessionEvent::PublishRequestAccepted => {
                        self.publishing = true;
                        info!("RTMP relay is publishing");
                        push_status(&self.ws, &self.id, "publishing", None).await;
                        self.publish_cached_configs().await?;
                    }
                    ClientSessionEvent::UnhandleableOnStatusCode { code }
                        if code.starts_with("NetStream.Publish.") =>
                    {
                        return Err(anyhow!("RTMP publish rejected ({code})"));
                    }
                    _ => trace!("Ignored RTMP client session event"),
                },
                ClientSessionResult::UnhandleableMessageReceived(_) => {
                    trace!("Ignored unhandleable RTMP message");
                }
            }
        }
        Ok(())
    }

    async fn publish_cached_configs(&mut self) -> Result<()> {
        if let Some(config) = self.video_config.clone() {
            self.send_video(config, 0, true, true).await?;
        }
        if let Some(config) = self.audio_config.clone() {
            self.send_audio(config, 0, true).await?;
        }
        Ok(())
    }

    async fn publish_frame(&mut self, frame: MediaFrame) -> Result<()> {
        match frame.kind {
            MediaKind::VideoConfig => {
                self.video_config = Some(frame.payload.clone());
                self.send_video(frame.payload, 0, true, true).await
            }
            MediaKind::AudioConfig => {
                self.audio_config = Some(frame.payload.clone());
                self.send_audio(frame.payload, 0, true).await
            }
            MediaKind::Video => {
                if self.video_config.is_none() {
                    self.stats.queue.drop_frame();
                    return Ok(());
                }
                let timestamp =
                    monotonic_timestamp(&mut self.last_video_timestamp, frame.timestamp_ms);
                self.send_video(frame.payload, timestamp, frame.keyframe, false)
                    .await
            }
            MediaKind::Audio => {
                if self.audio_config.is_none() {
                    self.stats.queue.drop_frame();
                    return Ok(());
                }
                let timestamp =
                    monotonic_timestamp(&mut self.last_audio_timestamp, frame.timestamp_ms);
                self.send_audio(frame.payload, timestamp, false).await
            }
        }
    }

    async fn send_video(
        &mut self,
        payload: Bytes,
        timestamp: u32,
        keyframe: bool,
        sequence_header: bool,
    ) -> Result<()> {
        let result = self
            .session
            .publish_video_data(
                video_body(&payload, keyframe, sequence_header),
                RtmpTimestamp::new(timestamp),
                !keyframe,
            )
            .context("Could not serialize RTMP video data")?;
        self.write_publish_result(result).await
    }

    async fn send_audio(
        &mut self,
        payload: Bytes,
        timestamp: u32,
        sequence_header: bool,
    ) -> Result<()> {
        let result = self
            .session
            .publish_audio_data(
                audio_body(&payload, sequence_header),
                RtmpTimestamp::new(timestamp),
                false,
            )
            .context("Could not serialize RTMP audio data")?;
        self.write_publish_result(result).await
    }

    async fn write_publish_result(&mut self, result: ClientSessionResult) -> Result<()> {
        match result {
            ClientSessionResult::OutboundResponse(packet) => {
                write_all_timed(&mut self.writer, &packet.bytes, &self.stats).await
            }
            _ => Err(anyhow!(
                "RTMP publish produced an unexpected session result"
            )),
        }
    }

    async fn graceful_shutdown(&mut self) {
        if let Ok(results) = self.session.stop_publishing() {
            for result in results {
                if let ClientSessionResult::OutboundResponse(packet) = result {
                    let _ = write_all_timed(&mut self.writer, &packet.bytes, &self.stats).await;
                }
            }
        }
        let _ = timeout(Duration::from_secs(1), self.writer.shutdown()).await;
    }
}

fn monotonic_timestamp(last: &mut Option<u32>, received: u32) -> u32 {
    let timestamp = match *last {
        Some(previous)
            if received.wrapping_sub(previous) == 0
                || received.wrapping_sub(previous) > i32::MAX as u32 =>
        {
            previous.wrapping_add(1)
        }
        _ => received,
    };
    *last = Some(timestamp);
    timestamp
}

async fn write_all_timed<W: AsyncWrite + Unpin>(
    writer: &mut W,
    bytes: &[u8],
    stats: &RelayStats,
) -> Result<()> {
    if bytes.is_empty() {
        return Ok(());
    }
    timeout(WRITE_TIMEOUT, writer.write_all(bytes))
        .await
        .map_err(|_| anyhow!("RTMP TCP write stalled for more than 8 seconds"))?
        .context("RTMP TCP write failed")?;
    stats
        .sent_bytes
        .fetch_add(bytes.len() as u64, Ordering::Relaxed);
    Ok(())
}

struct RelayStats {
    started_at: Instant,
    sent_bytes: AtomicU64,
    queue: Arc<QueueStats>,
}

async fn report_stats(ws: WsWrite, id: String, stats: Arc<RelayStats>) {
    let mut tick = interval(Duration::from_secs(1));
    tick.set_missed_tick_behavior(MissedTickBehavior::Delay);
    tick.tick().await;
    loop {
        tick.tick().await;
        let (queued_bytes, queued_messages, dropped_frames) = stats.queue.snapshot();
        let event = RtmpStatsEvent {
            event_type: "rtmp-stats",
            sent_bytes: stats.sent_bytes.load(Ordering::Relaxed),
            queued_bytes,
            queued_messages,
            uptime_ms: stats.started_at.elapsed().as_millis() as u64,
            dropped_frames,
        };
        push_response(&ws, Response::rtmp_stats(&id, event)).await;
    }
}

async fn push_status(ws: &WsWrite, id: &str, state: &'static str, message: Option<String>) {
    push_response(ws, Response::rtmp_status(id, state, message)).await;
}

async fn push_response(ws: &WsWrite, response: Response) {
    let Ok(json) = serde_json::to_string(&response) else {
        return;
    };
    let mut writer = ws.lock().await;
    if writer.send(Message::Text(json)).await.is_err() {
        debug!("Could not push RTMP event because the WebSocket is closed");
    }
}

fn redact_secret(message: &str, secret: &str) -> String {
    if secret.is_empty() {
        message.to_string()
    } else {
        message.replace(secret, "[REDACTED]")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_default_port_and_ignores_subpath() {
        let target = RtmpTarget::parse("rtmp://example.com/live/ignored").unwrap();
        assert_eq!(target.connect_host, "example.com");
        assert_eq!(target.port, 1935);
        assert_eq!(target.app, "live");
        assert_eq!(target.tc_url, "rtmp://example.com:1935/live");
    }

    #[test]
    fn parses_custom_port_and_ipv6() {
        let target = RtmpTarget::parse("rtmp://[::1]:1940/app").unwrap();
        assert_eq!(target.connect_host, "::1");
        assert_eq!(target.tc_url, "rtmp://[::1]:1940/app");
    }

    #[test]
    fn rejects_missing_app_and_wrong_scheme() {
        assert!(RtmpTarget::parse("rtmp://example.com").is_err());
        assert!(RtmpTarget::parse("https://example.com/live").is_err());
    }

    #[test]
    fn clamps_timestamp_regressions() {
        let mut last = None;
        assert_eq!(monotonic_timestamp(&mut last, 10), 10);
        assert_eq!(monotonic_timestamp(&mut last, 8), 11);
        assert_eq!(monotonic_timestamp(&mut last, 11), 12);
    }

    #[test]
    fn accepts_timestamp_wraparound_as_forward_progress() {
        let mut last = Some(u32::MAX - 1);
        assert_eq!(monotonic_timestamp(&mut last, 1), 1);
    }

    #[test]
    fn redacts_stream_key_from_errors() {
        assert_eq!(
            redact_secret("publish secret-key rejected", "secret-key"),
            "publish [REDACTED] rejected"
        );
    }
}
