// Source Monitor - displays raw media files (video/image) in the Preview panel
// Always uses HTML video backend for simplicity and reliability

import { useCallback, useEffect, useRef, useState } from 'react';
import { getShortcutRegistry } from '../../services/shortcutRegistry';
import type { MediaFile } from '../../stores/mediaStore';

interface SourceMonitorProps {
  file: MediaFile;
  onClose: () => void;
}

export function SourceMonitor({ file, onClose }: SourceMonitorProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scrubRef = useRef<HTMLDivElement>(null);

  const isVideo = file.type === 'video';
  const fps = file.fps || 30;

  const [backendReady, setBackendReady] = useState(false);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(file.duration || 0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const currentTimeRef = useRef(currentTime);

  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  useEffect(() => {
    queueMicrotask(() => {
      setBackendError(null);
      setBackendReady(false);
      setCurrentTime(0);
      setDuration(file.duration || 0);
      setIsPlaying(false);
    });
  }, [file.id, file.duration]);

  // HTML video event listeners
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isVideo) return;

    const onTimeUpdate = () => {
      if (!isScrubbing) {
        setCurrentTime(video.currentTime);
      }
    };
    const onLoadedMetadata = () => {
      setDuration(video.duration);
      setBackendReady(true);
      const restoreTime = currentTimeRef.current;
      if (restoreTime > 0.01) {
        video.currentTime = Math.min(restoreTime, video.duration || restoreTime);
      }
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);
    const onError = () => setBackendError('HTML preview failed to load');

    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onEnded);
    video.addEventListener('error', onError);

    setBackendReady(video.readyState >= 1);
    if (video.readyState >= 1) {
      setDuration(video.duration || file.duration || 0);
    }

    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('error', onError);
    };
  }, [file.duration, isScrubbing, isVideo]);

  // Cleanup on unmount
  useEffect(() => {
    const video = videoRef.current;
    return () => {
      if (video) {
        video.pause();
        video.src = '';
        video.load();
      }
    };
  }, []);

  const togglePlayback = useCallback(() => {
    if (!isVideo) return;
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play();
    } else {
      video.pause();
    }
  }, [isVideo]);

  // Keyboard handler: Space = play/pause, Escape = close
  // Uses capture phase + stopImmediatePropagation so timeline doesn't also play
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement;
      const isInput = active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active?.getAttribute('contenteditable') === 'true';
      if (isInput) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      } else if (getShortcutRegistry().matches('playback.playPause', e) && isVideo) {
        e.preventDefault();
        e.stopImmediatePropagation();
        togglePlayback();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isVideo, onClose, togglePlayback]);

  const seekSourceMonitor = useCallback((time: number, _precise: boolean) => {
    const clampedTime = Math.max(0, Math.min(duration || time, time));
    setCurrentTime(clampedTime);
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = clampedTime;
  }, [duration]);

  // Frame step
  const stepFrame = useCallback((direction: 1 | -1) => {
    const frameDuration = 1 / fps;
    seekSourceMonitor(currentTime + direction * frameDuration, true);
  }, [currentTime, fps, seekSourceMonitor]);

  // Go to start / end
  const goToStart = useCallback(() => {
    seekSourceMonitor(0, true);
  }, [seekSourceMonitor]);

  const goToEnd = useCallback(() => {
    seekSourceMonitor(duration, true);
  }, [duration, seekSourceMonitor]);

  // Scrub bar interaction
  const seekToPosition = useCallback((clientX: number, precise: boolean) => {
    const bar = scrubRef.current;
    if (!bar) return;

    const rect = bar.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    seekSourceMonitor(fraction * duration, precise);
  }, [duration, seekSourceMonitor]);

  const handleScrubMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsScrubbing(true);
    seekToPosition(e.clientX, false);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      seekToPosition(moveEvent.clientX, false);
    };

    const handleMouseUp = (upEvent: MouseEvent) => {
      setIsScrubbing(false);
      seekToPosition(upEvent.clientX, true);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [seekToPosition]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="source-monitor">
      <div className="source-monitor-media">
        {isVideo ? (
          <video
            ref={videoRef}
            src={file.url}
            className="source-monitor-video"
            onClick={togglePlayback}
            playsInline
          />
        ) : (
          <img
            src={file.url}
            alt={file.name}
            className="source-monitor-image"
          />
        )}
      </div>

      {isVideo && (
        <div className="source-monitor-toolbar">
          <div className="source-monitor-transport">
            <button className="btn btn-sm" onClick={goToStart} title="Go to start">
              Start
            </button>
            <button className="btn btn-sm" onClick={() => stepFrame(-1)} title="Previous frame">
              Prev
            </button>
            <button
              className={`btn btn-sm ${isPlaying ? 'btn-active' : ''}`}
              onClick={togglePlayback}
              title={isPlaying ? 'Pause [Space]' : 'Play [Space]'}
            >
              {isPlaying ? 'Pause' : 'Play'}
            </button>
            <button className="btn btn-sm" onClick={() => stepFrame(1)} title="Next frame">
              Next
            </button>
            <button className="btn btn-sm" onClick={goToEnd} title="Go to end">
              End
            </button>
          </div>

          <div className="source-monitor-timecode">
            <span className="timeline-time">{formatTimecode(currentTime, fps)}</span>
            <span className="source-monitor-time-sep">/</span>
            <span className="timeline-time">{formatTimecode(duration, fps)}</span>
          </div>

          <div className="source-monitor-scrub" onMouseDown={handleScrubMouseDown} ref={scrubRef}>
            <div className="source-monitor-scrub-track">
              <div className="source-monitor-scrub-fill" style={{ width: `${progress}%` }} />
              <div className="source-monitor-scrub-handle" style={{ left: `${progress}%` }} />
            </div>
          </div>

          <div className="source-monitor-status">
            {backendReady ? 'ready' : 'loading'}
            {backendError ? ` - ${backendError}` : ''}
          </div>
        </div>
      )}
    </div>
  );
}

function formatTimecode(seconds: number, fps: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const f = Math.floor((seconds % 1) * fps);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}:${f.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}:${f.toString().padStart(2, '0')}`;
}
