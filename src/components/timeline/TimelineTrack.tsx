// TimelineTrack component - Individual track row

import React, { memo, useCallback, useMemo, useRef, useEffect, useState } from 'react';
import type { TimelineTrackProps } from './types';
import type { Keyframe } from '../../types';
import {
  isVectorAnimationSourceType,
  shouldLoopVectorAnimation,
} from '../../types/vectorAnimation';
import { useTimelineStore } from '../../stores/timeline';
import { TimelineClipCanvas } from './TimelineClipCanvas';
import {
  ClipInteractionShell,
  type ClipInteractionShellGeometry,
  type ClipInteractionShellRect,
} from './interactionShell';
import { TimelineCanvasClipRenameInput } from './components/TimelineCanvasClipRenameInput';
import { TimelineTrackGridCanvas } from './components/TimelineTrackGridCanvas';
import { TrackPropertyTracks } from './components/TrackPropertyTracks';
import { TimelineTrackExternalDropPreviews } from './components/TimelineTrackExternalDropPreviews';
import { TimelineTrackResizeHandle } from './components/TimelineTrackResizeHandle';
import { useClipInteractionShellKeyframeGroupMove } from './hooks/useClipInteractionShellKeyframeGroupMove';
import { useClipInteractionShellModuleCommandDispatcher } from './hooks/useClipInteractionShellModuleCommandDispatcher';
import { useTimelineTrackClipRowEvents } from './hooks/useTimelineTrackClipRowEvents';
import { useTimelineTrackInteractionShellState } from './hooks/useTimelineTrackInteractionShellState';
import { useTimelineTrackPointerTools } from './hooks/useTimelineTrackPointerTools';
import {
  reportTimelineCanvasDomDiagnostics,
  unregisterTimelineCanvasTrackDiagnostics,
} from '../../services/timeline/timelineCanvasDiagnostics';
import { MIN_CLIP_DURATION } from './timelineRenderConstants';
import { resolveAudioVolumeAutomationCurveKeyframes } from './utils/audioAutomationCurve';
import type { FadeCurveKeyframe } from './utils/fadeCurvePath';
import { isInfiniteTimelineSourceType } from './utils/clipSourceTiming';
import { isAudioSectionTrack } from './utils/trackSection';
import {
  buildTimelineTrackClipGeometryMap,
  buildTimelineTrackClipShellGeometry,
  buildTimelineTrackHostGeometrySnapshot,
  buildTimelineTrackRangeShellRect,
} from './utils/timelineTrackGeometryAdapter';
import {
  type TimelinePaintFadeVisuals,
} from '../../timeline';

const TRACK_VIEWPORT_FALLBACK_PX = 1600;
const TRACK_RENDER_OVERSCAN_PX = 1200;
const CLIP_SHELL_VERTICAL_INSET_PX = 4;
const CLIP_SHELL_HANDLE_WIDTH_PX = 8;
const CLIP_SHELL_FADE_HANDLE_SIZE_PX = 12;
const FADE_DURATION_VALUE_EPSILON = 0.01;
type ClipFadeVisualState = TimelinePaintFadeVisuals & {
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
  const clipRenameId = useTimelineStore((state) => state.clipRenameId);
  const [measuredViewportWidth, setMeasuredViewportWidth] = useState(TRACK_VIEWPORT_FALLBACK_PX);
  const handleShellKeyframeGroupMove = useClipInteractionShellKeyframeGroupMove({
    applyTimelineEditOperation,
    onMoveKeyframeGroup,
  });

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
  const [hoveredClipId, setHoveredClipId] = useState<string | null>(null);
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
  const {
    activeShellSlotCounts,
    domControlClips,
    getClipShellActiveModules,
    getClipShellMountState,
  } = useTimelineTrackInteractionShellState({
    track,
    allTrackClips,
    trackClips,
    canvasClips,
    clipKeyframes,
    selectedKeyframeIds,
    clipDrag,
    clipTrim,
    clipFade,
    clipContextMenu,
    audioRegionSelection,
    audioRegionGainPreview,
    audioSpectralRegionSelection,
    audioDisplayMode,
    videoBakeRegionSelection,
    clipStemSeparationJobs,
    activeTimelineToolId,
    clipRenameId,
    hoveredClipId,
    getClipFadeVisualState,
  });
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
  const timelineTrackGeometrySnapshot = useMemo(
    () => buildTimelineTrackHostGeometrySnapshot({
      track,
      clips: canvasClips,
      baseHeight,
      trackColor,
      selectedClipIds,
      hoveredClipId,
      viewportWidth,
      scrollX,
      zoom,
      clipVerticalInsetPx: CLIP_SHELL_VERTICAL_INSET_PX,
    }),
    [baseHeight, canvasClips, hoveredClipId, scrollX, selectedClipIds, track, trackColor, viewportWidth, zoom],
  );
  const timelineClipGeometryById = useMemo(
    () => buildTimelineTrackClipGeometryMap(timelineTrackGeometrySnapshot),
    [timelineTrackGeometrySnapshot],
  );
  const {
    clearPointerToolPreview,
    handleTimelineToolPointerClick,
    handleTimelineToolPointerMove,
    hitTestClipAtClientX,
  } = useTimelineTrackPointerTools({
    activeTimelineToolId,
    allTrackClips,
    clips,
    timelineClipGeometryById,
    track,
  });
  const renamingClip = useMemo(
    () => clipRenameId
      ? canvasClips.find((clip) => clip.id === clipRenameId && clip.trackId === track.id && clip.source?.type === 'midi')
      : undefined,
    [canvasClips, clipRenameId, track.id],
  );
  const clipRowEvents = useTimelineTrackClipRowEvents({
    clearPointerToolPreview,
    handleTimelineToolPointerClick,
    handleTimelineToolPointerMove,
    hitTestClipAtClientX,
    onClipContextMenu,
    onClipDoubleClick,
    onClipMouseDown,
    onEmptyContextMenu,
    onEmptyMouseDown,
    pixelToTime,
    setHoveredClipId,
    trackId: track.id,
  });
  useEffect(() => {
    return () => {
      unregisterTimelineCanvasTrackDiagnostics(track.id);
    };
  }, [track.id]);

  useEffect(() => {
    reportTimelineCanvasDomDiagnostics(track.id, {
      domOverlayCount: domControlClips.length,
      domClipBodyCount: 0,
      shellCount: domControlClips.length,
      activeShellSlotCounts,
    });
  }, [activeShellSlotCounts, domControlClips.length, track.id]);
  const getClipShellGeometry = (clip: typeof clips[number]): ClipInteractionShellGeometry => {
    return buildTimelineTrackClipShellGeometry({
      clip,
      clipGeometry: timelineClipGeometryById.get(clip.id),
      timeToPixel,
      baseHeight,
      scrollX,
      viewportWidth,
      canvasContentWidth,
      clipVerticalInsetPx: CLIP_SHELL_VERTICAL_INSET_PX,
      shellHandleWidthPx: CLIP_SHELL_HANDLE_WIDTH_PX,
      fadeHandleSizePx: CLIP_SHELL_FADE_HANDLE_SIZE_PX,
      fade: getClipFadeVisualState(clip),
    });
  };
  const getTrackRangeShellRect = (startTime: number, duration: number): ClipInteractionShellRect => {
    return buildTimelineTrackRangeShellRect({
      snapshot: timelineTrackGeometrySnapshot,
      canvasContentWidth,
      baseHeight,
      clipVerticalInsetPx: CLIP_SHELL_VERTICAL_INSET_PX,
      startTime,
      duration,
    });
  };
  const handleShellModuleCommand = useClipInteractionShellModuleCommandDispatcher();
  const selectedTrackClip = allTrackClips.find((c) => selectedClipIds.has(c.id));
  const propertiesSelection = useTimelineStore(state => state.propertiesSelection);
  const isPropertiesSelected = propertiesSelection?.kind === 'track' && propertiesSelection.trackId === track.id;
  const trackLaneStyle = {
    height: dynamicHeight,
    ...(trackColor ? { '--track-color': trackColor } : {}),
  } as React.CSSProperties & { '--track-color'?: string };
  const isMutedTrack = isAudioSectionTrack(track) && (track.audioState?.muted ?? track.muted) === true;
  const isHiddenTrack = track.type === 'video' && track.visible === false;

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
        {...clipRowEvents}
      >
        <TimelineTrackGridCanvas
          height={baseHeight}
          scrollX={scrollX}
          trackType={track.type}
          viewportWidth={viewportWidth}
          zoom={zoom}
        />
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
                  onModuleCommand: handleShellModuleCommand,
                }}
                className="timeline-canvas-interaction-shell"
                style={{ pointerEvents: 'none' }}
              />
            </div>
          );
        })}
        {renamingClip && (
          <TimelineCanvasClipRenameInput
            clip={renamingClip}
            geometry={getClipShellGeometry(renamingClip)}
          />
        )}
        <TimelineTrackExternalDropPreviews
          externalDrag={externalDrag}
          getTrackRangeShellRect={getTrackRangeShellRect}
          trackId={track.id}
        />
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
        <TimelineTrackResizeHandle
          isResizeActive={isResizeActive}
          onResizeStart={onResizeStart}
          trackId={track.id}
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
