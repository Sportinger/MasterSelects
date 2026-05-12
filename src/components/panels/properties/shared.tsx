// Shared components for Properties Panel tabs
import { useRef, useCallback, useEffect } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import type { AnimatableProperty } from '../../../types';
import { createEffectProperty } from '../../../types';
import {
  KEYFRAME_RECORDING_FEEDBACK_EVENT,
  getKeyframeRecordingFeedbackId,
  type KeyframeRecordingFeedbackDetail,
} from '../../../utils/keyframeRecordingFeedback';
import { EQ_BAND_PARAMS } from './sharedConstants';
export {
  EditableDraggableNumber as DraggableNumber,
  type EditableDraggableNumberProps as DraggableNumberProps,
} from '../../common/EditableDraggableNumber';

type KeyframeToggleDragMode = 'enable' | 'disable';

type KeyframeToggleDragSession = {
  mode: KeyframeToggleDragMode;
  pointerId: number;
  visited: Set<string>;
};

type KeyframeToggleEntry = {
  property: AnimatableProperty;
  value: number;
};

let keyframeToggleDragSession: KeyframeToggleDragSession | null = null;

const STOPWATCH_RECORDING_FEEDBACK_MS = 900;

function getKeyframeRecordingFeedbackIds(clipId: string, properties: AnimatableProperty[]) {
  return properties.map(property => getKeyframeRecordingFeedbackId(clipId, property));
}

function getFeedbackValueKey(values: number[]) {
  return values.map(value => Number.isFinite(value) ? value.toFixed(6) : String(value)).join('|');
}

function endKeyframeToggleDrag() {
  keyframeToggleDragSession = null;
  window.removeEventListener('pointerup', endKeyframeToggleDrag);
  window.removeEventListener('pointercancel', endKeyframeToggleDrag);
  window.removeEventListener('blur', endKeyframeToggleDrag);
}

function applyKeyframeToggleEntries(
  mode: KeyframeToggleDragMode,
  clipId: string,
  entries: KeyframeToggleEntry[],
) {
  const store = useTimelineStore.getState();

  entries.forEach(({ property, value }) => {
    if (mode === 'disable') {
      store.disablePropertyKeyframes(clipId, property, value);
      return;
    }

    if (store.isRecording(clipId, property) || store.hasKeyframes(clipId, property)) {
      store.addKeyframe(clipId, property, value);
      return;
    }

    store.addKeyframe(clipId, property, value);
    store.toggleKeyframeRecording(clipId, property);
  });
}

function StopwatchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="13" r="7" />
      <line x1="12" y1="13" x2="12" y2="9" />
      <line x1="12" y1="2" x2="12" y2="5" />
      <line x1="9" y1="3" x2="15" y2="3" />
    </svg>
  );
}

function KeyframeStopwatchButton({
  dragId,
  mode,
  className,
  feedbackIds,
  feedbackValues,
  playbackFeedbackEnabled,
  title,
  onApply,
}: {
  dragId: string;
  mode: KeyframeToggleDragMode;
  className: string;
  feedbackIds: string[];
  feedbackValues: number[];
  playbackFeedbackEnabled: boolean;
  title: string;
  onApply: (mode: KeyframeToggleDragMode) => void;
}) {
  const isPlaying = useTimelineStore(state => state.isPlaying);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const ignoreNextClick = useRef(false);
  const feedbackIdsRef = useRef<Set<string>>(new Set(feedbackIds));
  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousFeedbackValueKeyRef = useRef<string | null>(null);
  const feedbackValueKey = getFeedbackValueKey(feedbackValues);

  useEffect(() => {
    feedbackIdsRef.current = new Set(feedbackIds);
  }, [feedbackIds]);

  const startRecordingFeedback = useCallback(() => {
    if (feedbackTimeoutRef.current !== null) {
      clearTimeout(feedbackTimeoutRef.current);
    }

    buttonRef.current?.classList.add('recording-feedback');
    feedbackTimeoutRef.current = setTimeout(() => {
      buttonRef.current?.classList.remove('recording-feedback');
      feedbackTimeoutRef.current = null;
    }, STOPWATCH_RECORDING_FEEDBACK_MS);
  }, []);

  useEffect(() => {
    const handleRecordingFeedback = (event: Event) => {
      const detail = (event as CustomEvent<KeyframeRecordingFeedbackDetail>).detail;
      if (!detail) return;

      const feedbackId = getKeyframeRecordingFeedbackId(detail.clipId, detail.property);
      if (!feedbackIdsRef.current.has(feedbackId)) return;

      startRecordingFeedback();
    };

    window.addEventListener(KEYFRAME_RECORDING_FEEDBACK_EVENT, handleRecordingFeedback);
    return () => {
      window.removeEventListener(KEYFRAME_RECORDING_FEEDBACK_EVENT, handleRecordingFeedback);
      if (feedbackTimeoutRef.current !== null) {
        clearTimeout(feedbackTimeoutRef.current);
      }
    };
  }, [startRecordingFeedback]);

  useEffect(() => {
    const previousValueKey = previousFeedbackValueKeyRef.current;
    previousFeedbackValueKeyRef.current = feedbackValueKey;

    if (
      previousValueKey === null ||
      previousValueKey === feedbackValueKey ||
      !isPlaying ||
      !playbackFeedbackEnabled
    ) {
      return;
    }

    startRecordingFeedback();
  }, [feedbackValueKey, isPlaying, playbackFeedbackEnabled, startRecordingFeedback]);

  const applyOnceForDrag = useCallback(() => {
    const session = keyframeToggleDragSession;
    if (!session || session.visited.has(dragId)) return;

    session.visited.add(dragId);
    onApply(session.mode);
  }, [dragId, onApply]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;

    e.preventDefault();
    e.stopPropagation();
    ignoreNextClick.current = true;

    endKeyframeToggleDrag();
    keyframeToggleDragSession = {
      mode,
      pointerId: e.pointerId,
      visited: new Set([dragId]),
    };
    window.addEventListener('pointerup', endKeyframeToggleDrag);
    window.addEventListener('pointercancel', endKeyframeToggleDrag);
    window.addEventListener('blur', endKeyframeToggleDrag);

    onApply(mode);
  }, [dragId, mode, onApply]);

  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    endKeyframeToggleDrag();
    onApply('disable');
  }, [onApply]);

  const handlePointerEnter = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const session = keyframeToggleDragSession;
    if (!session) return;

    if ((e.buttons & 1) !== 1 || e.pointerId !== session.pointerId) {
      endKeyframeToggleDrag();
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    applyOnceForDrag();
  }, [applyOnceForDrag]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (ignoreNextClick.current) {
      ignoreNextClick.current = false;
      e.preventDefault();
      return;
    }

    onApply(mode);
  }, [mode, onApply]);

  return (
    <button
      ref={buttonRef}
      className={className}
      onPointerDown={handlePointerDown}
      onPointerEnter={handlePointerEnter}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      title={title}
    >
      <StopwatchIcon />
    </button>
  );
}

// Keyframe toggle button
interface KeyframeToggleProps {
  clipId: string;
  property: AnimatableProperty;
  value: number;
}

export function KeyframeToggle({ clipId, property, value }: KeyframeToggleProps) {
  // Use getState() for actions - they're stable and don't need subscriptions
  const { isRecording, hasKeyframes } = useTimelineStore.getState();
  const recording = isRecording(clipId, property);
  const hasKfs = hasKeyframes(clipId, property);

  const handleApply = useCallback((mode: KeyframeToggleDragMode) => {
    applyKeyframeToggleEntries(mode, clipId, [{ property, value }]);
  }, [clipId, property, value]);

  return (
    <KeyframeStopwatchButton
      dragId={`${clipId}:${property}`}
      mode="enable"
      className={`keyframe-toggle ${recording ? 'recording' : ''} ${hasKfs ? 'has-keyframes' : ''}`}
      feedbackIds={getKeyframeRecordingFeedbackIds(clipId, [property])}
      feedbackValues={[value]}
      playbackFeedbackEnabled={recording || hasKfs}
      title={recording || hasKfs ? 'Add keyframe (right-click to disable)' : 'Add keyframe'}
      onApply={handleApply}
    />
  );
}

interface MultiKeyframeToggleProps {
  clipId: string;
  entries: KeyframeToggleEntry[];
  dragId: string;
  title?: string;
}

export function MultiKeyframeToggle({
  clipId,
  entries,
  dragId,
  title = 'Add keyframes',
}: MultiKeyframeToggleProps) {
  const { isRecording, hasKeyframes } = useTimelineStore.getState();
  const anyRecording = entries.some(({ property }) => isRecording(clipId, property));
  const anyHasKfs = entries.some(({ property }) => hasKeyframes(clipId, property));

  const handleApply = useCallback((mode: KeyframeToggleDragMode) => {
    applyKeyframeToggleEntries(mode, clipId, entries);
  }, [clipId, entries]);

  return (
    <KeyframeStopwatchButton
      dragId={dragId}
      mode="enable"
      className={`keyframe-toggle ${anyRecording ? 'recording' : ''} ${anyHasKfs ? 'has-keyframes' : ''}`}
      feedbackIds={getKeyframeRecordingFeedbackIds(clipId, entries.map(({ property }) => property))}
      feedbackValues={entries.map(({ value }) => value)}
      playbackFeedbackEnabled={anyRecording || anyHasKfs}
      title={anyRecording || anyHasKfs ? `${title} (right-click to disable)` : title}
      onApply={handleApply}
    />
  );
}

// Master keyframe toggle for Scale X/Y and optional Z together
export function ScaleKeyframeToggle({
  clipId,
  scaleX,
  scaleY,
  scaleZ,
}: {
  clipId: string;
  scaleX: number;
  scaleY: number;
  scaleZ?: number;
}) {
  // Use getState() for actions - they're stable and don't need subscriptions
  const { isRecording, hasKeyframes } = useTimelineStore.getState();

  const xRecording = isRecording(clipId, 'scale.x');
  const yRecording = isRecording(clipId, 'scale.y');
  const zRecording = scaleZ !== undefined ? isRecording(clipId, 'scale.z') : false;
  const xHasKfs = hasKeyframes(clipId, 'scale.x');
  const yHasKfs = hasKeyframes(clipId, 'scale.y');
  const zHasKfs = scaleZ !== undefined ? hasKeyframes(clipId, 'scale.z') : false;

  const anyRecording = xRecording || yRecording || zRecording;
  const anyHasKfs = xHasKfs || yHasKfs || zHasKfs;

  const handleApply = useCallback((mode: KeyframeToggleDragMode) => {
    applyKeyframeToggleEntries(mode, clipId, [
      { property: 'scale.x', value: scaleX },
      { property: 'scale.y', value: scaleY },
      ...(scaleZ !== undefined ? [{ property: 'scale.z' as AnimatableProperty, value: scaleZ }] : []),
    ]);
  }, [clipId, scaleX, scaleY, scaleZ]);

  return (
    <KeyframeStopwatchButton
      dragId={`${clipId}:scale:${scaleZ !== undefined ? 'xyz' : 'xy'}`}
      mode="enable"
      className={`keyframe-toggle ${anyRecording ? 'recording' : ''} ${anyHasKfs ? 'has-keyframes' : ''}`}
      feedbackIds={getKeyframeRecordingFeedbackIds(clipId, [
        'scale.x',
        'scale.y',
        ...(scaleZ !== undefined ? ['scale.z' as AnimatableProperty] : []),
      ])}
      feedbackValues={[scaleX, scaleY, ...(scaleZ !== undefined ? [scaleZ] : [])]}
      playbackFeedbackEnabled={anyRecording || anyHasKfs}
      title={anyRecording || anyHasKfs ? 'Add scale keyframes (right-click to disable)' : 'Add scale keyframes'}
      onApply={handleApply}
    />
  );
}

// Master keyframe toggle for Position X, Y, Z together
export function PositionKeyframeToggle({ clipId, x, y, z }: { clipId: string; x: number; y: number; z: number }) {
  const { isRecording, hasKeyframes } = useTimelineStore.getState();

  const xRec = isRecording(clipId, 'position.x');
  const yRec = isRecording(clipId, 'position.y');
  const zRec = isRecording(clipId, 'position.z');
  const xKfs = hasKeyframes(clipId, 'position.x');
  const yKfs = hasKeyframes(clipId, 'position.y');
  const zKfs = hasKeyframes(clipId, 'position.z');

  const anyRecording = xRec || yRec || zRec;
  const anyHasKfs = xKfs || yKfs || zKfs;

  const handleApply = useCallback((mode: KeyframeToggleDragMode) => {
    applyKeyframeToggleEntries(mode, clipId, [
      { property: 'position.x', value: x },
      { property: 'position.y', value: y },
      { property: 'position.z', value: z },
    ]);
  }, [clipId, x, y, z]);

  return (
    <KeyframeStopwatchButton
      dragId={`${clipId}:position`}
      mode="enable"
      className={`keyframe-toggle ${anyRecording ? 'recording' : ''} ${anyHasKfs ? 'has-keyframes' : ''}`}
      feedbackIds={getKeyframeRecordingFeedbackIds(clipId, ['position.x', 'position.y', 'position.z'])}
      feedbackValues={[x, y, z]}
      playbackFeedbackEnabled={anyRecording || anyHasKfs}
      title={anyRecording || anyHasKfs ? 'Add position keyframes (right-click to disable)' : 'Add position keyframes'}
      onApply={handleApply}
    />
  );
}

// Master keyframe toggle for camera Position X/Y/Z.
export function CameraPositionKeyframeToggle({ clipId, x, y, z }: { clipId: string; x: number; y: number; z: number }) {
  const { isRecording, hasKeyframes } = useTimelineStore.getState();

  const xRec = isRecording(clipId, 'position.x');
  const yRec = isRecording(clipId, 'position.y');
  const zRec = isRecording(clipId, 'position.z');
  const xKfs = hasKeyframes(clipId, 'position.x');
  const yKfs = hasKeyframes(clipId, 'position.y');
  const zKfs = hasKeyframes(clipId, 'position.z');

  const anyRecording = xRec || yRec || zRec;
  const anyHasKfs = xKfs || yKfs || zKfs;

  const handleApply = useCallback((mode: KeyframeToggleDragMode) => {
    applyKeyframeToggleEntries(mode, clipId, [
      { property: 'position.x', value: x },
      { property: 'position.y', value: y },
      { property: 'position.z', value: z },
    ]);
  }, [clipId, x, y, z]);

  return (
    <KeyframeStopwatchButton
      dragId={`${clipId}:camera-position`}
      mode="enable"
      className={`keyframe-toggle ${anyRecording ? 'recording' : ''} ${anyHasKfs ? 'has-keyframes' : ''}`}
      feedbackIds={getKeyframeRecordingFeedbackIds(clipId, ['position.x', 'position.y', 'position.z'])}
      feedbackValues={[x, y, z]}
      playbackFeedbackEnabled={anyRecording || anyHasKfs}
      title={anyRecording || anyHasKfs ? 'Add camera position keyframes (right-click to disable)' : 'Add camera position keyframes'}
      onApply={handleApply}
    />
  );
}

// Master keyframe toggle for Rotation X, Y, Z together
export function RotationKeyframeToggle({ clipId, x, y, z }: { clipId: string; x: number; y: number; z: number }) {
  const { isRecording, hasKeyframes } = useTimelineStore.getState();

  const xRec = isRecording(clipId, 'rotation.x');
  const yRec = isRecording(clipId, 'rotation.y');
  const zRec = isRecording(clipId, 'rotation.z');
  const xKfs = hasKeyframes(clipId, 'rotation.x');
  const yKfs = hasKeyframes(clipId, 'rotation.y');
  const zKfs = hasKeyframes(clipId, 'rotation.z');

  const anyRecording = xRec || yRec || zRec;
  const anyHasKfs = xKfs || yKfs || zKfs;

  const handleApply = useCallback((mode: KeyframeToggleDragMode) => {
    applyKeyframeToggleEntries(mode, clipId, [
      { property: 'rotation.x', value: x },
      { property: 'rotation.y', value: y },
      { property: 'rotation.z', value: z },
    ]);
  }, [clipId, x, y, z]);

  return (
    <KeyframeStopwatchButton
      dragId={`${clipId}:rotation`}
      mode="enable"
      className={`keyframe-toggle ${anyRecording ? 'recording' : ''} ${anyHasKfs ? 'has-keyframes' : ''}`}
      feedbackIds={getKeyframeRecordingFeedbackIds(clipId, ['rotation.x', 'rotation.y', 'rotation.z'])}
      feedbackValues={[x, y, z]}
      playbackFeedbackEnabled={anyRecording || anyHasKfs}
      title={anyRecording || anyHasKfs ? 'Add rotation keyframes (right-click to disable)' : 'Add rotation keyframes'}
      onApply={handleApply}
    />
  );
}

// Precision slider with modifier key support
interface PrecisionSliderProps {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
  defaultValue?: number;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

export function PrecisionSlider({ min, max, step: _step, value, onChange, defaultValue, onDragStart, onDragEnd }: PrecisionSliderProps) {
  const sliderRef = useRef<HTMLDivElement>(null);
  const accumulatedDelta = useRef(0);
  const startValue = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    accumulatedDelta.current = 0;
    startValue.current = value;
    onDragStart?.();

    const element = sliderRef.current;
    if (element) element.requestPointerLock();

    const handleMouseMove = (e: MouseEvent) => {
      if (!sliderRef.current) return;
      const rect = sliderRef.current.getBoundingClientRect();
      const range = max - min;
      const pixelsPerUnit = rect.width / range;
      let speedMultiplier = 1;
      if (e.ctrlKey) speedMultiplier = 0.01;
      else if (e.shiftKey) speedMultiplier = 0.1;

      accumulatedDelta.current += e.movementX * speedMultiplier;
      const deltaValue = accumulatedDelta.current / pixelsPerUnit;
      const newValue = Math.max(min, Math.min(max, startValue.current + deltaValue));
      const preciseValue = Math.round(newValue * 1000000) / 1000000;
      onChange(preciseValue);
    };

    const handleMouseUp = () => {
      document.exitPointerLock();
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      onDragEnd?.();
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [value, min, max, onChange, onDragStart, onDragEnd]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (defaultValue !== undefined) onChange(defaultValue);
  }, [defaultValue, onChange]);

  const fillPercent = ((value - min) / (max - min)) * 100;

  return (
    <div
      ref={sliderRef}
      className="precision-slider"
      onMouseDown={handleMouseDown}
      onContextMenu={handleContextMenu}
      title={defaultValue !== undefined ? "Right-click to reset to default" : undefined}
    >
      <div className="precision-slider-track">
        <div className="precision-slider-fill" style={{ width: `${fillPercent}%` }} />
        <div className="precision-slider-thumb" style={{ left: `${fillPercent}%` }} />
      </div>
    </div>
  );
}

// Draggable number input
interface LegacyDraggableNumberProps {
  value: number;
  onChange: (value: number) => void;
  defaultValue?: number;
  sensitivity?: number;
  decimals?: number;
  suffix?: string;
  min?: number;
  max?: number;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

export function LegacyDraggableNumber({ value, onChange, defaultValue, sensitivity = 2, decimals = 2, suffix = '', min, max, onDragStart, onDragEnd }: LegacyDraggableNumberProps) {
  const inputRef = useRef<HTMLSpanElement>(null);
  const accumulatedDelta = useRef(0);
  const startValue = useRef(0);
  const lastClientX = useRef(0);
  const hasPointerLock = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    accumulatedDelta.current = 0;
    startValue.current = value;
    lastClientX.current = e.clientX;
    hasPointerLock.current = false;
    onDragStart?.();

    // Try pointer lock (hides cursor, infinite drag range) — but don't rely on it
    const element = inputRef.current;
    if (element) {
      try {
        const result = element.requestPointerLock();
        // Modern browsers return a Promise
        if (result && typeof (result as Promise<void>).then === 'function') {
          (result as Promise<void>).then(
            () => { hasPointerLock.current = true; },
            () => { hasPointerLock.current = false; },
          );
        } else {
          // Older browsers: check synchronously after a tick
          requestAnimationFrame(() => {
            hasPointerLock.current = document.pointerLockElement === element;
          });
        }
      } catch {
        hasPointerLock.current = false;
      }
    }

    const handleMouseMove = (e: MouseEvent) => {
      let speedMultiplier = 1;
      if (e.ctrlKey) speedMultiplier = 0.01;
      else if (e.shiftKey) speedMultiplier = 0.1;

      // Use movementX when pointer lock is active, clientX delta as fallback
      let dx: number;
      if (hasPointerLock.current && document.pointerLockElement) {
        dx = e.movementX;
      } else {
        dx = e.clientX - lastClientX.current;
        lastClientX.current = e.clientX;
      }

      accumulatedDelta.current += dx * speedMultiplier;
      const deltaValue = accumulatedDelta.current / sensitivity;
      let newValue = startValue.current + deltaValue;
      // Clamp to min/max if specified
      if (min !== undefined) newValue = Math.max(min, newValue);
      if (max !== undefined) newValue = Math.min(max, newValue);
      const preciseValue = Math.round(newValue * Math.pow(10, decimals + 2)) / Math.pow(10, decimals + 2);
      onChange(preciseValue);
    };

    const handleMouseUp = () => {
      if (hasPointerLock.current || document.pointerLockElement) {
        document.exitPointerLock();
      }
      hasPointerLock.current = false;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      onDragEnd?.();
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [value, sensitivity, decimals, onChange, min, max, onDragStart, onDragEnd]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (defaultValue !== undefined) onChange(defaultValue);
  }, [defaultValue, onChange]);

  return (
    <span
      ref={inputRef}
      className="draggable-number"
      onMouseDown={handleMouseDown}
      onContextMenu={handleContextMenu}
      title={defaultValue !== undefined ? "Drag to change, right-click to reset" : "Drag to change"}
    >
      {value.toFixed(decimals)}{suffix}
    </span>
  );
}

// Effect keyframe toggle
export function EffectKeyframeToggle({ clipId, effectId, paramName, value }: { clipId: string; effectId: string; paramName: string; value: number }) {
  // Use getState() for actions - they're stable and don't need subscriptions
  const { isRecording, hasKeyframes } = useTimelineStore.getState();
  const property = createEffectProperty(effectId, paramName);
  const recording = isRecording(clipId, property);
  const hasKfs = hasKeyframes(clipId, property);

  const handleApply = useCallback((mode: KeyframeToggleDragMode) => {
    applyKeyframeToggleEntries(mode, clipId, [{ property, value }]);
  }, [clipId, property, value]);

  return (
    <KeyframeStopwatchButton
      dragId={`${clipId}:${property}`}
      mode="enable"
      className={`keyframe-toggle ${recording ? 'recording' : ''} ${hasKfs ? 'has-keyframes' : ''}`}
      feedbackIds={getKeyframeRecordingFeedbackIds(clipId, [property])}
      feedbackValues={[value]}
      playbackFeedbackEnabled={recording || hasKfs}
      title={recording || hasKfs ? 'Add keyframe (right-click to disable)' : 'Add keyframe'}
      onApply={handleApply}
    />
  );
}

// Master keyframe toggle for all 10 EQ bands at once
export function EQKeyframeToggle({ clipId, effectId, eqBands }: { clipId: string; effectId: string; eqBands: number[] }) {
  // Use getState() for actions - they're stable and don't need subscriptions
  const { isRecording, hasKeyframes } = useTimelineStore.getState();

  // Check if any band is recording or has keyframes
  const anyRecording = EQ_BAND_PARAMS.some(param => isRecording(clipId, createEffectProperty(effectId, param)));
  const anyHasKfs = EQ_BAND_PARAMS.some(param => hasKeyframes(clipId, createEffectProperty(effectId, param)));

  const handleApply = useCallback((mode: KeyframeToggleDragMode) => {
    applyKeyframeToggleEntries(
      mode,
      clipId,
      EQ_BAND_PARAMS.map((param, index) => ({
        property: createEffectProperty(effectId, param),
        value: eqBands[index],
      })),
    );
  }, [clipId, effectId, eqBands]);

  return (
    <KeyframeStopwatchButton
      dragId={`${clipId}:effect:${effectId}:eq`}
      mode="enable"
      className={`keyframe-toggle ${anyRecording ? 'recording' : ''} ${anyHasKfs ? 'has-keyframes' : ''}`}
      feedbackIds={EQ_BAND_PARAMS.map(param => (
        getKeyframeRecordingFeedbackId(clipId, createEffectProperty(effectId, param))
      ))}
      feedbackValues={eqBands}
      playbackFeedbackEnabled={anyRecording || anyHasKfs}
      title={anyRecording || anyHasKfs ? 'Add EQ keyframes (right-click to disable)' : 'Add EQ keyframes'}
      onApply={handleApply}
    />
  );
}
