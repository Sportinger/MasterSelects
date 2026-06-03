// TimelineTrack component - Individual track row

import React, { memo, useCallback, useMemo, useRef, useEffect, useState } from 'react';
import type { ClipKeyframeTimeGroup, TimelineTrackProps } from './types';
import type { AnimatableProperty, BezierHandle, ClipMask, Keyframe } from '../../types';
import { CurveEditor } from './CurveEditor';
import {
  isVectorAnimationSourceType,
  parseVectorAnimationInputProperty,
  parseVectorAnimationStateProperty,
  shouldLoopVectorAnimation,
} from '../../types/vectorAnimation';
import { useTimelineStore } from '../../stores/timeline';
import { flags } from '../../engine/featureFlags';
import { TimelineClipCanvas, type CanvasFadeVisuals } from './TimelineClipCanvas';
import {
  ClipInteractionShell,
  getClipInteractionShellActiveSlots,
  type ClipInteractionShellActiveModules,
  type ClipInteractionShellGeometry,
  type ClipInteractionShellMountReason,
  type ClipInteractionShellMountState,
  type ClipInteractionShellModuleSlot,
  type ClipInteractionShellRect,
} from './interactionShell';
import { reportTimelineCanvasDomDiagnostics } from '../../services/timeline/timelineCanvasDiagnostics';
import { MIN_CLIP_DURATION } from './timelineRenderConstants';
import { resolveAudioVolumeAutomationCurveKeyframes } from './utils/audioAutomationCurve';
import type { FadeCurveKeyframe } from './utils/fadeCurvePath';

const TRACK_VIEWPORT_FALLBACK_PX = 1600;
const TRACK_VIEWPORT_MIN_PX = 1600;
const TRACK_RENDER_OVERSCAN_PX = 1200;
const CLIP_SHELL_VERTICAL_INSET_PX = 4;
const CLIP_SHELL_HANDLE_WIDTH_PX = 8;
const CLIP_SHELL_FADE_HANDLE_SIZE_PX = 12;
const EPSILON = 0.0001;
const FADE_DURATION_VALUE_EPSILON = 0.01;

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

const canSkipLegacyClipBody = (
  activeSlots: readonly ClipInteractionShellModuleSlot[],
  mountReasons: readonly ClipInteractionShellMountReason[],
): boolean => {
  const trimOnlyShell = activeSlots.length === 1 && activeSlots[0] === 'trim';
  const contextMenuShell =
    activeSlots.length === 1 &&
    activeSlots[0] === 'context-menu' &&
    mountReasons.includes('context-menu-open') &&
    mountReasons.every((reason) => reason === 'context-menu-open' || reason === 'hover');
  const dragOnlyShell =
    activeSlots.length === 0 &&
    mountReasons.some((reason) => reason === 'drag' || reason === 'multi-drag') &&
    mountReasons.every((reason) => reason === 'drag' || reason === 'multi-drag' || reason === 'hover');
  const hoverOnlyShell =
    activeSlots.length === 0 &&
    mountReasons.length === 1 &&
    mountReasons[0] === 'hover';
  const stemOnlyShell =
    activeSlots.length === 1 &&
    activeSlots[0] === 'stem' &&
    mountReasons.some((reason) => reason === 'stem-active') &&
    mountReasons.every((reason) => reason === 'stem-active' || reason === 'hover');
  const fadeOnlyShell =
    activeSlots.length === 1 &&
    activeSlots[0] === 'fade' &&
    mountReasons.some((reason) => reason === 'fade') &&
    mountReasons.every((reason) => reason === 'fade' || reason === 'hover');
  const keyframeOnlyShell =
    activeSlots.length === 1 &&
    activeSlots[0] === 'keyframe' &&
    mountReasons.some((reason) => reason === 'selected-keyframes') &&
    mountReasons.every((reason) => reason === 'selected-keyframes' || reason === 'hover');
  const audioRegionOnlyShell =
    activeSlots.length === 1 &&
    activeSlots[0] === 'audio-region' &&
    mountReasons.some((reason) => reason === 'audio-region-active') &&
    mountReasons.every((reason) => reason === 'audio-region-active' || reason === 'hover');

  return trimOnlyShell ||
    contextMenuShell ||
    dragOnlyShell ||
    hoverOnlyShell ||
    stemOnlyShell ||
    fadeOnlyShell ||
    keyframeOnlyShell ||
    audioRegionOnlyShell;
};

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
  addKeyframe: (clipId: string, property: AnimatableProperty, value: number, time?: number, easing?: string | null) => void;
  timeToPixel: (time: number) => number;
  pixelToTime: (pixel: number) => number;
}) {
  const clipId = selectedClip?.id;

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

  // Get all keyframes for this clip
  const allKeyframes = clipKeyframes.get(selectedClip.id) || [];

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
          <div key={prop} className={`keyframe-track-row flat ${isCurveExpanded ? 'curve-expanded' : ''}`}>
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
                onMoveKeyframe={(id, newTime, _newValue) => {
                  onMoveKeyframe(id, newTime);
                }}
                onUpdateBezierHandle={onUpdateBezierHandle}
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
  renderClip,
  onClipMouseDown,
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
  const viewportWidth = typeof window === 'undefined'
    ? TRACK_VIEWPORT_FALLBACK_PX
    : Math.max(TRACK_VIEWPORT_MIN_PX, window.innerWidth);
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
  const clipShellKeyframeStateByClipId = useMemo(() => {
    const stateByClipId = new Map<string, {
      keyframes: Keyframe[];
      keyframeGroups: ClipKeyframeTimeGroup[];
      selectedKeyframeIds: string[];
      activeProperty?: AnimatableProperty;
    }>();

    if (selectedKeyframeIds.size === 0) return stateByClipId;

    allTrackClips.forEach((clip) => {
      const keyframes = (clipKeyframes.get(clip.id) ?? []) as Keyframe[];
      const selectedKeyframes = keyframes.filter((keyframe) => selectedKeyframeIds.has(keyframe.id));
      if (selectedKeyframes.length === 0) return;

      stateByClipId.set(clip.id, {
        keyframes,
        keyframeGroups: getClipShellKeyframeGroups(keyframes),
        selectedKeyframeIds: selectedKeyframes.map((keyframe) => keyframe.id),
        activeProperty: selectedKeyframes[0]?.property,
      });
    });

    return stateByClipId;
  }, [allTrackClips, clipKeyframes, selectedKeyframeIds]);
  const [hoveredClipId, setHoveredClipId] = useState<string | null>(null);
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
  // issue #228: when the flag is on, draw clip bodies on a viewport-sliced
  // canvas per track instead of one DOM node per clip. The canvas backing store
  // no longer scales with total timeline width, so high zoom does not need the
  // visible legacy DOM fallback.
  const trackContentWidth = useMemo(() => {
    let max = 0;
    for (const clip of allTrackClips) {
      const end = timeToPixel(clip.startTime + clip.duration);
      if (end > max) max = end;
    }
    return max;
  }, [allTrackClips, timeToPixel]);
  const useCanvasClips = flags.timelineCanvasClips;
  // Canvas mode has a single visible renderer: TimelineClipCanvas. DOM clips are
  // mounted only as invisible interaction shells for the clip under the cursor or
  // an active gesture. They must never replace the visible canvas body, otherwise
  // thumbnails/waveforms visibly switch between two renderers.
  const domControlClipIds = useMemo(() => {
    const ids = new Set<string>();
    if (!useCanvasClips) return ids;
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
    useCanvasClips,
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
    if (!useCanvasClips) return allTrackClips;
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
      return fade.keyframes.length >= 2 ? { ...clip, fade } : clip;
    });
  }, [useCanvasClips, clipDrag, clipDragPreview, track.id, allTrackClips, clips, getClipFadeVisualState]);
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
    () => (useCanvasClips ? canvasClips.filter((clip) => domControlClipIds.has(clip.id)) : []),
    [useCanvasClips, canvasClips, domControlClipIds],
  );
  useEffect(() => {
    const activeShellSlotCounts: Partial<Record<ClipInteractionShellModuleSlot, number>> = {};
    const addSlot = (
      slots: ClipInteractionShellModuleSlot[],
      slot: ClipInteractionShellModuleSlot,
    ) => {
      slots.push(slot);
      activeShellSlotCounts[slot] = (activeShellSlotCounts[slot] ?? 0) + 1;
    };
    let domClipBodyCount = useCanvasClips ? 0 : trackClips.length;

    domControlClips.forEach((clip) => {
      const activeSlots: ClipInteractionShellModuleSlot[] = [];
      if (clipTrim?.clipId === clip.id) addSlot(activeSlots, 'trim');
      if (clipFade?.clipId === clip.id) addSlot(activeSlots, 'fade');
      if (clipShellKeyframeStateByClipId.has(clip.id)) addSlot(activeSlots, 'keyframe');
      if (clipContextMenu?.clipId === clip.id) addSlot(activeSlots, 'context-menu');
      const specialState = clipShellSpecialStateByClipId.get(clip.id);
      if (specialState?.audioRegionActive) addSlot(activeSlots, 'audio-region');
      if (specialState?.spectralRegionActive) addSlot(activeSlots, 'spectral-region');
      if (specialState?.videoBakeActive) addSlot(activeSlots, 'video-bake');
      if (specialState?.stemActive) addSlot(activeSlots, 'stem');

      const mountReasons: ClipInteractionShellMountReason[] = [];
      if (hoveredClipId === clip.id) mountReasons.push('hover');
      if (clipDrag?.clipId === clip.id) mountReasons.push('drag');
      if (clipDrag?.multiSelectClipIds?.includes(clip.id)) mountReasons.push('multi-drag');
      if (clipTrim?.clipId === clip.id) mountReasons.push('trim');
      if (clipFade?.clipId === clip.id) mountReasons.push('fade');
      if (clipContextMenu?.clipId === clip.id) mountReasons.push('context-menu-open');
      if (clipShellKeyframeStateByClipId.has(clip.id)) mountReasons.push('selected-keyframes');
      if (specialState?.audioRegionActive) mountReasons.push('audio-region-active');
      if (specialState?.spectralRegionActive) mountReasons.push('spectral-region-active');
      if (specialState?.videoBakeActive) mountReasons.push('video-bake-active');
      if (specialState?.stemActive) mountReasons.push('stem-active');

      if (!canSkipLegacyClipBody(activeSlots, mountReasons)) {
        domClipBodyCount += 1;
      }
    });

    reportTimelineCanvasDomDiagnostics(track.id, {
      domOverlayCount: useCanvasClips ? domControlClips.length : 0,
      domClipBodyCount,
      shellCount: domControlClips.length,
      activeShellSlotCounts,
    });
  }, [
    track.id,
    useCanvasClips,
    domControlClips,
    trackClips.length,
    hoveredClipId,
    clipDrag,
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
    const fadeVisualState = getClipFadeVisualState(clip);
    const selectedStemKind = clip.audioState?.stemSeparation?.stems
      .find((stem) => stem.id === clip.audioState?.stemSeparation?.soloStemId)
      ?.kind;

    return {
      trim: {
        enabled: clipTrim?.clipId === clipId,
        slot: 'trim',
        state: clipTrim?.clipId === clipId ? clipTrim : null,
        activeEdges: clipTrim?.clipId === clipId ? [clipTrim.edge] : [],
      },
      fade: {
        enabled: clipFade?.clipId === clipId,
        slot: 'fade',
        state: clipFade?.clipId === clipId ? clipFade : null,
        activeEdges: clipFade?.clipId === clipId ? [clipFade.edge] : [],
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
        className="track-clip-row"
        style={{ height: baseHeight }}
        onMouseMove={useCanvasClips ? (event) => {
          // Canvas mode: hit-test under the cursor so the hovered clip mounts as
          // a real interactive DOM clip on top of the canvas.
          const hit = hitTestClipAtClientX(event.clientX, event.currentTarget);
          setHoveredClipId((prev) => (prev === hit ? prev : hit));
        } : undefined}
        onMouseLeave={useCanvasClips ? () => setHoveredClipId(null) : undefined}
        onMouseDown={(event) => {
          if (useCanvasClips && event.button === 0) {
            const target = event.target as HTMLElement;
            if (!target.closest('.timeline-clip, .timeline-clip-preview')) {
              const hit = hitTestClipAtClientX(event.clientX, event.currentTarget);
              if (hit) {
                setHoveredClipId(hit);
                onClipMouseDown(event, hit);
                return;
              }
            }
          }
          if (event.button !== 2) return;
          const target = event.target as HTMLElement;
          if (target.closest('.timeline-clip, .timeline-clip-preview')) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const time = Math.max(0, pixelToTime(event.clientX - rect.left));
          onEmptyMouseDown(event, track.id, time);
        }}
        onContextMenu={(event) => {
          const target = event.target as HTMLElement;
          if (target.closest('.timeline-clip, .timeline-clip-preview')) return;
          if (useCanvasClips) {
            const hit = hitTestClipAtClientX(event.clientX, event.currentTarget);
            if (hit) {
              onClipContextMenu(event, hit);
              return;
            }
          }
          const rect = event.currentTarget.getBoundingClientRect();
          const time = Math.max(0, pixelToTime(event.clientX - rect.left));
          onEmptyContextMenu(event, track.id, time);
        }}
      >
        {/* Render clips belonging to this track */}
        {useCanvasClips ? (
          <>
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
              const activeSlots = getClipInteractionShellActiveSlots(activeModules);
              const mountState = getClipShellMountState(clip.id);
              const skipLegacyClipBody = canSkipLegacyClipBody(activeSlots, mountState.reasons);
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
                      onMoveKeyframeGroup: (keyframeIds, newTime) => {
                        onMoveKeyframeGroup?.(keyframeIds, newTime);
                      },
                    }}
                    className="timeline-canvas-interaction-shell"
                    style={{ pointerEvents: 'none' }}
                  />
                  {skipLegacyClipBody ? null : renderClip(clip, track.id, undefined, { passiveVisualsSuppressed: true })}
                </div>
              );
            })}
          </>
        ) : (
          trackClips.map((clip) => renderClip(clip, track.id))
        )}
        {/* Render clip being dragged TO this track */}
        {!useCanvasClips && clipDrag &&
          clipDrag.currentTrackId === track.id &&
          clipDrag.originalTrackId !== track.id &&
          clips
            .filter((c) => c.id === clipDrag.clipId && !trackClipIds.has(c.id))
            .map((clip) => renderClip(clip, track.id))}
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
  // whenever any prop reference changes (renderClip, clips, selection, callbacks…).
  const prevKeys = Object.keys(previous) as Array<keyof TimelineTrackProps>;
  const nextKeys = Object.keys(next) as Array<keyof TimelineTrackProps>;
  if (prevKeys.length !== nextKeys.length) return false;
  for (const key of prevKeys) {
    if (previous[key] !== next[key]) return false;
  }
  return true;
}

export const TimelineTrack = memo(TimelineTrackComponent, areTimelineTrackPropsEqual);
