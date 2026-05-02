import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { layerPlaybackManager } from '../../../services/layerPlaybackManager';
import { useMediaStore } from '../../../stores/mediaStore';
import type { Composition, SlotClipEndBehavior, SlotClipSettings } from '../../../stores/mediaStore';
import type { SerializableClip, TimelineSourceType, TimelineTrack } from '../../../types';

const GRID_COLS = 12;
const MIN_SLOT_WINDOW_SECONDS = 0.05;

interface SlotClipTabProps {
  composition: Composition;
  slotIndex: number;
}

interface SlotTimelineRow {
  id: string;
  name: string;
  type: TimelineTrack['type'];
  clips: SerializableClip[];
}

const SOURCE_LABELS: Partial<Record<TimelineSourceType, string>> = {
  video: 'Video',
  audio: 'Audio',
  image: 'Image',
  text: 'Text',
  solid: 'Solid',
  model: '3D',
  camera: 'Camera',
  'gaussian-avatar': 'Avatar',
  'gaussian-splat': 'Splat',
  'splat-effector': 'Effector',
  'math-scene': 'Math',
  lottie: 'Lottie',
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function formatTime(seconds: number): string {
  const safeSeconds = Math.max(0, seconds);
  const mins = Math.floor(safeSeconds / 60);
  const secs = Math.floor(safeSeconds % 60);
  const tenths = Math.floor((safeSeconds % 1) * 10);
  if (mins > 0) {
    return `${mins}:${secs.toString().padStart(2, '0')}.${tenths}`;
  }
  return `${secs}.${tenths}s`;
}

function getSlotLabel(slotIndex: number): string {
  const row = Math.floor(slotIndex / GRID_COLS);
  const col = slotIndex % GRID_COLS;
  return `${String.fromCharCode(65 + row)}${col + 1}`;
}

function getDefaultSettings(duration: number): SlotClipSettings {
  return {
    trimIn: 0,
    trimOut: Math.max(duration, MIN_SLOT_WINDOW_SECONDS),
    endBehavior: 'loop',
  };
}

function normalizeSettings(duration: number, settings?: SlotClipSettings): SlotClipSettings {
  const defaults = getDefaultSettings(duration);
  const safeDuration = defaults.trimOut;
  const requestedTrimIn = settings?.trimIn ?? defaults.trimIn;
  const requestedTrimOut = settings?.trimOut ?? defaults.trimOut;
  const endBehavior = settings?.endBehavior ?? defaults.endBehavior;

  if (safeDuration <= MIN_SLOT_WINDOW_SECONDS) {
    return {
      trimIn: 0,
      trimOut: safeDuration,
      endBehavior,
    };
  }

  const trimIn = clamp(requestedTrimIn, 0, safeDuration - MIN_SLOT_WINDOW_SECONDS);
  const trimOut = clamp(requestedTrimOut, trimIn + MIN_SLOT_WINDOW_SECONDS, safeDuration);
  return { trimIn, trimOut, endBehavior };
}

function getTrackLabel(track: TimelineTrack, index: number): string {
  const letter = track.type === 'audio' ? 'A' : 'V';
  return `${letter}${index + 1}`;
}

function getClipType(clip: SerializableClip): TimelineSourceType {
  return clip.sourceType ?? 'video';
}

function getClipLabel(clip: SerializableClip): string {
  return SOURCE_LABELS[getClipType(clip)] ?? getClipType(clip);
}

function getPercent(time: number, duration: number): number {
  return duration <= 0 ? 0 : clamp((time / duration) * 100, 0, 100);
}

function getClipWidthPercent(clip: SerializableClip, duration: number): number {
  const start = clamp(clip.startTime, 0, duration);
  const end = clamp(clip.startTime + Math.max(clip.duration, 0), 0, duration);
  return Math.max(0.6, getPercent(end - start, duration));
}

function buildRows(tracks: TimelineTrack[], clips: SerializableClip[]): SlotTimelineRow[] {
  const trackIds = new Set(tracks.map(track => track.id));
  const rows = tracks
    .filter(track => track.visible !== false)
    .map((track, index) => ({
      id: track.id,
      name: track.name || getTrackLabel(track, index),
      type: track.type,
      clips: clips
        .filter(clip => clip.trackId === track.id)
        .toSorted((a, b) => a.startTime - b.startTime),
    }));

  const orphanClips = clips
    .filter(clip => !trackIds.has(clip.trackId))
    .toSorted((a, b) => a.startTime - b.startTime);

  if (orphanClips.length > 0) {
    rows.push({
      id: '__orphan__',
      name: 'Clips',
      type: 'video',
      clips: orphanClips,
    });
  }

  return rows;
}

export function SlotClipTab({ composition, slotIndex }: SlotClipTabProps) {
  const slotClipSettings = useMediaStore(state => state.slotClipSettings[composition.id]);
  const activeLayerSlots = useMediaStore(state => state.activeLayerSlots);
  const updateSlotClipSettings = useMediaStore(state => state.updateSlotClipSettings) as (
    compositionId: string,
    duration: number,
    updates: Partial<{ trimIn: number; trimOut: number; endBehavior: SlotClipEndBehavior }>
  ) => void;
  const activateOnLayer = useMediaStore(state => state.activateOnLayer) as (compositionId: string, layerIndex: number) => void;

  const layerIndex = Math.floor(slotIndex / GRID_COLS);
  const duration = Math.max(composition.duration || composition.timelineData?.duration || 0, MIN_SLOT_WINDOW_SECONDS);
  const settings = useMemo(
    () => normalizeSettings(duration, slotClipSettings),
    [duration, slotClipSettings]
  );
  const isLayerActive = activeLayerSlots[layerIndex] === composition.id;

  const timelineRef = useRef<HTMLDivElement>(null);
  const [draggingEdge, setDraggingEdge] = useState<'in' | 'out' | null>(null);
  const [playback, setPlayback] = useState<{
    currentTime: number;
    playbackState: 'playing' | 'paused' | 'stopped';
  }>({
    currentTime: settings.trimIn,
    playbackState: 'stopped',
  });

  const rows = useMemo(() => {
    const timelineData = composition.timelineData;
    return buildRows(timelineData?.tracks ?? [], timelineData?.clips ?? []);
  }, [composition.timelineData]);

  useEffect(() => {
    let rafId = 0;

    const update = () => {
      const info = layerPlaybackManager.getLayerPlaybackInfo(layerIndex);
      if (info && info.compositionId === composition.id) {
        setPlayback((current) => {
          if (
            Math.abs(current.currentTime - info.currentTime) < 0.01 &&
            current.playbackState === info.playbackState
          ) {
            return current;
          }

          return {
            currentTime: info.currentTime,
            playbackState: info.playbackState,
          };
        });
      } else {
        setPlayback((current) => {
          if (
            Math.abs(current.currentTime - settings.trimIn) < 0.01 &&
            current.playbackState === 'stopped'
          ) {
            return current;
          }

          return {
            currentTime: settings.trimIn,
            playbackState: 'stopped',
          };
        });
      }

      rafId = requestAnimationFrame(update);
    };

    rafId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(rafId);
  }, [composition.id, layerIndex, settings.trimIn]);

  const getTimeFromClientX = useCallback((clientX: number) => {
    const rect = timelineRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) {
      return 0;
    }

    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    return ratio * duration;
  }, [duration]);

  const updateTrimFromPointer = useCallback((edge: 'in' | 'out', clientX: number) => {
    const time = getTimeFromClientX(clientX);
    if (edge === 'in') {
      updateSlotClipSettings(composition.id, duration, { trimIn: time });
      return;
    }

    updateSlotClipSettings(composition.id, duration, { trimOut: time });
  }, [composition.id, duration, getTimeFromClientX, updateSlotClipSettings]);

  useEffect(() => {
    if (!draggingEdge) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      updateTrimFromPointer(draggingEdge, event.clientX);
    };

    const handlePointerUp = () => {
      setDraggingEdge(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [draggingEdge, updateTrimFromPointer]);

  const handleLaunch = useCallback(() => {
    const launchTime = settings.trimIn;

    if (!isLayerActive) {
      activateOnLayer(composition.id, layerIndex);
    }

    layerPlaybackManager.activateLayer(layerIndex, composition.id, launchTime, { slotIndex });
    setPlayback({
      currentTime: launchTime,
      playbackState: 'playing',
    });
  }, [activateOnLayer, composition.id, isLayerActive, layerIndex, settings.trimIn, slotIndex]);

  const handlePause = useCallback(() => {
    if (!isLayerActive) {
      return;
    }

    layerPlaybackManager.pauseLayer(layerIndex);
  }, [isLayerActive, layerIndex]);

  const handleStop = useCallback(() => {
    if (!isLayerActive) {
      setPlayback({
        currentTime: settings.trimIn,
        playbackState: 'stopped',
      });
      return;
    }

    layerPlaybackManager.stopLayer(layerIndex);
  }, [isLayerActive, layerIndex, settings.trimIn]);

  const trimInPercent = getPercent(settings.trimIn, duration);
  const trimOutPercent = getPercent(settings.trimOut, duration);
  const rangeWidthPercent = Math.max(0, trimOutPercent - trimInPercent);
  const playheadPercent = getPercent(playback.currentTime, duration);
  const slotLabel = useMemo(() => getSlotLabel(slotIndex), [slotIndex]);
  const currentWithinRange = clamp(
    ((playback.currentTime - settings.trimIn) / Math.max(settings.trimOut - settings.trimIn, MIN_SLOT_WINDOW_SECONDS)) * 100,
    0,
    100
  );

  return (
    <div className="properties-tab-content slot-clip-tab">
      <div className="properties-section slot-clip-summary">
        <div className="slot-clip-summary-row">
          <div className="slot-clip-summary-title">
            <h4>Slot</h4>
            <div className="slot-clip-title">{composition.name}</div>
          </div>
          <div className="slot-clip-slot-badge">{slotLabel}</div>
        </div>
        <div className="slot-clip-summary-meta">
          <span className={isLayerActive ? 'slot-clip-status-active' : undefined}>
            {isLayerActive ? 'Active' : 'Loaded'}
          </span>
          <span>{playback.playbackState}</span>
          <span>{formatTime(playback.currentTime)} / {formatTime(duration)}</span>
        </div>
      </div>

      <div className="properties-section">
        <h4>Transport</h4>
        <div className="slot-clip-transport">
          <button type="button" className="slot-clip-transport-btn primary" onClick={handleLaunch}>
            {isLayerActive ? 'Restart' : 'Launch'}
          </button>
          <button
            type="button"
            className="slot-clip-transport-btn"
            onClick={handlePause}
            disabled={!isLayerActive || playback.playbackState !== 'playing'}
          >
            Pause
          </button>
          <button type="button" className="slot-clip-transport-btn" onClick={handleStop}>
            Stop
          </button>
        </div>
      </div>

      <div className="properties-section">
        <div className="slot-clip-section-header">
          <h4>Range</h4>
          <span>{formatTime(settings.trimOut - settings.trimIn)}</span>
        </div>
        <div className="slot-clip-timeline-shell">
          <div className="slot-clip-ruler" aria-hidden="true">
            <span>0.0s</span>
            <span>{formatTime(duration / 2)}</span>
            <span>{formatTime(duration)}</span>
          </div>
          <div className="slot-clip-track-stack" ref={timelineRef}>
            {rows.length > 0 ? (
              rows.map((row, rowIndex) => (
                <div className="slot-clip-track-row" key={row.id}>
                  <div className={`slot-clip-track-label slot-clip-track-label-${row.type}`}>
                    {row.type === 'audio' ? 'A' : 'V'}{rowIndex + 1}
                  </div>
                  <div className="slot-clip-track-lane" title={row.name}>
                    {row.clips.map((clip) => {
                      const left = getPercent(clip.startTime, duration);
                      const width = getClipWidthPercent(clip, duration);
                      const clipType = getClipType(clip);
                      return (
                        <div
                          key={clip.id}
                          className={`slot-clip-clip slot-clip-clip-${clipType}`}
                          style={{
                            left: `${left}%`,
                            width: `${width}%`,
                          }}
                          title={`${clip.name} (${getClipLabel(clip)})`}
                        >
                          <span>{getClipLabel(clip)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            ) : (
              <div className="slot-clip-empty-timeline">No timeline clips</div>
            )}

            <div className="slot-clip-trim-mask slot-clip-trim-mask-left" style={{ width: `${trimInPercent}%` }} />
            <div className="slot-clip-trim-mask slot-clip-trim-mask-right" style={{ left: `${trimOutPercent}%` }} />
            <div
              className="slot-clip-range-window"
              style={{
                left: `${trimInPercent}%`,
                width: `${rangeWidthPercent}%`,
              }}
            />
            <div
              className="slot-clip-range-progress"
              style={{
                left: `${trimInPercent}%`,
                width: `${(rangeWidthPercent * currentWithinRange) / 100}%`,
              }}
            />
            <div className="slot-clip-playhead" style={{ left: `${playheadPercent}%` }} />
            <button
              type="button"
              className={`slot-clip-handle slot-clip-handle-in${draggingEdge === 'in' ? ' dragging' : ''}`}
              style={{ left: `${trimInPercent}%` }}
              onPointerDown={(event) => {
                event.preventDefault();
                setDraggingEdge('in');
                updateTrimFromPointer('in', event.clientX);
              }}
              aria-label="Trim in"
            />
            <button
              type="button"
              className={`slot-clip-handle slot-clip-handle-out${draggingEdge === 'out' ? ' dragging' : ''}`}
              style={{ left: `${trimOutPercent}%` }}
              onPointerDown={(event) => {
                event.preventDefault();
                setDraggingEdge('out');
                updateTrimFromPointer('out', event.clientX);
              }}
              aria-label="Trim out"
            />
          </div>
        </div>
        <div className="slot-clip-timecodes">
          <div className="slot-clip-timecode">
            <span>Current</span>
            <strong>{formatTime(playback.currentTime)}</strong>
          </div>
          <div className="slot-clip-timecode">
            <span>In</span>
            <strong>{formatTime(settings.trimIn)}</strong>
          </div>
          <div className="slot-clip-timecode">
            <span>Out</span>
            <strong>{formatTime(settings.trimOut)}</strong>
          </div>
          <div className="slot-clip-timecode">
            <span>Length</span>
            <strong>{formatTime(settings.trimOut - settings.trimIn)}</strong>
          </div>
        </div>
      </div>

      <div className="properties-section">
        <h4>End</h4>
        <div className="slot-clip-end-behavior">
          {(['loop', 'hold', 'clear'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`slot-clip-end-btn${settings.endBehavior === mode ? ' active' : ''}`}
              onClick={() => updateSlotClipSettings(composition.id, duration, { endBehavior: mode })}
            >
              {mode === 'loop' ? 'Loop' : mode === 'hold' ? 'Hold Last Frame' : 'Clear'}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
