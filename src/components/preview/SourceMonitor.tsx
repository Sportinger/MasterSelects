// Source Monitor - previews raw media files before timeline placement.

import './SourceMonitor.css';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import {
  IconCrop,
  IconFlag,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconPlayerStopFilled,
  IconX,
} from '@tabler/icons-react';
import { getShortcutRegistry } from '../../services/shortcutRegistry';
import { getAudioWaveformStatus, getSourceWaveformChannels, drawSourceAudioWaveformCanvas } from './sourceAudioWaveform';
import {
  clearTimelinePlacementCommandPreview,
  runTimelinePlacementCommand,
} from '../../services/timelinePlacementCommands';
import { useMediaStore, type MediaFile } from '../../stores/mediaStore';
import { startMediaFileWaveformGeneration } from '../../stores/mediaStore/helpers/mediaWaveformHelpers';
import type { TimelinePlacementMode } from '../../stores/timeline/editOperations/types';
import { SourceMonitorImageCrop } from './sourceMonitor/SourceMonitorImageCrop';
import { SourceMonitorPlacementCommands } from './sourceMonitor/SourceMonitorPlacementCommands';
import { useSourceMonitorImageCrop } from './sourceMonitor/useSourceMonitorImageCrop';
import {
  clampTime,
  createTimelineTicks,
  DEFAULT_STILL_DURATION,
  formatTimecode,
  MIN_MARK_GAP_SECONDS,
  normalizeDuration,
} from './sourceMonitor/sourceMonitorTimecode';

const SOURCE_MONITOR_MAX_ZOOM = 128;
const IMAGE_SOURCE_MONITOR_ZOOM_STEP = 0.001;

interface SourceMonitorProps {
  file: MediaFile;
  autoplayRequestId?: number;
  onClose: () => void;
}

type SourceTimelineDragKind = 'playhead' | 'in' | 'out';

interface SourceViewportState {
  fileId: string;
  panX: number;
  panY: number;
  zoom: number;
}

function getNextSourceZoom(current: number, deltaY: number): number {
  return Math.max(1, Math.min(SOURCE_MONITOR_MAX_ZOOM, current * Math.exp(-deltaY * IMAGE_SOURCE_MONITOR_ZOOM_STEP)));
}

function getDefaultSourceViewport(fileId: string): SourceViewportState {
  return { fileId, panX: 0, panY: 0, zoom: 1 };
}

function updateMediaFileWaveformCache(
  id: string,
  updates: Partial<Pick<MediaFile, 'audioAnalysisRefs' | 'waveform' | 'waveformChannels' | 'waveformProgress' | 'waveformStatus'>>,
): void {
  useMediaStore.setState((state) => ({
    files: state.files.map((entry) => (
      entry.id === id
        ? { ...entry, ...updates }
        : entry
    )),
  }));
}

export function SourceMonitor({ file, autoplayRequestId = 0, onClose }: SourceMonitorProps) {
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const audioWaveformRef = useRef<HTMLDivElement>(null);
  const audioWaveformCanvasRef = useRef<HTMLCanvasElement>(null);
  const sourcePanDragRef = useRef<{
    fileId: string;
    startPanX: number;
    startPanY: number;
    startX: number;
    startY: number;
    zoom: number;
  } | null>(null);

  const isVideo = file.type === 'video';
  const isAudio = file.type === 'audio';
  const isImage = file.type === 'image';
  const isPlayable = isVideo || isAudio;
  const fps = file.fps || 30;

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(normalizeDuration(file.duration, isImage ? DEFAULT_STILL_DURATION : 0));
  const [isPlaying, setIsPlaying] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [sourceViewportState, setSourceViewportState] = useState(() => getDefaultSourceViewport(file.id));
  const [pendingPlacementMode, setPendingPlacementMode] = useState<TimelinePlacementMode | null>(null);
  const inPoint = useMediaStore(state => state.sourceMonitorInPoint);
  const outPoint = useMediaStore(state => state.sourceMonitorOutPoint);
  const setSourceMonitorInPoint = useMediaStore(state => state.setSourceMonitorInPoint);
  const setSourceMonitorOutPoint = useMediaStore(state => state.setSourceMonitorOutPoint);
  const clearSourceMonitorInOut = useMediaStore(state => state.clearSourceMonitorInOut);
  const currentTimeRef = useRef(currentTime);
  const imageCrop = useSourceMonitorImageCrop(file, isImage);
  const sourceViewport = sourceViewportState.fileId === file.id
    ? sourceViewportState
    : getDefaultSourceViewport(file.id);
  const sourceViewportStyle = { transform: `translate(${sourceViewport.panX}px, ${sourceViewport.panY}px) scale(${sourceViewport.zoom})` };
  const timelineDuration = normalizeDuration(duration, normalizeDuration(file.duration, isImage ? DEFAULT_STILL_DURATION : 0));
  const effectiveInPoint = clampTime(inPoint ?? 0, timelineDuration);
  const effectiveOutPoint = clampTime(outPoint ?? timelineDuration, timelineDuration);
  const hasMarkedRange = timelineDuration > 0 && (inPoint !== null || outPoint !== null) && effectiveOutPoint > effectiveInPoint;
  const progress = timelineDuration > 0 ? (clampTime(currentTime, timelineDuration) / timelineDuration) * 100 : 0;
  const rangeLeft = timelineDuration > 0 ? (effectiveInPoint / timelineDuration) * 100 : 0;
  const rangeRight = timelineDuration > 0 ? (effectiveOutPoint / timelineDuration) * 100 : 100;
  const rangeWidth = Math.max(0, rangeRight - rangeLeft);
  const markedDuration = timelineDuration > 0
    ? Math.max(0, effectiveOutPoint - effectiveInPoint)
    : 0;
  const showSourceTimingControls = !isImage && timelineDuration > 0;
  const timelineTicks = useMemo(() => createTimelineTicks(timelineDuration, fps), [fps, timelineDuration]);
  const audioWaveformStatus = useMemo(
    () => getAudioWaveformStatus(file, isAudio),
    [file, isAudio],
  );
  const audioWaveformChannels = useMemo(
    () => getSourceWaveformChannels(file),
    [file],
  );

  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  useEffect(() => {
    if (!isAudio || (file.waveform?.length ?? 0) > 0) return;
    startMediaFileWaveformGeneration(
      file,
      updateMediaFileWaveformCache,
      (id) => useMediaStore.getState().files.find((entry) => entry.id === id),
    );
  }, [file, isAudio]);

  useEffect(() => {
    if (!isAudio) return undefined;

    const canvas = audioWaveformCanvasRef.current;
    const container = audioWaveformRef.current;
    if (!canvas || !container) return undefined;

    let frameId = 0;
    let debounceTimer = 0;
    const render = () => {
      frameId = 0;
      drawSourceAudioWaveformCanvas(canvas, audioWaveformChannels, audioWaveformStatus);
    };
    const scheduleRender = () => {
      if (frameId) window.cancelAnimationFrame(frameId);
      if (typeof window.requestAnimationFrame === 'function') {
        frameId = window.requestAnimationFrame(render);
      } else {
        render();
      }
    };
    // Resize fires every frame of a view-switch animation; debounce so the
    // expensive waveform repaints once after the transition settles instead of
    // stuttering through it (the canvas just stretches smoothly meanwhile).
    const scheduleDebouncedRender = () => {
      if (debounceTimer) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(scheduleRender, 140);
    };

    scheduleRender();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(scheduleDebouncedRender);
      observer.observe(container);
      return () => {
        if (frameId) window.cancelAnimationFrame(frameId);
        if (debounceTimer) window.clearTimeout(debounceTimer);
        observer.disconnect();
      };
    }

    window.addEventListener('resize', scheduleDebouncedRender);
    return () => {
      if (frameId) window.cancelAnimationFrame(frameId);
      if (debounceTimer) window.clearTimeout(debounceTimer);
      window.removeEventListener('resize', scheduleDebouncedRender);
    };
  }, [audioWaveformChannels, audioWaveformStatus, isAudio]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      currentTimeRef.current = 0;
      setCurrentTime(0);
      setDuration(normalizeDuration(file.duration, file.type === 'image' ? DEFAULT_STILL_DURATION : 0));
      setIsPlaying(false);
    });
    return () => {
      cancelled = true;
    };
  }, [file.duration, file.id, file.type]);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media || !isPlayable) return undefined;
    let disposed = false;

    const onTimeUpdate = () => {
      const nextTime = media.currentTime;
      if (!media.paused && outPoint !== null && nextTime >= outPoint - 0.015) {
        media.pause();
        media.currentTime = outPoint;
        currentTimeRef.current = outPoint;
        setCurrentTime(outPoint);
        return;
      }
      if (!isScrubbing) {
        currentTimeRef.current = nextTime;
        setCurrentTime(nextTime);
      }
    };
    const onLoadedMetadata = () => {
      const mediaDuration = normalizeDuration(media.duration, file.duration || 0);
      setDuration(mediaDuration);
      const restoreTime = currentTimeRef.current;
      if (restoreTime > 0.01) {
        media.currentTime = Math.min(restoreTime, mediaDuration || restoreTime);
      }
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);

    media.addEventListener('timeupdate', onTimeUpdate);
    media.addEventListener('loadedmetadata', onLoadedMetadata);
    media.addEventListener('play', onPlay);
    media.addEventListener('pause', onPause);
    media.addEventListener('ended', onEnded);
    if (media.readyState >= 1) {
      queueMicrotask(() => {
        if (disposed) return;
        setDuration(normalizeDuration(media.duration, file.duration || 0));
      });
    }

    return () => {
      disposed = true;
      media.removeEventListener('timeupdate', onTimeUpdate);
      media.removeEventListener('loadedmetadata', onLoadedMetadata);
      media.removeEventListener('play', onPlay);
      media.removeEventListener('pause', onPause);
      media.removeEventListener('ended', onEnded);
    };
  }, [file.duration, isPlayable, isScrubbing, outPoint]);

  useEffect(() => {
    if (!isPlayable || !isPlaying || isScrubbing) return undefined;

    let frameId = 0;
    const updatePlayhead = () => {
      const media = mediaRef.current;
      if (!media) return;

      const nextTime = media.currentTime;
      if (!media.paused && outPoint !== null && nextTime >= outPoint - 0.015) {
        media.pause();
        media.currentTime = outPoint;
        currentTimeRef.current = outPoint;
        setCurrentTime(outPoint);
        return;
      }

      currentTimeRef.current = nextTime;
      setCurrentTime(nextTime);
      frameId = window.requestAnimationFrame(updatePlayhead);
    };

    frameId = window.requestAnimationFrame(updatePlayhead);
    return () => window.cancelAnimationFrame(frameId);
  }, [isPlayable, isPlaying, isScrubbing, outPoint]);

  // On a same-type switch (audio→audio / video→video) the same media element is
  // reused, so changing `src` alone doesn't reload it — explicitly reload the new
  // source. (Must NOT strip the src here, or the freshly selected file can't play
  // until the monitor is reopened.)
  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;
    media.pause();
    media.load();
  }, [file.id]);

  // Release the media element only when the source monitor actually closes.
  useEffect(() => {
    const media = mediaRef.current;
    return () => {
      if (!media) return;
      media.pause();
      media.removeAttribute('src');
      media.load();
    };
  }, []);

  const seekSourceMonitor = useCallback((time: number) => {
    const clampedTime = clampTime(time, timelineDuration || time);
    currentTimeRef.current = clampedTime;
    setCurrentTime(clampedTime);
    const media = mediaRef.current;
    if (!media) return;
    media.currentTime = clampedTime;
  }, [timelineDuration]);

  const playSource = useCallback(() => {
    if (!isPlayable) return;
    const media = mediaRef.current;
    if (!media) return;
    const playbackStart = inPoint ?? 0;
    const playbackEnd = outPoint ?? timelineDuration;
    const needsRewind =
      media.ended ||
      media.currentTime >= playbackEnd - MIN_MARK_GAP_SECONDS ||
      media.currentTime < playbackStart - MIN_MARK_GAP_SECONDS;
    if (needsRewind) {
      // Rewind to the marked start. An *ended* <audio> element must be reset
      // before play() or it stays ended and play() is a no-op — which is why
      // audio only played once (Stop+Play worked because Stop reset it). (#203)
      const start = clampTime(playbackStart, timelineDuration);
      media.currentTime = start;
      currentTimeRef.current = start;
      setCurrentTime(start);
    }
    void media.play().catch(() => {
      // Last resort if the element refuses to restart: reload and retry once.
      try {
        media.load();
        media.currentTime = clampTime(playbackStart, timelineDuration);
        void media.play();
      } catch {
        /* ignore */
      }
    });
  }, [inPoint, isPlayable, outPoint, timelineDuration]);

  const pauseSource = useCallback(() => {
    if (!isPlayable) return;
    mediaRef.current?.pause();
  }, [isPlayable]);

  const stopSource = useCallback(() => {
    if (!isPlayable) return;
    const media = mediaRef.current;
    if (!media) return;
    media.pause();
    seekSourceMonitor(inPoint ?? 0);
  }, [inPoint, isPlayable, seekSourceMonitor]);

  const togglePlayback = useCallback(() => {
    const media = mediaRef.current;
    if (!isPlayable || !media) return;
    if (media.paused) {
      playSource();
    } else {
      pauseSource();
    }
  }, [isPlayable, pauseSource, playSource]);

  useEffect(() => {
    if (!isPlayable) return undefined;
    const media = mediaRef.current;
    if (!media) return undefined;

    let cancelled = false;
    const playWhenReady = () => {
      if (cancelled) return;
      void media.play().catch(() => {
        // Browser policies can still block autoplay; the explicit Play button remains available.
      });
    };

    if (media.readyState >= 2) {
      playWhenReady();
    } else {
      media.addEventListener('canplay', playWhenReady, { once: true });
    }

    return () => {
      cancelled = true;
      media.removeEventListener('canplay', playWhenReady);
    };
  }, [autoplayRequestId, file.id, isPlayable]);

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
      } else if (getShortcutRegistry().matches('playback.playPause', e) && isPlayable) {
        e.preventDefault();
        e.stopImmediatePropagation();
        togglePlayback();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isPlayable, onClose, togglePlayback]);

  const getTimeFromElementClientX = useCallback((element: HTMLElement | null, clientX: number) => {
    if (!element || timelineDuration <= 0) return 0;
    const rect = element.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
    return fraction * timelineDuration;
  }, [timelineDuration]);

  const updateTimelineDrag = useCallback((kind: SourceTimelineDragKind, clientX: number) => {
    const time = getTimeFromElementClientX(timelineRef.current, clientX);
    if (kind === 'in') {
      setSourceMonitorInPoint(Math.min(time, Math.max(0, effectiveOutPoint - MIN_MARK_GAP_SECONDS)));
      return;
    }
    if (kind === 'out') {
      setSourceMonitorOutPoint(Math.max(time, effectiveInPoint + MIN_MARK_GAP_SECONDS));
      return;
    }
    seekSourceMonitor(time);
  }, [
    effectiveInPoint,
    effectiveOutPoint,
    getTimeFromElementClientX,
    seekSourceMonitor,
    setSourceMonitorInPoint,
    setSourceMonitorOutPoint,
  ]);

  const startAudioWaveformDrag = useCallback((event: ReactPointerEvent) => {
    if (timelineDuration <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    setIsScrubbing(true);
    seekSourceMonitor(getTimeFromElementClientX(audioWaveformRef.current, event.clientX));

    const handlePointerMove = (moveEvent: PointerEvent) => {
      seekSourceMonitor(getTimeFromElementClientX(audioWaveformRef.current, moveEvent.clientX));
    };
    const handlePointerUp = (upEvent: PointerEvent) => {
      seekSourceMonitor(getTimeFromElementClientX(audioWaveformRef.current, upEvent.clientX));
      setIsScrubbing(false);
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
  }, [getTimeFromElementClientX, seekSourceMonitor, timelineDuration]);

  const startTimelineDrag = useCallback((kind: SourceTimelineDragKind, event: ReactPointerEvent) => {
    if (timelineDuration <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    setIsScrubbing(kind === 'playhead');
    updateTimelineDrag(kind, event.clientX);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      updateTimelineDrag(kind, moveEvent.clientX);
    };
    const handlePointerUp = (upEvent: PointerEvent) => {
      updateTimelineDrag(kind, upEvent.clientX);
      setIsScrubbing(false);
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
  }, [timelineDuration, updateTimelineDrag]);

  const runSourcePlacementCommand = useCallback((mode: TimelinePlacementMode) => {
    if (pendingPlacementMode !== null) return;
    clearTimelinePlacementCommandPreview(mode);
    setPendingPlacementMode(mode);
    void runTimelinePlacementCommand(mode).finally(() => {
      setPendingPlacementMode(null);
    });
  }, [pendingPlacementMode]);

  const handleSourceWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    if (!isVideo && (!isImage || imageCrop.cropMode)) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const mouseX = event.clientX - rect.left - rect.width / 2;
    const mouseY = event.clientY - rect.top - rect.height / 2;
    setSourceViewportState((current) => {
      const base = current.fileId === file.id ? current : getDefaultSourceViewport(file.id);
      const zoom = getNextSourceZoom(base.zoom, event.deltaY);
      if (zoom === 1) return getDefaultSourceViewport(file.id);
      const scale = zoom / base.zoom;
      return {
        fileId: file.id,
        panX: mouseX - scale * (mouseX - base.panX),
        panY: mouseY - scale * (mouseY - base.panY),
        zoom,
      };
    });
  }, [file.id, imageCrop.cropMode, isImage, isVideo]);

  const startSourcePan = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if ((!isVideo && (!isImage || imageCrop.cropMode)) || event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    sourcePanDragRef.current = {
      fileId: file.id,
      startPanX: sourceViewport.panX,
      startPanY: sourceViewport.panY,
      startX: event.clientX,
      startY: event.clientY,
      zoom: sourceViewport.zoom,
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const drag = sourcePanDragRef.current;
      if (!drag) return;
      setSourceViewportState({
        fileId: drag.fileId,
        panX: drag.startPanX + moveEvent.clientX - drag.startX,
        panY: drag.startPanY + moveEvent.clientY - drag.startY,
        zoom: drag.zoom,
      });
    };
    const handlePointerUp = () => {
      sourcePanDragRef.current = null;
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
  }, [file.id, imageCrop.cropMode, isImage, isVideo, sourceViewport.panX, sourceViewport.panY, sourceViewport.zoom]);

  return (
    <div className="source-monitor">
      <div
        className="source-monitor-media"
        onWheel={handleSourceWheel}
        onPointerDown={startSourcePan}
        onAuxClick={(event) => {
          if ((isImage || isVideo) && event.button === 1) event.preventDefault();
        }}
      >
        {isVideo ? (
          <video
            ref={(node) => { mediaRef.current = node; }}
            src={file.url}
            className="source-monitor-video"
            style={sourceViewportStyle}
            onClick={togglePlayback}
            autoPlay
            playsInline
          />
        ) : isAudio ? (
          <>
            <audio
              ref={(node) => { mediaRef.current = node; }}
              src={file.url}
              className="source-monitor-audio-element"
              preload="metadata"
              aria-label="Audio source player"
            />
            <div className="source-monitor-audio-editor">
              <div
                ref={audioWaveformRef}
                className={`source-monitor-audio-waveform status-${audioWaveformStatus}`}
                aria-label="Audio waveform"
                onPointerDown={startAudioWaveformDrag}
              >
                <canvas
                  ref={audioWaveformCanvasRef}
                  className="source-monitor-audio-waveform-canvas"
                  aria-hidden="true"
                />
                <div className="source-monitor-audio-db-grid" aria-hidden="true">
                  <span style={{ top: '12.5%' }} />
                  <span style={{ top: '25%' }} />
                  <span style={{ top: '37.5%' }} />
                  <span style={{ top: '62.5%' }} />
                  <span style={{ top: '75%' }} />
                  <span style={{ top: '87.5%' }} />
                </div>
                <div
                  className="source-monitor-audio-waveform-range"
                  style={{ left: `${rangeLeft}%`, width: `${rangeWidth}%` }}
                />
                <div className="source-monitor-audio-waveform-playhead" style={{ left: `${progress}%` }} />
                {(['L', 'R'] as const).map((channel) => (
                  <div className="source-monitor-audio-channel" key={channel}>
                    <span className="source-monitor-audio-channel-label">{channel}</span>
                  </div>
                ))}
                <div className="source-monitor-audio-file-name" title={file.name}>
                  {file.name}
                </div>
              </div>
            </div>
          </>
        ) : isImage && imageCrop.cropMode ? (
          <SourceMonitorImageCrop
            key={file.id}
            file={file}
            busy={imageCrop.cropBusy}
            error={imageCrop.cropError}
            onApply={imageCrop.applyImageCrop}
            onCancel={imageCrop.cancelImageCrop}
          />
        ) : (
          <img
            src={file.url}
            alt={file.name}
            className="source-monitor-image"
            style={sourceViewportStyle}
          />
        )}
      </div>

      <div className={`source-monitor-toolbar ${!showSourceTimingControls ? 'source-monitor-toolbar-commands-only' : ''}`}>
          {showSourceTimingControls && (
            <div className="source-monitor-timeline-strip">
              <div
                className="source-monitor-timeline"
                ref={timelineRef}
                onPointerDown={(event) => startTimelineDrag('playhead', event)}
                aria-label="Source timeline"
              >
                <div className="source-monitor-ruler">
                  {timelineTicks.map((tick) => (
                    <span
                      key={`${tick.time}-${tick.major ? 'major' : 'minor'}`}
                      className={`source-monitor-ruler-tick ${tick.major ? 'major' : 'minor'}`}
                      style={{ left: `${(tick.time / timelineDuration) * 100}%` }}
                    >
                      {tick.label && <span>{tick.label}</span>}
                    </span>
                  ))}
                </div>
                <div className="source-monitor-timeline-track">
                  {hasMarkedRange && (
                    <div
                      className="source-monitor-timeline-range"
                      style={{ left: `${rangeLeft}%`, width: `${rangeWidth}%` }}
                    />
                  )}
                  <button
                    type="button"
                    className="source-monitor-mark-handle source-monitor-mark-in"
                    style={{ left: `${rangeLeft}%` }}
                    onPointerDown={(event) => startTimelineDrag('in', event)}
                    title="Drag source In"
                    aria-label="Drag source In"
                  >
                    <span>I</span>
                  </button>
                  <button
                    type="button"
                    className="source-monitor-mark-handle source-monitor-mark-out"
                    style={{ left: `${rangeRight}%` }}
                    onPointerDown={(event) => startTimelineDrag('out', event)}
                    title="Drag source Out"
                    aria-label="Drag source Out"
                  >
                    <span>O</span>
                  </button>
                  <div className="source-monitor-timeline-fill" style={{ width: `${progress}%` }} />
                  <div className="source-monitor-playhead" style={{ left: `${progress}%` }}>
                    <span />
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className={`source-monitor-control-row ${!showSourceTimingControls ? 'source-monitor-control-row-commands-only' : ''}`}>
            {showSourceTimingControls && (
              <div className="source-monitor-timecode source-monitor-timecode-current">
                {formatTimecode(currentTime, fps)}
              </div>
            )}

            <div className="source-monitor-center-controls">
              {isImage && (
                <button
                  className={`btn btn-sm source-monitor-crop-btn ${imageCrop.cropMode ? 'btn-active' : ''}`}
                  onClick={imageCrop.toggleImageCrop}
                  title={imageCrop.cropMode ? 'Exit crop mode' : 'Crop image'}
                  aria-label={imageCrop.cropMode ? 'Exit crop mode' : 'Crop image'}
                >
                  <IconCrop size={14} aria-hidden="true" />
                  <span>Crop</span>
                </button>
              )}

              {showSourceTimingControls && (
                <div className="source-monitor-marks">
                  <button
                    className={`btn btn-sm ${inPoint !== null ? 'btn-active' : ''}`}
                    onClick={() => setSourceMonitorInPoint(currentTime)}
                    title="Set source In"
                  >
                    <IconFlag size={12} aria-hidden="true" />
                    In
                  </button>
                  <button
                    className={`btn btn-sm ${outPoint !== null ? 'btn-active' : ''}`}
                    onClick={() => setSourceMonitorOutPoint(currentTime)}
                    title="Set source Out"
                  >
                    <IconFlag size={12} aria-hidden="true" />
                    Out
                  </button>
                  <button
                    className="btn btn-sm source-monitor-icon-btn"
                    onClick={clearSourceMonitorInOut}
                    disabled={inPoint === null && outPoint === null}
                    title="Clear source In/Out"
                    aria-label="Clear source In/Out"
                  >
                    <IconX size={13} aria-hidden="true" />
                  </button>
                </div>
              )}

              {showSourceTimingControls && isPlayable && (
                <div className="source-monitor-transport">
                  <button
                    className="btn btn-sm source-monitor-icon-btn"
                    onClick={stopSource}
                    title="Stop"
                    aria-label="Stop source"
                  >
                    <IconPlayerStopFilled size={14} aria-hidden="true" />
                  </button>
                  <button
                    className={`btn btn-sm source-monitor-icon-btn source-monitor-play-button ${isPlaying ? 'btn-active' : ''}`}
                    onClick={isPlaying ? pauseSource : playSource}
                    title={isPlaying ? 'Pause [Space]' : 'Play [Space]'}
                    aria-label={isPlaying ? 'Pause source' : 'Play source'}
                  >
                    {isPlaying
                      ? <IconPlayerPauseFilled size={15} aria-hidden="true" />
                      : <IconPlayerPlayFilled size={15} aria-hidden="true" />
                    }
                  </button>
                </div>
              )}

              <SourceMonitorPlacementCommands
                pendingPlacementMode={pendingPlacementMode}
                onRunCommand={runSourcePlacementCommand}
              />
            </div>

            {showSourceTimingControls && (
              <div className="source-monitor-timecode source-monitor-timecode-duration">
                {formatTimecode(markedDuration, fps)}
              </div>
            )}
          </div>
        </div>
    </div>
  );
}
