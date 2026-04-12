import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MiniTimeline } from '../../timeline/MiniTimeline';
import { layerPlaybackManager } from '../../../services/layerPlaybackManager';
import { useMediaStore } from '../../../stores/mediaStore';
import type { Composition, SlotClipEndBehavior } from '../../../stores/mediaStore';

const GRID_COLS = 12;
const MIN_TIMELINE_WIDTH = 220;
const TIMELINE_HEIGHT = 84;

interface SlotClipTabProps {
  composition: Composition;
  slotIndex: number;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const tenths = Math.floor((seconds % 1) * 10);
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
  const duration = Math.max(composition.duration || composition.timelineData?.duration || 0, 0.05);
  const settings = slotClipSettings ?? {
    trimIn: 0,
    trimOut: duration,
    endBehavior: 'loop' as const,
  };
  const isLayerActive = activeLayerSlots[layerIndex] === composition.id;

  const timelineRef = useRef<HTMLDivElement>(null);
  const miniTimelineRef = useRef<HTMLDivElement>(null);
  const [miniTimelineWidth, setMiniTimelineWidth] = useState(260);
  const [draggingEdge, setDraggingEdge] = useState<'in' | 'out' | null>(null);
  const [playback, setPlayback] = useState<{
    currentTime: number;
    playbackState: 'playing' | 'paused' | 'stopped';
  }>({
    currentTime: settings.trimIn,
    playbackState: 'stopped',
  });

  useEffect(() => {
    const container = miniTimelineRef.current;
    if (!container || typeof ResizeObserver === 'undefined') {
      return;
    }

    const updateWidth = () => {
      setMiniTimelineWidth(Math.max(MIN_TIMELINE_WIDTH, Math.floor(container.clientWidth) - 2));
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

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

    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
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

  const handlePlay = useCallback(() => {
    if (!isLayerActive) {
      activateOnLayer(composition.id, layerIndex);
      return;
    }

    layerPlaybackManager.playLayer(layerIndex);
  }, [activateOnLayer, composition.id, isLayerActive, layerIndex]);

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

  const rangeLeft = `${(settings.trimIn / duration) * 100}%`;
  const rangeWidth = `${((settings.trimOut - settings.trimIn) / duration) * 100}%`;
  const playheadLeft = `${(playback.currentTime / duration) * 100}%`;
  const slotLabel = useMemo(() => getSlotLabel(slotIndex), [slotIndex]);

  return (
    <div className="properties-tab-content slot-clip-tab">
      <div className="properties-section slot-clip-summary">
        <div className="slot-clip-summary-row">
          <div>
            <h4>Slot</h4>
            <div className="slot-clip-title">{composition.name}</div>
          </div>
          <div className="slot-clip-slot-badge">{slotLabel}</div>
        </div>
        <div className="slot-clip-summary-meta">
          <span>{isLayerActive ? 'Active' : 'Loaded'}</span>
          <span>{playback.playbackState}</span>
          <span>{formatTime(playback.currentTime)} / {formatTime(duration)}</span>
        </div>
      </div>

      <div className="properties-section">
        <h4>Transport</h4>
        <div className="slot-clip-transport">
          <button type="button" className="slot-clip-transport-btn" onClick={handlePlay}>
            {playback.playbackState === 'playing' ? 'Playing' : 'Play'}
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
        <h4>Crop</h4>
        <div className="slot-clip-timeline-shell" ref={miniTimelineRef}>
          <div className="slot-clip-timeline-preview">
            <MiniTimeline
              timelineData={composition.timelineData}
              compositionName={composition.name}
              compositionDuration={duration}
              isActive={isLayerActive}
              width={miniTimelineWidth}
              height={TIMELINE_HEIGHT}
            />
          </div>
          <div className="slot-clip-range-overlay" ref={timelineRef}>
            <div className="slot-clip-range-mask slot-clip-range-mask-left" style={{ width: rangeLeft }} />
            <div className="slot-clip-range-mask slot-clip-range-mask-right" style={{ left: `calc(${rangeLeft} + ${rangeWidth})` }} />
            <div className="slot-clip-range-window" style={{ left: rangeLeft, width: rangeWidth }} />
            <div className="slot-clip-playhead" style={{ left: playheadLeft }} />
            <button
              type="button"
              className={`slot-clip-handle slot-clip-handle-in${draggingEdge === 'in' ? ' dragging' : ''}`}
              style={{ left: rangeLeft }}
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
              style={{ left: `calc(${rangeLeft} + ${rangeWidth})` }}
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
