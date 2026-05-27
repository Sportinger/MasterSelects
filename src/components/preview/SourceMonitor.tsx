// Source Monitor - previews raw media files before timeline placement.

import './SourceMonitor.css';
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  IconFlag,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconPlayerStopFilled,
  IconX,
} from '@tabler/icons-react';
import { getShortcutRegistry } from '../../services/shortcutRegistry';
import {
  clearTimelinePlacementCommandPreview,
  runTimelinePlacementCommand,
  showTimelinePlacementCommandPreview,
} from '../../services/timelinePlacementCommands';
import { useMediaStore, type MediaFile } from '../../stores/mediaStore';
import { startMediaFileWaveformGeneration } from '../../stores/mediaStore/helpers/mediaWaveformHelpers';
import type { TimelinePlacementMode } from '../../stores/timeline/editOperations/types';
import { TIMELINE_TOOL_ICONS } from '../timeline/tools/toolIcons';

interface SourceMonitorProps {
  file: MediaFile;
  autoplayRequestId?: number;
  onClose: () => void;
}

const SOURCE_MONITOR_PLACEMENT_COMMANDS: Array<{
  mode: TimelinePlacementMode;
  label: string;
  title: string;
}> = [
  { mode: 'insert', label: 'Insert', title: 'Insert source at playhead' },
  { mode: 'overwrite', label: 'Overwrite', title: 'Overwrite at playhead' },
  { mode: 'replace', label: 'Replace', title: 'Replace selected clip or range' },
  { mode: 'fit-to-fill', label: 'Fit', title: 'Fit source to selected clip or range' },
  { mode: 'append-at-end', label: 'Append', title: 'Append source at track end' },
  { mode: 'place-on-top', label: 'Top', title: 'Place source on top track' },
  { mode: 'ripple-overwrite', label: 'Ripple Overwrite', title: 'Ripple overwrite selected range' },
];

const DEFAULT_STILL_DURATION = 5;
const MIN_MARK_GAP_SECONDS = 0.001;
const SOURCE_WAVEFORM_FILL = '#020403';

type SourceTimelineDragKind = 'playhead' | 'in' | 'out';
type AudioWaveformStatus = NonNullable<MediaFile['waveformStatus']>;

function normalizeDuration(value: number | undefined, fallback = 0): number {
  return Number.isFinite(value) && value !== undefined && value > 0 ? value : fallback;
}

function clampTime(time: number, duration: number): number {
  if (!Number.isFinite(time)) return 0;
  return Math.max(0, Math.min(Math.max(0, duration), time));
}

function getNiceStep(rawStep: number): number {
  if (!Number.isFinite(rawStep) || rawStep <= 0) return 1;
  const exponent = Math.floor(Math.log10(rawStep));
  const base = rawStep / 10 ** exponent;
  const niceBase = base <= 1 ? 1 : base <= 2 ? 2 : base <= 5 ? 5 : 10;
  return niceBase * 10 ** exponent;
}

function formatTimecode(seconds: number, fps: number): string {
  const safeSeconds = Math.max(0, seconds);
  const h = Math.floor(safeSeconds / 3600);
  const m = Math.floor((safeSeconds % 3600) / 60);
  const s = Math.floor(safeSeconds % 60);
  const f = Math.floor((safeSeconds % 1) * fps);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}:${f.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}:${f.toString().padStart(2, '0')}`;
}

function createTimelineTicks(duration: number, fps: number): Array<{ time: number; label: string; major: boolean }> {
  if (duration <= 0) return [];
  const majorStep = getNiceStep(duration / 5);
  const minorStep = majorStep / 4;
  const ticks: Array<{ time: number; label: string; major: boolean }> = [];
  const maxTicks = 96;

  for (let i = 0; i <= maxTicks; i += 1) {
    const time = i * minorStep;
    if (time > duration + MIN_MARK_GAP_SECONDS) break;
    const major = Math.abs(time / majorStep - Math.round(time / majorStep)) < 0.0001 || time === 0;
    ticks.push({
      time: Math.min(time, duration),
      label: major ? formatTimecode(time, fps) : '',
      major,
    });
  }

  if (ticks[ticks.length - 1]?.time !== duration) {
    ticks.push({ time: duration, label: formatTimecode(duration, fps), major: true });
  }

  return ticks;
}

function getAudioWaveformStatus(file: MediaFile, isAudio: boolean): AudioWaveformStatus {
  if (!isAudio) return 'idle';
  if ((file.waveform?.length ?? 0) > 0) {
    return file.waveformStatus ?? 'ready';
  }
  return file.waveformStatus ?? 'idle';
}

function getSourceWaveformChannels(file: MediaFile): readonly (readonly number[])[] {
  const channels = file.waveformChannels?.filter((channel) => channel.length > 0) ?? [];
  if (channels.length > 0) return channels;
  if (file.waveform?.length) return [file.waveform, file.waveform];
  return [];
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

function drawSourceAudioWaveformCanvas(
  canvas: HTMLCanvasElement,
  channels: readonly (readonly number[])[],
  status: AudioWaveformStatus,
): void {
  const container = canvas.parentElement;
  const rect = container?.getBoundingClientRect();
  const cssWidth = Math.round(rect?.width || container?.clientWidth || canvas.clientWidth || 0);
  const cssHeight = Math.round(rect?.height || container?.clientHeight || canvas.clientHeight || 0);
  if (cssWidth <= 1 || cssHeight <= 1) return;

  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  const pixelWidth = Math.max(1, Math.round(cssWidth * dpr));
  const pixelHeight = Math.max(1, Math.round(cssHeight * dpr));

  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }

  const context = canvas.getContext('2d');
  if (!context) return;

  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);

  const renderChannels = channels.length > 0 ? channels.slice(0, 2) : [];
  if (renderChannels.length === 0) {
    if (status === 'generating') {
      context.fillStyle = 'rgba(2, 4, 3, 0.22)';
      for (let channelIndex = 0; channelIndex < 2; channelIndex += 1) {
        const laneTop = (cssHeight / 2) * channelIndex;
        const laneHeight = cssHeight / 2;
        const centerY = laneTop + laneHeight / 2;
        for (let x = 0; x < cssWidth; x += 4) {
          const amplitude = 0.08 + ((x / 4) % 7) * 0.015;
          const halfHeight = Math.max(1, laneHeight * amplitude);
          context.fillRect(x, centerY - halfHeight, 2, halfHeight * 2);
        }
      }
    }
    return;
  }

  context.fillStyle = SOURCE_WAVEFORM_FILL;
  context.globalAlpha = status === 'skipped' || status === 'error'
    ? 0.32
    : status === 'generating'
      ? 0.74
      : 0.98;

  for (let channelIndex = 0; channelIndex < 2; channelIndex += 1) {
    const channel = renderChannels[channelIndex] ?? renderChannels[0];
    if (!channel || channel.length === 0) continue;

    const laneTop = (cssHeight / 2) * channelIndex;
    const laneHeight = cssHeight / 2;
    const centerY = laneTop + laneHeight / 2;
    const maxHalfHeight = Math.max(1, laneHeight * 0.46);

    for (let x = 0; x < cssWidth; x += 1) {
      const start = Math.floor((x / cssWidth) * channel.length);
      const end = Math.max(start + 1, Math.ceil(((x + 1) / cssWidth) * channel.length));
      let peak = 0;

      for (let sampleIndex = start; sampleIndex < end && sampleIndex < channel.length; sampleIndex += 1) {
        peak = Math.max(peak, Math.abs(channel[sampleIndex] ?? 0));
      }

      const halfHeight = Math.max(0.6, Math.min(1, peak) * maxHalfHeight);
      context.fillRect(x, centerY - halfHeight, 1, halfHeight * 2);
    }
  }

  context.globalAlpha = 1;
}

export function SourceMonitor({ file, autoplayRequestId = 0, onClose }: SourceMonitorProps) {
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const audioWaveformRef = useRef<HTMLDivElement>(null);
  const audioWaveformCanvasRef = useRef<HTMLCanvasElement>(null);

  const isVideo = file.type === 'video';
  const isAudio = file.type === 'audio';
  const isImage = file.type === 'image';
  const isPlayable = isVideo || isAudio;
  const fps = file.fps || 30;

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(normalizeDuration(file.duration, isImage ? DEFAULT_STILL_DURATION : 0));
  const [isPlaying, setIsPlaying] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [pendingPlacementMode, setPendingPlacementMode] = useState<TimelinePlacementMode | null>(null);
  const inPoint = useMediaStore(state => state.sourceMonitorInPoint);
  const outPoint = useMediaStore(state => state.sourceMonitorOutPoint);
  const setSourceMonitorInPoint = useMediaStore(state => state.setSourceMonitorInPoint);
  const setSourceMonitorOutPoint = useMediaStore(state => state.setSourceMonitorOutPoint);
  const clearSourceMonitorInOut = useMediaStore(state => state.clearSourceMonitorInOut);
  const currentTimeRef = useRef(currentTime);
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

    scheduleRender();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(scheduleRender);
      observer.observe(container);
      return () => {
        if (frameId) window.cancelAnimationFrame(frameId);
        observer.disconnect();
      };
    }

    window.addEventListener('resize', scheduleRender);
    return () => {
      if (frameId) window.cancelAnimationFrame(frameId);
      window.removeEventListener('resize', scheduleRender);
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

  useEffect(() => {
    const media = mediaRef.current;
    return () => {
      if (!media) return;
      media.pause();
      media.removeAttribute('src');
      media.load();
    };
  }, [file.id]);

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
    if (
      media.ended ||
      media.currentTime >= playbackEnd - MIN_MARK_GAP_SECONDS ||
      media.currentTime < playbackStart - MIN_MARK_GAP_SECONDS
    ) {
      media.currentTime = clampTime(playbackStart, timelineDuration);
    }
    void media.play();
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

  return (
    <div className="source-monitor">
      <div className="source-monitor-media">
        {isVideo ? (
          <video
            ref={(node) => { mediaRef.current = node; }}
            src={file.url}
            className="source-monitor-video"
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
        ) : (
          <img
            src={file.url}
            alt={file.name}
            className="source-monitor-image"
          />
        )}
      </div>

      <div className="source-monitor-toolbar">
        {timelineDuration > 0 && (
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

        <div className="source-monitor-control-row">
          <div className="source-monitor-timecode source-monitor-timecode-current">
            {formatTimecode(currentTime, fps)}
          </div>

          <div className="source-monitor-center-controls">
            {timelineDuration > 0 && (
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

            {isPlayable && (
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

            <div className="source-monitor-edit-commands" aria-label="Source edit commands">
              {SOURCE_MONITOR_PLACEMENT_COMMANDS.map((command) => {
                const CommandIcon = TIMELINE_TOOL_ICONS[command.mode];
                return (
                  <button
                    key={command.mode}
                    className={`btn btn-sm source-monitor-icon-btn source-monitor-command-btn ${pendingPlacementMode === command.mode ? 'btn-active' : ''}`}
                    onClick={() => runSourcePlacementCommand(command.mode)}
                    onMouseEnter={() => showTimelinePlacementCommandPreview(command.mode)}
                    onMouseLeave={() => clearTimelinePlacementCommandPreview(command.mode)}
                    onFocus={() => showTimelinePlacementCommandPreview(command.mode)}
                    onBlur={() => clearTimelinePlacementCommandPreview(command.mode)}
                    disabled={pendingPlacementMode !== null}
                    title={command.title}
                    aria-label={command.label}
                  >
                    <CommandIcon size={14} stroke={2.2} aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </div>

          <div className="source-monitor-timecode source-monitor-timecode-duration">
            {formatTimecode(markedDuration, fps)}
          </div>
        </div>
      </div>
    </div>
  );
}
