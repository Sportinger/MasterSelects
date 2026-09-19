//! Bounded browser-media queue with a reserved keyframe recovery slot.

use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use tokio::sync::mpsc;

use super::{MediaFrame, MediaKind};

const CHANNEL_CAPACITY: usize = 511;

#[derive(Default)]
pub(super) struct QueueStats {
    queued_bytes: AtomicU64,
    queued_messages: AtomicUsize,
    dropped_frames: AtomicU64,
}

impl QueueStats {
    pub(super) fn snapshot(&self) -> (u64, usize, u64) {
        (
            self.queued_bytes.load(Ordering::Relaxed),
            self.queued_messages.load(Ordering::Relaxed),
            self.dropped_frames.load(Ordering::Relaxed),
        )
    }

    pub(super) fn drop_frame(&self) {
        self.dropped_frames.fetch_add(1, Ordering::Relaxed);
    }

    fn added(&self, bytes: usize) {
        self.queued_bytes.fetch_add(bytes as u64, Ordering::Relaxed);
        self.queued_messages.fetch_add(1, Ordering::Relaxed);
    }

    fn removed(&self, bytes: usize) {
        let _ = self
            .queued_bytes
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |value| {
                Some(value.saturating_sub(bytes as u64))
            });
        let _ = self
            .queued_messages
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |value| {
                Some(value.saturating_sub(1))
            });
    }
}

#[derive(Clone)]
pub(super) struct MediaSender {
    tx: mpsc::Sender<MediaFrame>,
    pending_keyframe: Arc<Mutex<Option<MediaFrame>>>,
    stats: Arc<QueueStats>,
}

pub(super) struct MediaReceiver {
    rx: mpsc::Receiver<MediaFrame>,
    pending_keyframe: Arc<Mutex<Option<MediaFrame>>>,
    stats: Arc<QueueStats>,
    video_floor: Option<u32>,
}

pub(super) fn media_queue() -> (MediaSender, MediaReceiver, Arc<QueueStats>) {
    media_queue_with_capacity(CHANNEL_CAPACITY)
}

fn media_queue_with_capacity(capacity: usize) -> (MediaSender, MediaReceiver, Arc<QueueStats>) {
    let (tx, rx) = mpsc::channel(capacity);
    let pending_keyframe = Arc::new(Mutex::new(None));
    let stats = Arc::new(QueueStats::default());
    (
        MediaSender {
            tx,
            pending_keyframe: pending_keyframe.clone(),
            stats: stats.clone(),
        },
        MediaReceiver {
            rx,
            pending_keyframe,
            stats: stats.clone(),
            video_floor: None,
        },
        stats,
    )
}

impl MediaSender {
    pub(super) fn try_send(&self, frame: MediaFrame) {
        let payload_len = frame.payload.len();
        match self.tx.try_send(frame) {
            Ok(()) => self.stats.added(payload_len),
            Err(mpsc::error::TrySendError::Full(frame))
                if frame.kind == MediaKind::Video && frame.keyframe =>
            {
                let mut pending = self
                    .pending_keyframe
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                if let Some(replaced) = pending.replace(frame) {
                    self.stats.removed(replaced.payload.len());
                    self.stats.drop_frame();
                }
                self.stats.added(payload_len);
            }
            Err(mpsc::error::TrySendError::Full(_)) | Err(mpsc::error::TrySendError::Closed(_)) => {
                self.stats.drop_frame()
            }
        }
    }
}

impl MediaReceiver {
    pub(super) async fn recv(&mut self) -> Option<MediaFrame> {
        if let Some(frame) = self.take_pending_keyframe() {
            return Some(frame);
        }

        loop {
            let frame = self.rx.recv().await?;
            self.stats.removed(frame.payload.len());
            if self.is_stale_video(&frame) {
                self.stats.drop_frame();
                continue;
            }
            return Some(frame);
        }
    }

    fn take_pending_keyframe(&mut self) -> Option<MediaFrame> {
        let frame = self
            .pending_keyframe
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take();
        if let Some(ref frame) = frame {
            self.stats.removed(frame.payload.len());
            self.video_floor = Some(frame.timestamp_ms);
        }
        frame
    }

    fn is_stale_video(&self, frame: &MediaFrame) -> bool {
        frame.kind.is_video()
            && self.video_floor.is_some_and(|floor| {
                let delta = frame.timestamp_ms.wrapping_sub(floor);
                delta == 0 || delta > i32::MAX as u32
            })
    }
}

#[cfg(test)]
mod tests {
    use bytes::Bytes;

    use super::*;

    fn frame(timestamp_ms: u32, keyframe: bool) -> MediaFrame {
        MediaFrame {
            kind: MediaKind::Video,
            keyframe,
            timestamp_ms,
            payload: Bytes::from_static(&[1]),
        }
    }

    #[tokio::test]
    async fn full_queue_forces_keyframe_and_discards_stale_delta() {
        let (tx, mut rx, stats) = media_queue_with_capacity(2);
        tx.try_send(frame(1, false));
        tx.try_send(frame(2, false));
        tx.try_send(frame(3, false));
        tx.try_send(frame(4, true));

        assert!(rx.recv().await.unwrap().keyframe);
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(10), rx.recv())
                .await
                .is_err()
        );
        tx.try_send(frame(5, false));
        assert_eq!(rx.recv().await.unwrap().timestamp_ms, 5);
        assert_eq!(stats.snapshot(), (0, 0, 3));
    }
}
