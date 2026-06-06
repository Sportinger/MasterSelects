// TimelineTrack component - Individual track row

import React, { memo, useCallback, useMemo, useRef, useEffect, useState } from 'react';
import type { ClipKeyframeTimeGroup, TimelineTrackProps } from './types';
import type { AnimatableProperty, BezierHandle, ClipMask, Keyframe } from '../../types';
import { CurveEditor } from './CurveEditor';
import type { CurveEditorEditPhase } from './CurveEditor';
import {
  isVectorAnimationSourceType,
  parseVectorAnimationInputProperty,
  parseVectorAnimationStateProperty,
  shouldLoopVectorAnimation,
} from '../../types/vectorAnimation';
import { useTimelineStore } from '../../stores/timeline';
import { TimelineClipCanvas, type CanvasFadeVisuals } from './TimelineClipCanvas';
import {
  ClipInteractionShell,
  type ClipInteractionShellActiveModules,
  type ClipInteractionShellCommandContext,
  type ClipInteractionShellGeometry,
  type ClipInteractionShellMountReason,
  type ClipInteractionShellMountState,
  type ClipInteractionShellModuleSlot,
  type ClipInteractionShellRect,
} from './interactionShell';
import {
  reportTimelineCanvasDomDiagnostics,
  unregisterTimelineCanvasTrackDiagnostics,
} from '../../services/timeline/timelineCanvasDiagnostics';
import { Logger } from '../../services/logger';
import { MIN_CLIP_DURATION } from './timelineRenderConstants';
import { resolveAudioVolumeAutomationCurveKeyframes } from './utils/audioAutomationCurve';
import type { FadeCurveKeyframe } from './utils/fadeCurvePath';
import { isTimelineActiveTarget } from './utils/timelineActiveTargets';
import {
  dispatchTimelineClipPointerClick,
  dispatchTimelineClipPointerMove,
  isTimelinePointerTool,
} from './tools/pointer/timelineToolPointerDispatcher';

const TRACK_VIEWPORT_FALLBACK_PX = 1600;
const TRACK_RENDER_OVERSCAN_PX = 1200;
const CLIP_SHELL_VERTICAL_INSET_PX = 4;
const CLIP_SHELL_HANDLE_WIDTH_PX = 8;
const CLIP_SHELL_FADE_HANDLE_SIZE_PX = 12;
const EPSILON = 0.0001;
const FADE_DURATION_VALUE_EPSILON = 0.01;
const log = Logger.create('TimelineTrack');

type KeyframeTickMovePhase = 'begin' | 'update' | 'commit';

const isInfiniteTimelineSourceType = (sourceType: string | null | undefined): boolean => (
  sourceType === 'text' ||
  sourceType === 'image' ||
  sourceType === 'solid' ||
  sourceType === 'camera' ||
  sourceType === 'splat-effector' ||
  sourceType === 'math-scene'
);

type KeyframeTrackClip = {
  id: string;
  startTime: number;
  duration: number;
  is3D?: boolean;
  masks?: ClipMask[];
  effects?: Array<{ id: string; name: string; params: Record<string, unknown> }>;
  source?: {
    type?: string;
    gaussianSplatSettings?: {
      render?: {
        useNativeRenderer?: boolean;
      };
    };
  } | null;
};

const usesCameraPropertyModel = (clip: KeyframeTrackClip | null | undefined): boolean => {
  if (!clip?.source) return false;
  return clip.source.type === 'camera';
};

const shouldHide3DOnlyProperties = (clip: KeyframeTrackClip | null | undefined): boolean => {
  return !clip?.is3D && !usesCameraPropertyModel(clip);
};

type ClipFadeVisualState = CanvasFadeVisuals & {
  fadeInDuration: number;
  fadeOutDuration: number;
  curveKey: string;
};

const getCanvasClipSourceDuration = (clip: {
  duration: number;
  inPoint?: number;
  outPoint?: number;
  source?: { naturalDuration?: number } | null;
}): number => {
  const naturalDuration = clip.source?.naturalDuration;
  if (Number.isFinite(naturalDuration) && naturalDuration && naturalDuration > 0) {
    return naturalDuration;
  }
  return Math.max(
    clip.outPoint ?? 0,
    (clip.inPoint ?? 0) + clip.duration,
    clip.duration,
    0.1,
  );
};

const getTransformPropertyOrder = (clip: KeyframeTrackClip | null | undefined): string[] => (
  usesCameraPropertyModel(clip)
    ? ['camera.fov', 'camera.near', 'camera.far', 'camera.resolutionWidth', 'camera.resolutionHeight', 'opacity', 'position.x', 'position.y', 'position.z', 'rotation.x', 'rotation.y', 'rotation.z']
    : ['opacity', 'position.x', 'position.y', 'position.z', 'scale.all', 'scale.x', 'scale.y', 'scale.z', 'rotation.x', 'rotation.y', 'rotation.z']
);

const getFadeCurveKey = (keyframes: readonly FadeCurveKeyframe[]): string => (
  keyframes
    .map((keyframe) => (
      `${keyframe.id ?? ''}:${keyframe.time.toFixed(3)}:${keyframe.value}:${keyframe.handleIn?.x ?? ''}:${keyframe.handleIn?.y ?? ''}:${keyframe.handleOut?.x ?? ''}:${keyframe.handleOut?.y ?? ''}`
    ))
    .join('|')
);

const getFadeInDurationFromCurveKeyframes = (keyframes: readonly FadeCurveKeyframe[]): number => {
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  if (sorted.length < 2) return 0;

  const first = sorted[0];
  if (Math.abs(first.time) > FADE_DURATION_VALUE_EPSILON || Math.abs(first.value) > FADE_DURATION_VALUE_EPSILON) {
    return 0;
  }

  const fadeEnd = sorted.find((keyframe) => keyframe.time > 0 && keyframe.value >= 0.99);
  return fadeEnd?.time ?? 0;
};

const getFadeOutDurationFromCurveKeyframes = (
  keyframes: readonly FadeCurveKeyframe[],
  clipDuration: number,
): number => {
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  if (sorted.length < 2) return 0;

  const last = sorted[sorted.length - 1];
  if (
    Math.abs(last.time - clipDuration) > FADE_DURATION_VALUE_EPSILON ||
    Math.abs(last.value) > FADE_DURATION_VALUE_EPSILON
  ) {
    return 0;
  }

  for (let index = sorted.length - 2; index >= 0; index -= 1) {
    const keyframe = sorted[index];
    if (keyframe.value >= 0.99) {
      return Math.max(0, clipDuration - keyframe.time);
    }
  }

  return 0;
};

const createShellRect = (x: number, y: number, width: number, height: number): ClipInteractionShellRect => ({
  x,
  y,
  width: Math.max(0, width),
  height: Math.max(0, height),
});

const clampShellRectX = (rect: ClipInteractionShellRect, viewport: ClipInteractionShellRect): ClipInteractionShellRect => {
  const left = Math.max(rect.x, viewport.x);
  const right = Math.min(rect.x + rect.width, viewport.x + viewport.width);
  return createShellRect(left, rect.y, right - left, rect.height);
};

const getClipShellKeyframeGroups = (
  keyframes: ReadonlyArray<Pick<Keyframe, 'id' | 'time' | 'property'>>,
): ClipKeyframeTimeGroup[] => {
  const groups = new Map<number, ClipKeyframeTimeGroup>();

  keyframes.forEach((keyframe) => {
    const bucket = Math.round(keyframe.time * 1000000) / 1000000;
    const group = groups.get(bucket);
    if (group) {
      group.keyframeIds.push(keyframe.id);
      group.properties = [...(group.properties ?? []), keyframe.property];
      group.hasStateChange = group.hasStateChange || Boolean(parseVectorAnimationStateProperty(keyframe.property));
      return;
    }

    groups.set(bucket, {
      time: keyframe.time,
      keyframeIds: [keyframe.id],
      properties: [keyframe.property],
      hasStateChange: Boolean(parseVectorAnimationStateProperty(keyframe.property)),
    });
  });

  return [...groups.values()].sort((a, b) => a.time - b.time);
};

// Render keyframe tracks for timeline area (right column) - flat list without folder structure
function TrackPropertyTracks({
  trackId,
  selectedClip,
  clipKeyframes,
  renderKeyframeDiamonds,
  expandedCurveProperties,
  activeTimelineToolId,
  selectedKeyframeIds,
  onSelectKeyframe,
  onMoveKeyframe,
  onUpdateBezierHandle,
  applyTimelineEditOperation,
  addKeyframe,
  timeToPixel,
  pixelToTime,
}: {
  trackId: string;
  selectedClip: KeyframeTrackClip | null;
  clipKeyframes: Map<string, Array<{ id: string; clipId: string; time: number; property: AnimatableProperty; value: number; easing: string }>>;
  renderKeyframeDiamonds: (trackId: string, property: AnimatableProperty) => React.ReactNode;
  expandedCurveProperties: Map<string, Set<AnimatableProperty>>;
  activeTimelineToolId: TimelineTrackProps['activeTimelineToolId'];
  selectedKeyframeIds: Set<string>;
  onSelectKeyframe: (keyframeId: string, addToSelection: boolean) => void;
  onMoveKeyframe: (keyframeId: string, newTime: number) => void;
  onUpdateBezierHandle: (keyframeId: string, handle: 'in' | 'out', position: BezierHandle) => void;
  applyTimelineEditOperation?: TimelineTrackProps['applyTimelineEditOperation'];
  addKeyframe: (clipId: string, property: AnimatableProperty, value: number, time?: number, easing?: string | null) => void;
  timeToPixel: (time: number) => number;
  pixelToTime: (pixel: number) => number;
}) {
  const clipId = selectedClip?.id;
  const curveTransactionCounterRef = useRef(0);
  const curveKeyframeTransactionRef = useRef<{
    transactionId: string;
    historyBatchId: string;
    clipId: string;
    property: AnimatableProperty;
    keyframeId: string;
    originalTime: number;
    originalValue: number;
    hasUpdate: boolean;
  } | null>(null);
  const curveBezierTransactionRef = useRef<{
    transactionId: string;
    historyBatchId: string;
    clipId: string;
    property: AnimatableProperty;
    keyframeId: string;
    handle: 'in' | 'out';
    hasUpdate: boolean;
  } | null>(null);

  // Get keyframes for this clip - use clipKeyframes map to trigger re-render when keyframes change
  const keyframeProperties = useMemo(() => {
    if (!clipId) return new Set<string>();
    const props = new Set<string>();
    const keyframes = clipKeyframes.get(clipId) || [];
    keyframes.forEach((kf) => props.add(kf.property));
    // Hide 3D-only properties (rotation X/Y, position Z, scale Z) when clip is not 3D
    if (shouldHide3DOnlyProperties(selectedClip)) {
      props.delete('rotation.x');
      props.delete('rotation.y');
      props.delete('position.z');
      props.delete('scale.z');
    }
    return props;
  }, [clipId, clipKeyframes, selectedClip]);

  // Track container ref for getting width
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(1000);
  const allKeyframes = useMemo(
    () => (clipId ? (clipKeyframes.get(clipId) ?? []) as Keyframe[] : []),
    [clipId, clipKeyframes],
  );

  // Measure container width
  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.clientWidth);
      }
    };
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  const findCurveKeyframe = useCallback(
    (keyframeId: string) => allKeyframes.find((keyframe) => keyframe.id === keyframeId),
    [allKeyframes],
  );

  const nextCurveTransactionId = useCallback((kind: string, keyframeId: string) => {
    curveTransactionCounterRef.current += 1;
    return `curve-editor:${kind}:${keyframeId}:${curveTransactionCounterRef.current}`;
  }, []);

  const handleCurveKeyframeMove = useCallback((
    keyframeId: string,
    newTime: number,
    newValue: number,
    phase?: CurveEditorEditPhase,
  ) => {
    const target = findCurveKeyframe(keyframeId);
    if (!applyTimelineEditOperation) {
      if (phase === undefined || phase === 'update') {
        onMoveKeyframe(keyframeId, newTime);
      }
      return;
    }
    if (!target) {
      const clearedSession = curveKeyframeTransactionRef.current?.keyframeId === keyframeId;
      if (curveKeyframeTransactionRef.current?.keyframeId === keyframeId) {
        curveKeyframeTransactionRef.current = null;
      }
      if (clearedSession || phase !== 'update') {
        log.warn('Skipped curve keyframe edit for missing typed target', {
          keyframeId,
          phase: phase ?? 'single',
        });
      }
      return;
    }

    const ensureSession = () => {
      const existing = curveKeyframeTransactionRef.current;
      if (existing?.keyframeId === keyframeId) return existing;

      const transactionId = nextCurveTransactionId('keyframe', keyframeId);
      const session = {
        transactionId,
        historyBatchId: `${transactionId}:history`,
        clipId: target.clipId,
        property: target.property,
        keyframeId,
        originalTime: target.time,
        originalValue: target.value,
        hasUpdate: false,
      };
      curveKeyframeTransactionRef.current = session;
      applyTimelineEditOperation({
        id: `${transactionId}:begin`,
        type: 'keyframe-transaction-begin',
        transactionId,
        historyBatchId: session.historyBatchId,
        source: 'ui',
        phase: 'begin',
        clipId: target.clipId,
        property: target.property,
        keyframeIds: [keyframeId],
        intent: 'curve-editor',
      }, {
        source: 'ui',
        historyLabel: 'Begin curve keyframe edit',
      });
      return session;
    };

    const session = ensureSession();
    if (phase === 'begin') return;
    if (phase === 'commit' && !session.hasUpdate) {
      curveKeyframeTransactionRef.current = null;
      return;
    }

    const operations = [
      {
        type: 'keyframe-move' as const,
        keyframeId,
        clipId: session.clipId,
        property: session.property,
        originalTime: session.originalTime,
        requestedTime: newTime,
        resolvedTime: newTime,
      },
      {
        type: 'keyframe-update-value' as const,
        keyframeId,
        clipId: session.clipId,
        property: session.property,
        value: { value: newValue },
      },
    ];

    if (phase === 'commit') {
      applyTimelineEditOperation({
        id: `${session.transactionId}:commit:${newTime.toFixed(6)}:${newValue.toFixed(6)}`,
        type: 'keyframe-transaction-commit',
        transactionId: session.transactionId,
        historyBatchId: session.historyBatchId,
        source: 'ui',
        phase: 'commit',
        clipId: session.clipId,
        property: session.property,
        keyframeIds: [keyframeId],
        operations,
      }, {
        source: 'ui',
        historyLabel: 'Edit curve keyframe',
      });
      curveKeyframeTransactionRef.current = null;
      return;
    }

    session.hasUpdate = true;
    applyTimelineEditOperation({
      id: `${session.transactionId}:update:${newTime.toFixed(6)}:${newValue.toFixed(6)}`,
      type: 'keyframe-transaction-update',
      transactionId: session.transactionId,
      historyBatchId: session.historyBatchId,
      source: 'ui',
      phase: 'update',
      clipId: session.clipId,
      property: session.property,
      keyframeIds: [keyframeId],
      operations,
    }, {
      source: 'ui',
      historyLabel: 'Edit curve keyframe',
      deferHistoryCommit: true,
    });
  }, [applyTimelineEditOperation, findCurveKeyframe, nextCurveTransactionId, onMoveKeyframe]);

  const handleCurveBezierHandleUpdate = useCallback((
    keyframeId: string,
    handle: 'in' | 'out',
    position: BezierHandle,
    phase?: CurveEditorEditPhase,
  ) => {
    const target = findCurveKeyframe(keyframeId);
    if (!applyTimelineEditOperation) {
      if (phase === undefined || phase === 'update') {
        onUpdateBezierHandle(keyframeId, handle, position);
      }
      return;
    }
    if (!target) {
      const existing = curveBezierTransactionRef.current;
      const clearedSession = existing?.keyframeId === keyframeId && existing.handle === handle;
      if (existing?.keyframeId === keyframeId && existing.handle === handle) {
        curveBezierTransactionRef.current = null;
      }
      if (clearedSession || phase !== 'update') {
        log.warn('Skipped curve bezier handle edit for missing typed target', {
          keyframeId,
          handle,
          phase: phase ?? 'single',
        });
      }
      return;
    }

    const buildOperation = (session: {
      transactionId: string;
      historyBatchId: string;
      clipId: string;
      property: AnimatableProperty;
      keyframeId: string;
    }) => ({
      type: 'keyframe-update-bezier-handle' as const,
      keyframeId: session.keyframeId,
      clipId: session.clipId,
      property: session.property,
      handle,
      position,
    });

    if (phase === undefined) {
      const transactionId = nextCurveTransactionId(`bezier-${handle}`, keyframeId);
      applyTimelineEditOperation({
        id: `${transactionId}:commit`,
        type: 'keyframe-transaction-commit',
        transactionId,
        historyBatchId: `${transactionId}:history`,
        source: 'ui',
        phase: 'commit',
        clipId: target.clipId,
        property: target.property,
        keyframeIds: [keyframeId],
        operations: [buildOperation({
          transactionId,
          historyBatchId: `${transactionId}:history`,
          clipId: target.clipId,
          property: target.property,
          keyframeId,
        })],
      }, {
        source: 'ui',
        historyLabel: 'Edit bezier handle',
      });
      return;
    }

    const ensureSession = () => {
      const existing = curveBezierTransactionRef.current;
      if (existing?.keyframeId === keyframeId && existing.handle === handle) return existing;

      const transactionId = nextCurveTransactionId(`bezier-${handle}`, keyframeId);
      const session = {
        transactionId,
        historyBatchId: `${transactionId}:history`,
        clipId: target.clipId,
        property: target.property,
        keyframeId,
        handle,
        hasUpdate: false,
      };
      curveBezierTransactionRef.current = session;
      applyTimelineEditOperation({
        id: `${transactionId}:begin`,
        type: 'keyframe-transaction-begin',
        transactionId,
        historyBatchId: session.historyBatchId,
        source: 'ui',
        phase: 'begin',
        clipId: target.clipId,
        property: target.property,
        keyframeIds: [keyframeId],
        intent: 'curve-editor',
      }, {
        source: 'ui',
        historyLabel: 'Begin bezier handle edit',
      });
      return session;
    };

    const session = ensureSession();
    if (phase === 'begin') return;
    if (phase === 'commit' && !session.hasUpdate) {
      curveBezierTransactionRef.current = null;
      return;
    }

    const operation = buildOperation(session);
    if (phase === 'commit') {
      applyTimelineEditOperation({
        id: `${session.transactionId}:commit`,
        type: 'keyframe-transaction-commit',
        transactionId: session.transactionId,
        historyBatchId: session.historyBatchId,
        source: 'ui',
        phase: 'commit',
        clipId: session.clipId,
        property: session.property,
        keyframeIds: [keyframeId],
        operations: [operation],
      }, {
        source: 'ui',
        historyLabel: 'Edit bezier handle',
      });
      curveBezierTransactionRef.current = null;
      return;
    }

    session.hasUpdate = true;
    applyTimelineEditOperation({
      id: `${session.transactionId}:update:${position.x.toFixed(6)}:${position.y.toFixed(6)}`,
      type: 'keyframe-transaction-update',
      transactionId: session.transactionId,
      historyBatchId: session.historyBatchId,
      source: 'ui',
      phase: 'update',
      clipId: session.clipId,
      property: session.property,
      keyframeIds: [keyframeId],
      operations: [operation],
    }, {
      source: 'ui',
      historyLabel: 'Edit bezier handle',
      deferHistoryCommit: true,
    });
  }, [applyTimelineEditOperation, findCurveKeyframe, nextCurveTransactionId, onUpdateBezierHandle]);

  // If no clip is selected in this track or no keyframes, show nothing
  if (!selectedClip || keyframeProperties.size === 0) {
    return <div className="track-property-tracks" ref={containerRef} />;
  }

  // Convert Set to sorted array for consistent ordering (matching the labels)
  const sortedProperties = Array.from(keyframeProperties).sort((a, b) => {
    const order = getTransformPropertyOrder(selectedClip);
    const aIdx = order.indexOf(a);
    const bIdx = order.indexOf(b);
    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
    if (aIdx !== -1) return -1;
    if (bIdx !== -1) return 1;
    const aLottieState = parseVectorAnimationStateProperty(a);
    const bLottieState = parseVectorAnimationStateProperty(b);
    if (aLottieState && bLottieState) return 0;
    if (aLottieState) return -1;
    if (bLottieState) return 1;
    const aLottieInput = parseVectorAnimationInputProperty(a);
    const bLottieInput = parseVectorAnimationInputProperty(b);
    if (aLottieInput && bLottieInput) return aLottieInput.inputName.localeCompare(bLottieInput.inputName);
    if (aLottieInput) return -1;
    if (bLottieInput) return 1;
    return a.localeCompare(b);
  });

  // Get expanded curve properties for this track
  const trackCurveProps = expandedCurveProperties.get(trackId);

  const resolvePenKeyframeValue = (
    keyframes: Array<{ time: number; value: number }>,
    time: number,
  ): number => {
    const sorted = keyframes.toSorted((a, b) => a.time - b.time);
    if (sorted.length === 0) return 0;
    if (time <= sorted[0].time) return sorted[0].value;
    const last = sorted[sorted.length - 1];
    if (time >= last.time) return last.value;

    for (let index = 1; index < sorted.length; index += 1) {
      const next = sorted[index];
      if (time > next.time) continue;
      const previous = sorted[index - 1];
      const span = Math.max(EPSILON, next.time - previous.time);
      const progress = Math.max(0, Math.min(1, (time - previous.time) / span));
      return previous.value + (next.value - previous.value) * progress;
    }

    return last.value;
  };

  const handlePenKeyframeMouseDown = (
    event: React.MouseEvent<HTMLDivElement>,
    property: AnimatableProperty,
    propertyKeyframes: Array<{ time: number; value: number }>,
  ) => {
    if (activeTimelineToolId !== 'pen-keyframe') return;
    if (event.button !== 0 || !selectedClip) return;

    event.preventDefault();
    event.stopPropagation();

    const rect = event.currentTarget.getBoundingClientRect();
    const absoluteTime = pixelToTime(event.clientX - rect.left);
    const localTime = Math.max(0, Math.min(selectedClip.duration, absoluteTime - selectedClip.startTime));
    const value = resolvePenKeyframeValue(propertyKeyframes, localTime);
    addKeyframe(selectedClip.id, property, value, localTime, 'linear');
  };

  return (
    <div className="track-property-tracks" ref={containerRef}>
      {sortedProperties.map((prop) => {
        const isCurveExpanded = trackCurveProps?.has(prop as AnimatableProperty) ?? false;
        const propKeyframes = allKeyframes.filter(kf => kf.property === prop);

        return (
          <div
            key={prop}
            className={`keyframe-track-row flat ${isCurveExpanded ? 'curve-expanded' : ''}`}
            data-track-id={trackId}
            data-keyframe-property={prop}
          >
            <div
              className="keyframe-track"
              onMouseDown={(event) => handlePenKeyframeMouseDown(event, prop as AnimatableProperty, propKeyframes)}
            >
              <div className="keyframe-track-line" />
              {renderKeyframeDiamonds(trackId, prop as AnimatableProperty)}
            </div>
            {isCurveExpanded && (
              <CurveEditor
                trackId={trackId}
                clipId={selectedClip.id}
                property={prop as AnimatableProperty}
                keyframes={propKeyframes as Keyframe[]}
                clipStartTime={selectedClip.startTime}
                clipDuration={selectedClip.duration}
                width={containerWidth}
                selectedKeyframeIds={selectedKeyframeIds}
                onSelectKeyframe={onSelectKeyframe}
                onMoveKeyframe={handleCurveKeyframeMove}
                onUpdateBezierHandle={handleCurveBezierHandleUpdate}
                timeToPixel={timeToPixel}
                pixelToTime={pixelToTime}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function TimelineTrackComponent({
  track,
  trackColor,
  clips,
  isDimmed,
  isExpanded,
  baseHeight,
  dynamicHeight,
  isDragTarget,
  isExternalDragTarget,
  selectedClipIds,
  selectedKeyframeIds,
  activeTimelineToolId,
  waveformsEnabled,
  audioDisplayMode,
  clipDrag,
  clipDragPreview,
  clipTrim,
  clipFade,
  clipContextMenu,
  audioRegionSelection,
  audioRegionGainPreview,
  audioSpectralRegionSelection,
  videoBakeRegionSelection,
  clipStemSeparationJobs,
  externalDrag,
  onEmptyMouseDown,
  onEmptyContextMenu,
  onDrop,
  onDragOver,
  onDragEnter,
  onDragLeave,
  onResizeStart,
  isResizeActive = false,
  onTrimStart,
  onFadeStart,
  onClipMouseDown,
  onClipDoubleClick,
  onClipContextMenu,
  clipKeyframes,
  renderKeyframeDiamonds,
  timeToPixel,
  pixelToTime,
  zoom,
  scrollX,
  expandedCurveProperties,
  onSelectKeyframe,
  onMoveKeyframe,
  onMoveKeyframeGroup,
  applyTimelineEditOperation,
  onUpdateBezierHandle,
  addKeyframe,
}: TimelineTrackProps) {
  // Deduplicate by clip id so transient store/render races do not produce duplicate React keys.
  const allTrackClips = useMemo(() => {
    const uniqueClips = new Map<string, typeof clips[number]>();
    clips.forEach((clip) => {
      if (clip.trackId !== track.id || uniqueClips.has(clip.id)) return;
      uniqueClips.set(clip.id, clip);
    });
    return Array.from(uniqueClips.values());
  }, [clips, track.id]);
  const clipFadeClipId = clipFade?.clipId ?? null;
  const clipRowRef = useRef<HTMLDivElement>(null);
  const [measuredViewportWidth, setMeasuredViewportWidth] = useState(TRACK_VIEWPORT_FALLBACK_PX);
  const keyframeTickTransactionRef = useRef<{
    transactionId: string;
    historyBatchId: string;
    clipId: string;
    property?: AnimatableProperty;
    keyframeIds: string[];
    originalTimes: Map<string, number>;
    hasUpdate: boolean;
  } | null>(null);
  const keyframeTickTransactionCounterRef = useRef(0);

  useEffect(() => {
    const row = clipRowRef.current;
    if (!row) return;

    const updateViewportWidth = () => {
      const nextWidth = Math.max(
        1,
        Math.ceil(row.clientWidth || row.getBoundingClientRect().width || TRACK_VIEWPORT_FALLBACK_PX),
      );
      setMeasuredViewportWidth((previous) => (previous === nextWidth ? previous : nextWidth));
    };

    updateViewportWidth();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(updateViewportWidth);
      observer.observe(row);
      return () => observer.disconnect();
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', updateViewportWidth);
      return () => window.removeEventListener('resize', updateViewportWidth);
    }
  }, []);

  const viewportWidth = measuredViewportWidth;
  const visibleStartTime = Math.max(0, (scrollX - TRACK_RENDER_OVERSCAN_PX) / Math.max(zoom, 0.001));
  const visibleEndTime = (scrollX + viewportWidth + TRACK_RENDER_OVERSCAN_PX) / Math.max(zoom, 0.001);
  const trackClips = useMemo(() => {
    const draggedClipIds = new Set<string>();
    if (clipDrag) {
      draggedClipIds.add(clipDrag.clipId);
      clipDrag.multiSelectClipIds?.forEach((clipId) => draggedClipIds.add(clipId));
    }

    return allTrackClips.filter((clip) => {
      // Only clips in an active drag/trim gesture bypass viewport culling — they
      // move beyond their static viewport position while the gesture is in flight.
      // Selection alone must NOT force-render: an off-screen selected clip needs no
      // DOM (its selection is restored when scrolled into view). Forcing selected
      // clips defeated culling entirely on select-all of a large comp (issue #228).
      if (draggedClipIds.has(clip.id) || clipTrim?.clipId === clip.id || clipFadeClipId === clip.id) {
        return true;
      }
      const clipStart = clip.startTime;
      const clipEnd = clip.startTime + clip.duration;
      return clipEnd >= visibleStartTime && clipStart <= visibleEndTime;
    });
  }, [allTrackClips, clipDrag, clipFadeClipId, clipTrim?.clipId, visibleEndTime, visibleStartTime]);
  const trackClipIds = useMemo(() => new Set(allTrackClips.map((clip) => clip.id)), [allTrackClips]);
  const clipContextMenuClipId = clipContextMenu?.clipId ?? null;
  const [hoveredClipId, setHoveredClipId] = useState<string | null>(null);
  const clipShellKeyframeStateByClipId = useMemo(() => {
    const stateByClipId = new Map<string, {
      keyframes: Keyframe[];
      keyframeGroups: ClipKeyframeTimeGroup[];
      selectedKeyframeIds: string[];
      activeProperty?: AnimatableProperty;
    }>();

    allTrackClips.forEach((clip) => {
      const keyframes = (clipKeyframes.get(clip.id) ?? []) as Keyframe[];
      if (keyframes.length === 0) return;

      const selectedKeyframes = keyframes.filter((keyframe) => selectedKeyframeIds.has(keyframe.id));
      if (clip.id !== hoveredClipId && selectedKeyframes.length === 0) return;

      stateByClipId.set(clip.id, {
        keyframes,
        keyframeGroups: getClipShellKeyframeGroups(keyframes),
        selectedKeyframeIds: selectedKeyframes.map((keyframe) => keyframe.id),
        activeProperty: selectedKeyframes[0]?.property,
      });
    });

    return stateByClipId;
  }, [allTrackClips, clipKeyframes, hoveredClipId, selectedKeyframeIds]);
  const clipShellSpecialStateByClipId = useMemo(() => {
    const stateByClipId = new Map<string, {
      audioRegionActive: boolean;
      spectralRegionActive: boolean;
      videoBakeActive: boolean;
      stemActive: boolean;
      stemJob?: TimelineTrackProps['clipStemSeparationJobs'][string];
    }>();

    allTrackClips.forEach((clip) => {
      const audioRegionActive =
        audioRegionSelection?.clipId === clip.id ||
        audioRegionGainPreview?.clipId === clip.id;
      const spectralLayers = clip.audioState?.spectralLayers ?? [];
      const spectralRegionActive =
        audioSpectralRegionSelection?.clipId === clip.id ||
        (
          audioDisplayMode === 'spectral' &&
          spectralLayers.some((layer) => layer.enabled !== false && layer.duration > 0)
        );
      const videoBakeRegions = clip.videoState?.bakeRegions ?? [];
      const videoBakeActive =
        (
          videoBakeRegionSelection?.scope === 'clip' &&
          videoBakeRegionSelection.clipId === clip.id
        ) ||
        videoBakeRegions.length > 0;
      const stemJob =
        clipStemSeparationJobs[clip.id] ??
        (clip.linkedClipId ? clipStemSeparationJobs[clip.linkedClipId] : undefined);
      const stemActive = Boolean(stemJob) || (
        hoveredClipId === clip.id &&
        Boolean(clip.audioState?.stemSeparation)
      );

      if (!audioRegionActive && !spectralRegionActive && !videoBakeActive && !stemActive) return;

      stateByClipId.set(clip.id, {
        audioRegionActive,
        spectralRegionActive,
        videoBakeActive,
        stemActive,
        stemJob,
      });
    });

    return stateByClipId;
  }, [
    allTrackClips,
    audioRegionSelection,
    audioRegionGainPreview,
    audioSpectralRegionSelection,
    audioDisplayMode,
    videoBakeRegionSelection,
    clipStemSeparationJobs,
    hoveredClipId,
  ]);
  // issue #228: draw clip bodies on a viewport-sliced canvas per track instead
  // of one DOM node per clip. The canvas backing store no longer scales with
  // total timeline width, so high zoom does not need a visible legacy DOM fallback.
  const trackContentWidth = useMemo(() => {
    let max = 0;
    for (const clip of allTrackClips) {
      const end = timeToPixel(clip.startTime + clip.duration);
      if (end > max) max = end;
    }
    return max;
  }, [allTrackClips, timeToPixel]);
  // The track has a single visible renderer: TimelineClipCanvas. DOM nodes are
  // mounted only as invisible interaction shells for the clip under the cursor or
  // an active gesture. They must never replace the visible canvas body, otherwise
  // thumbnails/waveforms visibly switch between two renderers.
  const domControlClipIds = useMemo(() => {
    const ids = new Set<string>();
    if (hoveredClipId) ids.add(hoveredClipId);
    if (clipDrag) {
      ids.add(clipDrag.clipId);
      clipDrag.multiSelectClipIds?.forEach((id) => ids.add(id));
    }
    if (clipTrim?.clipId) ids.add(clipTrim.clipId);
    if (clipFadeClipId && trackClipIds.has(clipFadeClipId)) ids.add(clipFadeClipId);
    if (clipContextMenuClipId && trackClipIds.has(clipContextMenuClipId)) ids.add(clipContextMenuClipId);
    trackClips.forEach((clip) => {
      if (clipShellKeyframeStateByClipId.has(clip.id)) ids.add(clip.id);
      if (clipShellSpecialStateByClipId.has(clip.id)) ids.add(clip.id);
    });
    return ids;
  }, [
    hoveredClipId,
    clipDrag,
    clipTrim,
    clipFadeClipId,
    clipContextMenuClipId,
    trackClipIds,
    trackClips,
    clipShellKeyframeStateByClipId,
    clipShellSpecialStateByClipId,
  ]);
  const getClipFadeVisualState = useCallback((clip: typeof allTrackClips[number]): ClipFadeVisualState => {
    const clipDuration = Math.max(0.001, clip.duration);
    const keyframes = (clipKeyframes.get(clip.id) ?? []) as Keyframe[];
    const isAudioClip = track.type === 'audio';
    const curveKeyframes: readonly FadeCurveKeyframe[] = isAudioClip
      ? resolveAudioVolumeAutomationCurveKeyframes({
        keyframes,
        legacyEffects: clip.effects,
        audioEffectStack: clip.audioState?.effectStack,
        clipDuration,
      })
      : keyframes
        .filter((keyframe) => keyframe.property === 'opacity')
        .map((keyframe) => ({
          id: keyframe.id,
          time: keyframe.time,
          value: keyframe.value,
          easing: keyframe.easing,
          handleIn: keyframe.handleIn,
          handleOut: keyframe.handleOut,
        }));

    return {
      keyframes: curveKeyframes,
      clipDuration,
      isAudioClip,
      fadeInDuration: getFadeInDurationFromCurveKeyframes(curveKeyframes),
      fadeOutDuration: getFadeOutDurationFromCurveKeyframes(curveKeyframes, clipDuration),
      curveKey: getFadeCurveKey(curveKeyframes),
    };
  }, [clipKeyframes, track.type]);
  const canvasClips = useMemo(() => {
    const nextClips = new Map(allTrackClips.map((clip) => [clip.id, clip]));

    if (clipDragPreview) {
      for (const clip of clips) {
        const patch = clipDragPreview.patches[clip.id];
        if (!patch) continue;
        const patchTrackId = patch.trackId ?? clip.trackId;
        if (patchTrackId === track.id && !nextClips.has(clip.id)) {
          nextClips.set(clip.id, clip);
        }
      }
    } else if (clipDrag && clipDrag.currentTrackId === track.id) {
      const draggedClip = clips.find((clip) => clip.id === clipDrag.clipId);
      if (draggedClip && !nextClips.has(draggedClip.id)) {
        nextClips.set(draggedClip.id, draggedClip);
      }
    }

    return Array.from(nextClips.values()).map((clip) => {
      const fade = getClipFadeVisualState(clip);
      return {
        ...clip,
        trackType: track.type,
        ...(fade.keyframes.length >= 2 ? { fade } : {}),
      };
    });
  }, [clipDrag, clipDragPreview, track.id, track.type, allTrackClips, clips, getClipFadeVisualState]);
  const canvasContentWidth = useMemo(() => {
    let max = trackContentWidth;
    for (const clip of canvasClips) {
      const end = timeToPixel(clip.startTime + clip.duration);
      if (end > max) max = end;
    }
    if (clipTrim) {
      const clip = canvasClips.find((candidate) => candidate.id === clipTrim.clipId);
      if (clip) {
        const sourceType = clip.source?.type;
        const sourceDuration = getCanvasClipSourceDuration(clip);
        let previewEnd = clip.startTime + clip.duration;
        let sourceExtensionEnd = previewEnd;

        if (clipTrim.edge === 'right') {
          const maxExtend = isInfiniteTimelineSourceType(sourceType) ||
            (
              isVectorAnimationSourceType(sourceType) &&
              shouldLoopVectorAnimation(clip.source?.vectorAnimationSettings)
            )
            ? Number.MAX_SAFE_INTEGER
            : sourceDuration - clipTrim.originalOutPoint;
          const minTrim = -(clipTrim.originalDuration - MIN_CLIP_DURATION);
          const clampedDelta = Math.max(minTrim, Math.min(maxExtend, clipTrim.appliedDelta));
          const previewDuration = Math.max(0.001, clipTrim.originalDuration + clampedDelta);
          const previewOutPoint = clipTrim.originalOutPoint + clampedDelta;
          previewEnd = clipTrim.originalStartTime + previewDuration;
          sourceExtensionEnd = previewEnd + Math.max(0, sourceDuration - previewOutPoint);
        } else {
          const minTrim = isInfiniteTimelineSourceType(sourceType)
            ? -clipTrim.originalStartTime
            : -clipTrim.originalInPoint;
          const maxTrim = clipTrim.originalDuration - MIN_CLIP_DURATION;
          const clampedDelta = Math.max(minTrim, Math.min(maxTrim, clipTrim.appliedDelta));
          previewEnd = clipTrim.originalStartTime + clampedDelta + Math.max(0.001, clipTrim.originalDuration - clampedDelta);
          sourceExtensionEnd = previewEnd;
        }

        if (Number.isFinite(previewEnd)) {
          max = Math.max(max, timeToPixel(previewEnd));
        }
        if (Number.isFinite(sourceExtensionEnd)) {
          max = Math.max(max, timeToPixel(sourceExtensionEnd));
        }
      }
    }
    return max;
  }, [canvasClips, clipTrim, timeToPixel, trackContentWidth]);
  const domControlClips = useMemo(
    () => canvasClips.filter((clip) => domControlClipIds.has(clip.id)),
    [canvasClips, domControlClipIds],
  );
  useEffect(() => {
    return () => {
      unregisterTimelineCanvasTrackDiagnostics(track.id);
    };
  }, [track.id]);

  useEffect(() => {
    const activeShellSlotCounts: Partial<Record<ClipInteractionShellModuleSlot, number>> = {};
    const countSlot = (slot: ClipInteractionShellModuleSlot) => {
      activeShellSlotCounts[slot] = (activeShellSlotCounts[slot] ?? 0) + 1;
    };

    domControlClips.forEach((clip) => {
      if (clipTrim?.clipId === clip.id) countSlot('trim');
      if (clipFade?.clipId === clip.id) countSlot('fade');
      if (clipShellKeyframeStateByClipId.has(clip.id)) countSlot('keyframe');
      if (clipContextMenu?.clipId === clip.id) countSlot('context-menu');
      const specialState = clipShellSpecialStateByClipId.get(clip.id);
      if (specialState?.audioRegionActive) countSlot('audio-region');
      if (specialState?.spectralRegionActive) countSlot('spectral-region');
      if (specialState?.videoBakeActive) countSlot('video-bake');
      if (specialState?.stemActive) countSlot('stem');
    });

    reportTimelineCanvasDomDiagnostics(track.id, {
      domOverlayCount: domControlClips.length,
      domClipBodyCount: 0,
      shellCount: domControlClips.length,
      activeShellSlotCounts,
    });
  }, [
    track.id,
    domControlClips,
    clipTrim,
    clipFade,
    clipContextMenu,
    clipShellKeyframeStateByClipId,
    clipShellSpecialStateByClipId,
  ]);
  const getClipShellMountState = (clipId: string): ClipInteractionShellMountState => {
    const reasons: ClipInteractionShellMountReason[] = [];
    if (hoveredClipId === clipId) reasons.push('hover');
    if (clipDrag?.clipId === clipId) reasons.push('drag');
    if (clipDrag?.multiSelectClipIds?.includes(clipId)) reasons.push('multi-drag');
    if (clipTrim?.clipId === clipId) reasons.push('trim');
    if (clipFade?.clipId === clipId) reasons.push('fade');
    if (clipContextMenu?.clipId === clipId) reasons.push('context-menu-open');
    const keyframeState = clipShellKeyframeStateByClipId.get(clipId);
    if (keyframeState) reasons.push('selected-keyframes');
    const specialState = clipShellSpecialStateByClipId.get(clipId);
    if (specialState?.audioRegionActive) reasons.push('audio-region-active');
    if (specialState?.spectralRegionActive) reasons.push('spectral-region-active');
    if (specialState?.videoBakeActive) reasons.push('video-bake-active');
    if (specialState?.stemActive) reasons.push('stem-active');

    return {
      clipId,
      shouldMount: reasons.length > 0,
      reasons,
      isHovered: hoveredClipId === clipId,
      isDragging: clipDrag?.clipId === clipId,
      isMultiDragging: clipDrag?.multiSelectClipIds?.includes(clipId) ?? false,
      isTrimming: clipTrim?.clipId === clipId,
      isFading: clipFade?.clipId === clipId,
      hasOpenContextMenu: clipContextMenu?.clipId === clipId,
      hasVisibleKeyframes: Boolean(keyframeState),
      hasActiveAudioRegion: specialState?.audioRegionActive,
      hasActiveSpectralRegion: specialState?.spectralRegionActive,
      hasActiveVideoBakeRegion: specialState?.videoBakeActive,
      hasActiveStemControls: specialState?.stemActive,
    };
  };
  const getClipShellGeometry = (clip: typeof clips[number]): ClipInteractionShellGeometry => {
    const left = timeToPixel(clip.startTime);
    const width = Math.max(1, timeToPixel(clip.duration));
    const top = CLIP_SHELL_VERTICAL_INSET_PX;
    const height = Math.max(1, baseHeight - CLIP_SHELL_VERTICAL_INSET_PX * 2);
    const clipRect = createShellRect(left, top, width, height);
    const viewportRect = createShellRect(scrollX, 0, viewportWidth, baseHeight);
    const handleHeight = height;
    const fade = getClipFadeVisualState(clip);
    const fadeInPx = Math.max(0, Math.min(width, timeToPixel(fade.fadeInDuration)));
    const fadeOutPx = Math.max(0, Math.min(width, timeToPixel(fade.fadeOutDuration)));
    const fadeHandleOffset = CLIP_SHELL_FADE_HANDLE_SIZE_PX / 2;
    const leftFadeHandleX = left + (fade.fadeInDuration > 0 ? fadeInPx - fadeHandleOffset : 0);
    const rightFadeHandleX = left + width - (
      fade.fadeOutDuration > 0
        ? fadeOutPx + fadeHandleOffset
        : CLIP_SHELL_FADE_HANDLE_SIZE_PX
    );

    return {
      clip: clipRect,
      visibleClip: clampShellRectX(clipRect, viewportRect),
      track: createShellRect(0, 0, canvasContentWidth, baseHeight),
      viewport: viewportRect,
      trimHandles: {
        left: createShellRect(left - CLIP_SHELL_HANDLE_WIDTH_PX / 2, top, CLIP_SHELL_HANDLE_WIDTH_PX, handleHeight),
        right: createShellRect(left + width - CLIP_SHELL_HANDLE_WIDTH_PX / 2, top, CLIP_SHELL_HANDLE_WIDTH_PX, handleHeight),
      },
      fadeHandles: {
        left: createShellRect(leftFadeHandleX, top, CLIP_SHELL_FADE_HANDLE_SIZE_PX, CLIP_SHELL_FADE_HANDLE_SIZE_PX),
        right: createShellRect(rightFadeHandleX, top, CLIP_SHELL_FADE_HANDLE_SIZE_PX, CLIP_SHELL_FADE_HANDLE_SIZE_PX),
      },
      keyframeRows: [],
    };
  };
  const getClipShellActiveModules = (clip: typeof clips[number]): ClipInteractionShellActiveModules => {
    const clipId = clip.id;
    const keyframeState = clipShellKeyframeStateByClipId.get(clipId);
    const specialState = clipShellSpecialStateByClipId.get(clipId);
    const audioRegionGainActive = audioRegionGainPreview?.clipId === clipId;
    const isTrimGestureActive = clipTrim?.clipId === clipId;
    const isFadeGestureActive = clipFade?.clipId === clipId;
    const canShowEditHandles = !track.locked && (hoveredClipId === clipId || isTrimGestureActive || isFadeGestureActive);
    const fadeVisualState = getClipFadeVisualState(clip);
    const selectedStemKind = clip.audioState?.stemSeparation?.stems
      .find((stem) => stem.id === clip.audioState?.stemSeparation?.soloStemId)
      ?.kind;

    return {
      trim: {
        enabled: canShowEditHandles,
        slot: 'trim',
        state: isTrimGestureActive ? clipTrim : null,
        activeEdges: isTrimGestureActive ? [clipTrim.edge] : [],
      },
      fade: {
        enabled: canShowEditHandles,
        slot: 'fade',
        state: isFadeGestureActive ? clipFade : null,
        activeEdges: isFadeGestureActive ? [clipFade.edge] : [],
        fadeInDuration: fadeVisualState.fadeInDuration,
        fadeOutDuration: fadeVisualState.fadeOutDuration,
        curveKeyframes: fadeVisualState.keyframes,
        curveKey: fadeVisualState.curveKey,
        clipDuration: fadeVisualState.clipDuration,
        isAudioClip: fadeVisualState.isAudioClip,
      },
      keyframe: {
        enabled: Boolean(keyframeState),
        slot: 'keyframe',
        activeProperty: keyframeState?.activeProperty,
        keyframes: keyframeState?.keyframes ?? [],
        keyframeGroups: keyframeState?.keyframeGroups ?? [],
        selectedKeyframeIds: keyframeState?.selectedKeyframeIds ?? [],
      },
      audioRegion: {
        enabled: specialState?.audioRegionActive === true,
        slot: 'audio-region',
        selection: audioRegionSelection?.clipId === clipId ? audioRegionSelection : null,
        mode: audioRegionGainActive ? 'gain' : 'select',
        gainPreviewDb: audioRegionGainActive ? audioRegionGainPreview.gainDb : undefined,
      },
      spectralRegion: {
        enabled: specialState?.spectralRegionActive === true,
        slot: 'spectral-region',
        selection: audioSpectralRegionSelection?.clipId === clipId ? audioSpectralRegionSelection : null,
        imageLayers: clip.audioState?.spectralLayers ?? [],
      },
      videoBake: {
        enabled: specialState?.videoBakeActive === true,
        slot: 'video-bake',
        selection: (
          videoBakeRegionSelection?.scope === 'clip' &&
          videoBakeRegionSelection.clipId === clipId
        ) ? videoBakeRegionSelection : null,
        regions: clip.videoState?.bakeRegions ?? [],
      },
      stem: {
        enabled: specialState?.stemActive === true,
        slot: 'stem',
        stemState: clip.audioState?.stemSeparation ?? null,
        activeStemKind: selectedStemKind,
        job: specialState?.stemJob ?? null,
        jobPhase: specialState?.stemJob?.phase,
        progress: specialState?.stemJob?.progress,
      },
      contextMenu: {
        enabled: clipContextMenu?.clipId === clipId,
        slot: 'context-menu',
        state: clipContextMenu?.clipId === clipId ? clipContextMenu : null,
        isOpen: clipContextMenu?.clipId === clipId,
      },
    };
  };
  const hitTestClipAtClientX = (clientX: number, rowEl: HTMLElement): string | null => {
    const rect = rowEl.getBoundingClientRect();
    const time = pixelToTime(clientX - rect.left);
    for (let index = allTrackClips.length - 1; index >= 0; index -= 1) {
      const clip = allTrackClips[index];
      if (time >= clip.startTime && time < clip.startTime + clip.duration) return clip.id;
    }
    return null;
  };
  const buildClipPointerContext = (
    clipId: string,
    clientX: number,
    rowEl: HTMLElement,
    altKey: boolean,
  ) => {
    const clip = allTrackClips.find((candidate) => candidate.id === clipId);
    if (!clip) return null;
    const rowRect = rowEl.getBoundingClientRect();
    const clipLeft = rowRect.left + timeToPixel(clip.startTime) - scrollX;
    const timelineState = useTimelineStore.getState();
    return {
      toolId: activeTimelineToolId,
      clip,
      track,
      clips,
      playheadPosition: timelineState.playheadPosition,
      snappingEnabled: timelineState.snappingEnabled,
      displayStartTime: clip.startTime,
      displayDuration: clip.duration,
      width: Math.max(1, timeToPixel(clip.duration)),
      clientX,
      rectLeft: clipLeft,
      altKey,
    };
  };
  const handleTimelineToolPointerMove = (
    event: React.MouseEvent<HTMLDivElement>,
    clipId: string | null,
  ): boolean => {
    if (!isTimelinePointerTool(activeTimelineToolId)) return false;
    if (!clipId) {
      useTimelineStore.getState().setTimelineToolPreview(null);
      return false;
    }

    const context = buildClipPointerContext(
      clipId,
      event.clientX,
      event.currentTarget,
      event.altKey,
    );
    if (!context) return false;

    const result = dispatchTimelineClipPointerMove(context);
    if (!result.handled) return false;

    useTimelineStore.getState().setTimelineToolPreview(result.preview ?? null);
    return true;
  };
  const handleTimelineToolPointerClick = (
    event: React.MouseEvent<HTMLDivElement>,
    clipId: string,
  ): boolean => {
    if (!isTimelinePointerTool(activeTimelineToolId)) return false;
    const context = buildClipPointerContext(
      clipId,
      event.clientX,
      event.currentTarget,
      event.altKey,
    );
    if (!context) return false;

    const result = dispatchTimelineClipPointerClick(context);
    if (!result.handled) return false;

    event.preventDefault();
    event.stopPropagation();
    const timelineState = useTimelineStore.getState();
    if ('preview' in result) {
      timelineState.setTimelineToolPreview(result.preview ?? null);
    }
    if (result.operation) {
      timelineState.applyTimelineEditOperation(result.operation, {
        source: 'ui',
        historyLabel: result.operation.type === 'split-all-at-time'
          ? 'Blade all tracks split'
          : 'Blade split',
      });
    }
    if (result.nextToolId) {
      timelineState.setActiveTimelineTool(result.nextToolId);
    }
    return true;
  };
  const handleShellKeyframeGroupMove = useCallback((
    keyframeIds: string[],
    newTime: number,
    context: ClipInteractionShellCommandContext,
    phase: KeyframeTickMovePhase = 'update',
  ) => {
    const keyframeIdSet = new Set(keyframeIds);
    const targetKeyframes = (context.activeModules.keyframe?.keyframes ?? [])
      .filter((keyframe): keyframe is Keyframe => keyframeIdSet.has(keyframe.id));

    if (!applyTimelineEditOperation) {
      if (phase === 'update') {
        onMoveKeyframeGroup?.(keyframeIds, newTime);
      }
      return;
    }

    const targetKeyframeIdSet = new Set(targetKeyframes.map((keyframe) => keyframe.id));
    const missingKeyframeIds = keyframeIds.filter((keyframeId) => !targetKeyframeIdSet.has(keyframeId));
    if (missingKeyframeIds.length > 0) {
      const existing = keyframeTickTransactionRef.current;
      const shouldClearSession = existing?.clipId === context.clip.id &&
        keyframeIds.some((keyframeId) => existing.originalTimes.has(keyframeId));
      if (shouldClearSession) {
        keyframeTickTransactionRef.current = null;
      }
      if (shouldClearSession || phase !== 'update') {
        log.warn('Skipped keyframe group move for missing typed targets', {
          clipId: context.clip.id,
          keyframeIds,
          missingKeyframeIds,
          phase,
        });
      }
      return;
    }

    const resolvedKeyframeIds = targetKeyframes.map((keyframe) => keyframe.id);
    const sessionMatches = (session: NonNullable<typeof keyframeTickTransactionRef.current>) => (
      session.clipId === context.clip.id &&
      resolvedKeyframeIds.length === session.keyframeIds.length &&
      resolvedKeyframeIds.every((keyframeId) => session.originalTimes.has(keyframeId))
    );

    const ensureSession = () => {
      const existing = keyframeTickTransactionRef.current;
      if (existing && sessionMatches(existing)) return existing;

      keyframeTickTransactionCounterRef.current += 1;
      const transactionId = `keyframe-tick:${context.clip.id}:${keyframeTickTransactionCounterRef.current}`;
      const session = {
        transactionId,
        historyBatchId: `${transactionId}:history`,
        clipId: context.clip.id,
        property: targetKeyframes[0]?.property,
        keyframeIds: resolvedKeyframeIds,
        originalTimes: new Map(targetKeyframes.map((keyframe) => [keyframe.id, keyframe.time])),
        hasUpdate: false,
      };
      keyframeTickTransactionRef.current = session;
      applyTimelineEditOperation({
        id: `${transactionId}:begin`,
        type: 'keyframe-transaction-begin',
        transactionId,
        historyBatchId: session.historyBatchId,
        source: 'ui',
        phase: 'begin',
        clipId: context.clip.id,
        property: session.property,
        keyframeIds: resolvedKeyframeIds,
        intent: 'drag-diamond',
      }, {
        source: 'ui',
        historyLabel: 'Begin keyframe move',
      });
      return session;
    };

    const session = ensureSession();
    if (phase === 'begin') return;
    if (phase === 'commit' && !session.hasUpdate) {
      keyframeTickTransactionRef.current = null;
      return;
    }

    const operations = targetKeyframes.map((keyframe) => ({
      type: 'keyframe-move' as const,
      keyframeId: keyframe.id,
      clipId: keyframe.clipId,
      property: keyframe.property,
      originalTime: session.originalTimes.get(keyframe.id) ?? keyframe.time,
      requestedTime: newTime,
      resolvedTime: newTime,
    }));

    if (phase === 'commit') {
      applyTimelineEditOperation({
        id: `${session.transactionId}:commit:${newTime.toFixed(6)}`,
        type: 'keyframe-transaction-commit',
        transactionId: session.transactionId,
        historyBatchId: session.historyBatchId,
        source: 'ui',
        phase: 'commit',
        clipId: context.clip.id,
        property: session.property,
        keyframeIds: session.keyframeIds,
        operations,
      }, {
        source: 'ui',
        historyLabel: 'Move keyframes',
      });
      keyframeTickTransactionRef.current = null;
      return;
    }

    session.hasUpdate = true;
    applyTimelineEditOperation({
      id: `${session.transactionId}:update:${newTime.toFixed(6)}`,
      type: 'keyframe-transaction-update',
      transactionId: session.transactionId,
      historyBatchId: session.historyBatchId,
      source: 'ui',
      phase: 'update',
      clipId: context.clip.id,
      property: session.property,
      keyframeIds: session.keyframeIds,
      operations,
    }, {
      source: 'ui',
      historyLabel: 'Move keyframes',
      deferHistoryCommit: true,
    });
  }, [applyTimelineEditOperation, onMoveKeyframeGroup]);
  const selectedTrackClip = allTrackClips.find((c) => selectedClipIds.has(c.id));
  const propertiesSelection = useTimelineStore(state => state.propertiesSelection);
  const isPropertiesSelected = propertiesSelection?.kind === 'track' && propertiesSelection.trackId === track.id;
  const trackLaneStyle = {
    height: dynamicHeight,
    ...(trackColor ? { '--track-color': trackColor } : {}),
  } as React.CSSProperties & { '--track-color'?: string };
  const isMutedTrack = track.type === 'audio' && (track.audioState?.muted ?? track.muted) === true;
  const isHiddenTrack = track.type === 'video' && track.visible === false;
  const renderExternalPreview = (
    className: string,
    left: number,
    width: number,
    label: string,
    thumbnailUrl?: string,
  ) => (
    <div
      className={`${className}${thumbnailUrl ? ' has-thumbnail' : ''}`}
      style={{
        left,
        width,
      }}
    >
      {thumbnailUrl && (
        <div
          className="timeline-clip-preview-thumbnail"
          style={{ backgroundImage: `url("${thumbnailUrl.replace(/"/g, '\\"')}")` }}
        />
      )}
      <div className="clip-content">
        <span className="clip-name">{label}</span>
      </div>
    </div>
  );

  return (
    <div
      className={`track-lane ${track.type} ${isDimmed ? 'dimmed' : ''} ${
        isExpanded ? 'expanded' : ''
      } ${isDragTarget ? 'drag-target' : ''} ${
        isExternalDragTarget ? 'external-drag-target' : ''
      } ${track.locked ? 'locked' : ''} ${isMutedTrack ? 'track-muted' : ''} ${
        isHiddenTrack ? 'track-hidden' : ''
      } ${isResizeActive ? 'resizing' : ''} ${isPropertiesSelected ? 'properties-selected' : ''}`}
      data-track-id={track.id}
      data-dock-layout-child-anim-id={`timeline-track-lane:${track.id}`}
      style={trackLaneStyle}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
    >
      {/* Clip row - the normal clip area */}
      <div
        ref={clipRowRef}
        className="track-clip-row"
        style={{ height: baseHeight }}
        onMouseMove={(event) => {
          // Hit-test under the cursor so the hovered clip mounts as a real
          // interaction shell on top of the canvas.
          const hit = hitTestClipAtClientX(event.clientX, event.currentTarget);
          setHoveredClipId((prev) => (prev === hit ? prev : hit));
          handleTimelineToolPointerMove(event, hit);
        }}
        onMouseLeave={() => {
          setHoveredClipId(null);
          if (isTimelinePointerTool(activeTimelineToolId)) {
            useTimelineStore.getState().setTimelineToolPreview(null);
          }
        }}
        onMouseDown={(event) => {
          if (event.button === 0) {
            const target = event.target as HTMLElement;
            if (!isTimelineActiveTarget(target)) {
              const hit = hitTestClipAtClientX(event.clientX, event.currentTarget);
              if (hit) {
                setHoveredClipId(hit);
                if (handleTimelineToolPointerClick(event, hit)) {
                  return;
                }
                onClipMouseDown(event, hit);
                return;
              }
            }
          }
          if (event.button !== 2) return;
          const target = event.target as HTMLElement;
          if (isTimelineActiveTarget(target)) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const time = Math.max(0, pixelToTime(event.clientX - rect.left));
          onEmptyMouseDown(event, track.id, time);
        }}
        onDoubleClick={(event) => {
          const target = event.target as HTMLElement;
          if (target.closest('button, input, select, textarea, [data-shell-trim-edge], [data-shell-fade-edge]')) return;
          const hit = hitTestClipAtClientX(event.clientX, event.currentTarget);
          if (!hit) return;
          setHoveredClipId(hit);
          onClipDoubleClick(event, hit);
        }}
        onContextMenu={(event) => {
          const target = event.target as HTMLElement;
          if (isTimelineActiveTarget(target)) return;
          const hit = hitTestClipAtClientX(event.clientX, event.currentTarget);
          if (hit) {
            onClipContextMenu(event, hit);
            return;
          }
          const rect = event.currentTarget.getBoundingClientRect();
          const time = Math.max(0, pixelToTime(event.clientX - rect.left));
          onEmptyContextMenu(event, track.id, time);
        }}
      >
        {/* Render clips belonging to this track */}
        <TimelineClipCanvas
          clips={canvasClips}
          trackId={track.id}
          height={baseHeight}
          contentWidth={canvasContentWidth}
          timeToPixel={timeToPixel}
          selectedClipIds={selectedClipIds}
          hoveredClipId={hoveredClipId}
          trackColor={trackColor ?? 'rgba(120, 160, 200, 1)'}
          scrollX={scrollX}
          viewportWidth={viewportWidth}
          waveformsEnabled={waveformsEnabled}
          audioDisplayMode={audioDisplayMode}
          clipDrag={clipDrag}
          clipDragPreview={clipDragPreview}
          clipTrim={clipTrim}
        />
        {domControlClips.map((clip) => {
          const activeModules = getClipShellActiveModules(clip);
          const mountState = getClipShellMountState(clip.id);
          return (
            <div
              key={`canvas-control-${clip.id}`}
              className="timeline-canvas-dom-overlay"
            >
              <ClipInteractionShell
                clip={clip}
                track={track}
                geometry={getClipShellGeometry(clip)}
                mountState={mountState}
                activeModules={activeModules}
                commands={{
                  onFadeStart: (event, context, edge) => onFadeStart(event, context.clip.id, edge),
                  onTrimStart: (event, context, edge) => onTrimStart(event, context.clip.id, edge),
                  onMoveKeyframeGroup: handleShellKeyframeGroupMove,
                }}
                className="timeline-canvas-interaction-shell"
                style={{ pointerEvents: 'none' }}
              />
            </div>
          );
        })}
        {/* External file drag preview - video clip */}
        {externalDrag && externalDrag.trackId === track.id && renderExternalPreview(
          'timeline-clip-preview',
          timeToPixel(externalDrag.startTime),
          timeToPixel(externalDrag.duration ?? 5),
          externalDrag.label ?? 'Drop to add clip',
          externalDrag.thumbnailUrl,
        )}
        {/* External file drag preview - linked audio clip (when hovering video track) */}
        {externalDrag &&
          externalDrag.audioTrackId === track.id && renderExternalPreview(
            'timeline-clip-preview audio',
            timeToPixel(externalDrag.startTime),
            timeToPixel(externalDrag.duration ?? 5),
            'Audio (linked)',
          )}
        {/* External file drag preview - linked video clip (when hovering audio track) */}
        {externalDrag &&
          externalDrag.videoTrackId === track.id && renderExternalPreview(
            'timeline-clip-preview video',
            timeToPixel(externalDrag.startTime),
            timeToPixel(externalDrag.duration ?? 5),
            externalDrag.label ?? 'Video',
            externalDrag.thumbnailUrl,
          )}
      </div>
      {/* Property rows - only shown when track is expanded (for both video and audio) */}
      {(track.type === 'video' || track.type === 'audio') && isExpanded && (
        <TrackPropertyTracks
          trackId={track.id}
          selectedClip={selectedTrackClip || null}
          clipKeyframes={clipKeyframes}
          renderKeyframeDiamonds={renderKeyframeDiamonds}
          expandedCurveProperties={expandedCurveProperties}
          activeTimelineToolId={activeTimelineToolId}
          selectedKeyframeIds={selectedKeyframeIds}
          onSelectKeyframe={onSelectKeyframe}
          onMoveKeyframe={onMoveKeyframe}
          onUpdateBezierHandle={onUpdateBezierHandle}
          applyTimelineEditOperation={applyTimelineEditOperation}
          addKeyframe={addKeyframe}
          timeToPixel={timeToPixel}
          pixelToTime={pixelToTime}
        />
      )}
      {onResizeStart && (
        <div
          className={`track-resize-handle track-resize-handle-lane ${isResizeActive ? 'active' : ''}`}
          role="separator"
          aria-orientation="horizontal"
          title="Drag to resize track height"
          onPointerDown={(event) => onResizeStart(event, track.id)}
        />
      )}
    </div>
  );
}

function areTimelineTrackPropsEqual(
  previous: TimelineTrackProps,
  next: TimelineTrackProps,
): boolean {
  if (
    previous.isClipDragActive &&
    next.isClipDragActive &&
    previous.clipDrag === null &&
    next.clipDrag === null &&
    previous.clipDragPreview === null &&
    next.clipDragPreview === null
  ) {
    return previous.track === next.track &&
      previous.trackColor === next.trackColor &&
      previous.clips === next.clips &&
      previous.isDimmed === next.isDimmed &&
      previous.isExpanded === next.isExpanded &&
      previous.baseHeight === next.baseHeight &&
      previous.dynamicHeight === next.dynamicHeight &&
      previous.isDragTarget === next.isDragTarget &&
      previous.isExternalDragTarget === next.isExternalDragTarget &&
      previous.selectedClipIds === next.selectedClipIds &&
      previous.selectedKeyframeIds === next.selectedKeyframeIds &&
      previous.activeTimelineToolId === next.activeTimelineToolId &&
      previous.waveformsEnabled === next.waveformsEnabled &&
      previous.audioDisplayMode === next.audioDisplayMode &&
      previous.isClipDragActive === next.isClipDragActive &&
      previous.clipTrim === next.clipTrim &&
      previous.clipFade === next.clipFade &&
      previous.clipContextMenu === next.clipContextMenu &&
      previous.audioRegionSelection === next.audioRegionSelection &&
      previous.audioRegionGainPreview === next.audioRegionGainPreview &&
      previous.audioSpectralRegionSelection === next.audioSpectralRegionSelection &&
      previous.videoBakeRegionSelection === next.videoBakeRegionSelection &&
      previous.clipStemSeparationJobs === next.clipStemSeparationJobs &&
      previous.externalDrag === next.externalDrag &&
      previous.zoom === next.zoom &&
      previous.scrollX === next.scrollX &&
      previous.onEmptyMouseDown === next.onEmptyMouseDown &&
      previous.onEmptyContextMenu === next.onEmptyContextMenu &&
      previous.onClipDoubleClick === next.onClipDoubleClick &&
      previous.onFadeStart === next.onFadeStart &&
      previous.onTrimStart === next.onTrimStart &&
      previous.isResizeActive === next.isResizeActive &&
      previous.clipKeyframes === next.clipKeyframes &&
      previous.expandedCurveProperties === next.expandedCurveProperties;
  }

  // General case: shallow-compare ALL props. Previously this returned `false`
  // unconditionally, so every track re-rendered on every parent (Timeline) render
  // — including playhead updates that don't touch a track's props. With a real
  // shallow compare we skip those unrelated re-renders while still updating
  // whenever any prop reference changes (legacy renderer, clips, selection, callbacks...).
  const prevKeys = Object.keys(previous) as Array<keyof TimelineTrackProps>;
  const nextKeys = Object.keys(next) as Array<keyof TimelineTrackProps>;
  if (prevKeys.length !== nextKeys.length) return false;
  for (const key of prevKeys) {
    if (previous[key] !== next[key]) return false;
  }
  return true;
}

export const TimelineTrack = memo(TimelineTrackComponent, areTimelineTrackPropsEqual);
