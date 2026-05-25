// TimelineClip component - Clip rendering within tracks

import './TimelineClip.css';
import { memo, useRef, useState, useEffect, useCallback } from 'react';
import type { TimelineClipProps } from './types';
import { THUMB_WIDTH } from './constants';
import { useTimelineStore } from '../../stores/timeline';
import { useMediaStore } from '../../stores/mediaStore';
import { getLabelHex } from '../panels/media/labelColors';
// PickWhip disabled
import { Logger } from '../../services/logger';
import {
  isVectorAnimationSourceType,
  shouldLoopVectorAnimation,
} from '../../types/vectorAnimation';
import { ClipWaveform } from './components/ClipWaveform';
import { ClipAnalysisOverlay } from './components/ClipAnalysisOverlay';
import { FadeCurve } from './components/FadeCurve';
import { useThumbnailCache } from '../../hooks/useThumbnailCache';
import { useTimelineWaveformPyramidState } from './hooks/useTimelineWaveformPyramid';
import { clipRequiresProcessedWaveformPyramid } from '../../services/audio/processedWaveformEligibility';
import { resolveTimelineAudioRegionSelection } from './utils/audioEditSelection';
import type { TimelineAudioRegionEditType } from '../../stores/timeline/types';

const log = Logger.create('TimelineClip');
const KEYFRAME_TICK_SNAP_THRESHOLD_PX = 10;
const TIMELINE_VIEWPORT_FALLBACK_PX = 1600;
const TIMELINE_VIEWPORT_MIN_PX = 1600;
const TIMELINE_RENDER_OVERSCAN_PX = 512;
const THUMBNAIL_RENDER_OVERSCAN_PX = THUMB_WIDTH * 3;
const requestedWaveformPyramidUpgrades = new Set<string>();
const inFlightProcessedWaveformPyramidUpgrades = new Set<string>();

function canLoopExtendVectorClip(clip: TimelineClipProps['clip']): boolean {
  return isVectorAnimationSourceType(clip.source?.type) &&
    shouldLoopVectorAnimation(clip.source.vectorAnimationSettings);
}

type StaticClipIconKind = 'camera' | 'gaussian-splat' | 'model';
type ClipKeyframeTickGroup = NonNullable<TimelineClipProps['keyframeTimeGroups']>[number];
type KeyframeGroupDragState = {
  keyframeIds: string[];
  startX: number;
  startTime: number;
  clipWidth: number;
  clipDuration: number;
};
type AudioRegionDragState = {
  anchorTimelineTime: number;
  startClientX: number;
  rectLeft: number;
  rectWidth: number;
};

function StaticClipIcon({
  kind,
  className,
}: {
  kind: StaticClipIconKind;
  className?: string;
}) {
  if (kind === 'camera') {
    return (
      <svg
        viewBox="0 0 48 48"
        className={className}
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M15 12h18l3 5h4a4 4 0 0 1 4 4v11a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V21a4 4 0 0 1 4-4h4l3-5Z" />
        <circle cx="24" cy="26" r="7" />
        <path d="M37 21h3" />
      </svg>
    );
  }

  if (kind === 'gaussian-splat') {
    return (
      <svg
        viewBox="0 0 48 48"
        className={className}
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M24 11v26M11 24h26M15 15l18 18M33 15 15 33" opacity="0.5" />
        <circle cx="24" cy="24" r="6" fill="currentColor" stroke="none" />
        <circle cx="24" cy="10" r="3.5" fill="currentColor" stroke="none" />
        <circle cx="38" cy="24" r="3.5" fill="currentColor" stroke="none" />
        <circle cx="24" cy="38" r="3.5" fill="currentColor" stroke="none" />
        <circle cx="10" cy="24" r="3.5" fill="currentColor" stroke="none" />
        <circle cx="14.5" cy="14.5" r="2.5" fill="currentColor" stroke="none" />
        <circle cx="33.5" cy="14.5" r="2.5" fill="currentColor" stroke="none" />
        <circle cx="33.5" cy="33.5" r="2.5" fill="currentColor" stroke="none" />
        <circle cx="14.5" cy="33.5" r="2.5" fill="currentColor" stroke="none" />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M24 6 38 14v20L24 42 10 34V14z" />
      <path d="M24 6v16m14-8-14 8-14-8m14 8v20" />
    </svg>
  );
}

function TimelineClipComponent({
  clip,
  trackId,
  track,
  trackBaseHeight,
  tracks,
  clips,
  isSelected,
  isInLinkedGroup,
  isDragging,
  isTrimming,
  isFading,
  isLinkedToDragging,
  isLinkedToTrimming,
  clipDrag,
  clipTrim,
  clipFade: _clipFade,
  zoom,
  scrollX,
  proxyEnabled,
  proxyStatus,
  proxyProgress,
  showTranscriptMarkers,
  toolMode,
  snappingEnabled,
  cutHoverInfo,
  onCutHover,
  onMouseDown,
  onDoubleClick,
  onContextMenu,
  onTrimStart,
  onFadeStart,
  onCutAtPosition,
  hasKeyframes,
  fadeInDuration,
  fadeOutDuration,
  opacityKeyframes,
  allKeyframeTimes,
  keyframeTimeGroups,
  onMoveKeyframeGroup,
  timeToPixel,
  pixelToTime,
  formatTime,
}: TimelineClipProps) {
  const thumbnailsEnabled = useTimelineStore(s => s.thumbnailsEnabled);
  const waveformsEnabled = useTimelineStore(s => s.waveformsEnabled);
  const audioDisplayMode = useTimelineStore(s => s.audioDisplayMode);
  const audioFocusMode = useTimelineStore(s => s.audioFocusMode);
  const audioRegionSelection = useTimelineStore(s =>
    s.audioRegionSelection?.clipId === clip.id ? s.audioRegionSelection : null
  );
  const setAudioRegionSelection = useTimelineStore(s => s.setAudioRegionSelection);
  const clearAudioRegionSelection = useTimelineStore(s => s.clearAudioRegionSelection);
  const hasAudioRegionClipboard = useTimelineStore(s => s.audioRegionClipboard !== null);
  const applyAudioRegionEdit = useTimelineStore(s => s.applyAudioRegionEdit);
  const copySelectedAudioRegion = useTimelineStore(s => s.copySelectedAudioRegion);
  const pasteAudioRegionToSelection = useTimelineStore(s => s.pasteAudioRegionToSelection);
  const setClipAudioEditOperationEnabled = useTimelineStore(s => s.setClipAudioEditOperationEnabled);
  const removeClipAudioEditOperation = useTimelineStore(s => s.removeClipAudioEditOperation);
  const clearClipAudioEditStack = useTimelineStore(s => s.clearClipAudioEditStack);
  const bakeClipAudioEditStack = useTimelineStore(s => s.bakeClipAudioEditStack);
  const processedWaveformPyramidRef = clip.audioState?.processedAnalysisRefs?.processedWaveformPyramidId;
  const sourceWaveformPyramidRef = clip.audioState?.sourceAnalysisRefs?.waveformPyramidId;
  const processedWaveformState = useTimelineWaveformPyramidState(processedWaveformPyramidRef);
  const sourceWaveformState = useTimelineWaveformPyramidState(sourceWaveformPyramidRef);
  const processedWaveformPyramid = processedWaveformState.pyramid;
  const sourceWaveformPyramid = sourceWaveformState.pyramid;
  const waveformPyramid = processedWaveformPyramid ?? sourceWaveformPyramid;
  const waveformVariant = processedWaveformPyramid
    ? 'processed'
    : sourceWaveformPyramid
      ? 'source'
      : 'legacy';
  const waveformProcessingState = processedWaveformPyramidRef && !processedWaveformState.pyramid
    ? `waveform-processed-${processedWaveformState.status}`
    : '';
  const audioEditStack = clip.audioState?.editStack ?? [];
  const activeAudioEditCount = audioEditStack.filter(operation => operation.enabled !== false).length;

  // Subscribe to playhead position only when cut tool is active (avoids re-renders during playback)
  const playheadPosition = useTimelineStore((state) =>
    toolMode === 'cut' ? state.playheadPosition : 0
  );

  // Look up media label color from mediaStore
  const mediaLabelHex = useMediaStore(s => {
    const mediaFileId = clip.mediaFileId || clip.source?.mediaFileId;
    if (clip.compositionId) {
      const comp = s.compositions.find(c => c.id === clip.compositionId);
      if (comp?.labelColor && comp.labelColor !== 'none') return getLabelHex(comp.labelColor);
    }
    if (mediaFileId) {
      const file = s.files.find(f => f.id === mediaFileId);
      if (file?.labelColor && file.labelColor !== 'none') return getLabelHex(file.labelColor);
    }
    // Check special item types — by mediaFileId first, then fallback by name/type
    if (clip.source?.type === 'solid') {
      const solid = mediaFileId
        ? s.solidItems.find(si => si.id === mediaFileId)
        : s.solidItems.find(si => si.name === clip.name);
      if (solid?.labelColor && solid.labelColor !== 'none') return getLabelHex(solid.labelColor);
    }
    if (clip.source?.type === 'text') {
      const text = mediaFileId
        ? s.textItems.find(ti => ti.id === mediaFileId)
        : s.textItems.find(ti => ti.name === clip.name);
      if (text?.labelColor && text.labelColor !== 'none') return getLabelHex(text.labelColor);
    }
    if (clip.source?.type === 'model') {
      const mesh = mediaFileId
        ? (s.meshItems || []).find(m => m.id === mediaFileId)
        : (s.meshItems || []).find(m => m.name === clip.name || m.meshType === clip.meshType);
      if (mesh?.labelColor && mesh.labelColor !== 'none') return getLabelHex(mesh.labelColor);
    }
    if (clip.source?.type === 'camera') {
      const cam = mediaFileId
        ? (s.cameraItems || []).find(c => c.id === mediaFileId)
        : (s.cameraItems || [])[0];
      if (cam?.labelColor && cam.labelColor !== 'none') return getLabelHex(cam.labelColor);
    }
    if (clip.source?.type === 'splat-effector') {
      const effector = mediaFileId
        ? (s.splatEffectorItems || []).find(e => e.id === mediaFileId)
        : (s.splatEffectorItems || []).find(e => e.name === clip.name);
      if (effector?.labelColor && effector.labelColor !== 'none') return getLabelHex(effector.labelColor);
    }
    return null;
  });

  // Animation phase for enter/exit transitions
  const clipAnimationPhase = useTimelineStore(s => s.clipAnimationPhase);
  const compositionSwitchDirection = useTimelineStore(s => s.compositionSwitchDirection);
  const clipEntranceKey = useTimelineStore(s => s.clipEntranceAnimationKey);
  const [mountEntranceKey] = useState(clipEntranceKey);

  // Only compute stagger order during composition entrance animation. Doing a
  // full clips sort inside every TimelineClip render gets very expensive once
  // AI splits create hundreds of clips.
  const animationDelay = clipAnimationPhase === 'entering'
    ? Math.max(0, (() => {
        const sorted = [...clips].sort((a, b) => {
          const aTrack = tracks.findIndex(t => t.id === a.trackId);
          const bTrack = tracks.findIndex(t => t.id === b.trackId);
          if (aTrack !== bTrack) return aTrack - bTrack;
          return a.startTime - b.startTime;
        });
        return sorted.findIndex(c => c.id === clip.id);
      })()) * 0.02
    : 0;

  // Determine animation class:
  // - 'exiting': apply exit animation
  // - 'entering' + new clips: apply entrance animation (only during composition switch)
  // - Otherwise: no animation
  const isNewClip = mountEntranceKey === clipEntranceKey && clipEntranceKey > 0;
  const exitAnimationClass = compositionSwitchDirection === 'backward'
    ? 'exit-animate exit-animate-left'
    : 'exit-animate exit-animate-right';
  const entranceAnimationClass = compositionSwitchDirection === 'backward'
    ? 'entrance-animate entrance-animate-right'
    : 'entrance-animate entrance-animate-left';
  const animationClass = clipAnimationPhase === 'exiting'
    ? exitAnimationClass
    : (clipAnimationPhase === 'entering' && isNewClip)
      ? entranceAnimationClass
      : '';

  // AI move animation (FLIP technique)
  const aiMove = useTimelineStore(s => s.aiMovingClips.get(clip.id));
  const [aiMovePhase, setAiMovePhase] = useState<'idle' | 'initial' | 'animating'>('idle');
  const aiMoveRef = useRef<number | null>(null);
  const aiMoveStartedAt = aiMove?.startedAt;
  const aiMoveDuration = aiMove?.animationDuration ?? 200;

  useEffect(() => {
    if (aiMoveStartedAt !== undefined) {
      // Double-rAF to ensure the initial transform is painted before starting transition
      const raf1 = requestAnimationFrame(() => {
        setAiMovePhase('initial');
        const raf2 = requestAnimationFrame(() => {
          setAiMovePhase('animating');
        });
        aiMoveRef.current = raf2;
      });
      const timer = setTimeout(() => {
        setAiMovePhase('idle');
      }, aiMoveDuration + 50);
      return () => {
        cancelAnimationFrame(raf1);
        if (aiMoveRef.current) cancelAnimationFrame(aiMoveRef.current);
        clearTimeout(timer);
      };
    } else {
      const frame = requestAnimationFrame(() => setAiMovePhase('idle'));
      return () => cancelAnimationFrame(frame);
    }
  }, [aiMoveDuration, aiMoveStartedAt]);

  // Check if this clip should show cut indicator (either directly hovered or linked to hovered clip)
  const isDirectlyHovered = cutHoverInfo?.clipId === clip.id;
  const linkedClip = clip.linkedClipId ? clips.find(c => c.id === clip.linkedClipId) : null;
  const isLinkedToHovered = linkedClip && cutHoverInfo?.clipId === linkedClip.id;
  // Also check reverse link - if another clip links to this one
  const reverseLinkedClip = clips.find(c => c.linkedClipId === clip.id);
  const isReverseLinkedToHovered = reverseLinkedClip && cutHoverInfo?.clipId === reverseLinkedClip.id;
  const shouldShowCutIndicator = toolMode === 'cut' && cutHoverInfo && (isDirectlyHovered || isLinkedToHovered || isReverseLinkedToHovered);

  // Determine if this is an audio clip (check source type, MIME type, or extension as fallback)
  const audioExtensions = ['wav', 'mp3', 'ogg', 'flac', 'aac', 'm4a', 'wma', 'aiff', 'opus'];
  const fileExt = (clip.file?.name || clip.name || '').split('.').pop()?.toLowerCase() || '';
  const isAudioClip = clip.source?.type === 'audio' ||
    clip.file?.type?.startsWith('audio/') ||
    audioExtensions.includes(fileExt);

  // Determine if this is a text clip
  const isTextClip = clip.source?.type === 'text';
  const meshType = clip.meshType ?? clip.source?.meshType;
  const isText3DClip = clip.source?.type === 'model' && meshType === 'text3d';
  const isModelClip = clip.source?.type === 'model' && !isText3DClip;
  const text3DProperties = clip.text3DProperties ?? clip.source?.text3DProperties;

  // Determine if this is a solid clip
  const isSolidClip = clip.source?.type === 'solid';
  const isMathSceneClip = clip.source?.type === 'math-scene';
  const isVectorAnimationClip = isVectorAnimationSourceType(clip.source?.type);
  const vectorAnimationIcon = clip.source?.type === 'rive' ? 'R' : 'L';
  const vectorAnimationTitle = clip.source?.type === 'rive' ? 'Rive Clip' : 'Lottie Clip';
  const isCameraClip = clip.source?.type === 'camera';
  const isGaussianSplatClip = clip.source?.type === 'gaussian-splat';
  const isSplatEffectorClip = clip.source?.type === 'splat-effector';
  const staticClipIconKind: StaticClipIconKind | null = isCameraClip
    ? 'camera'
    : isGaussianSplatClip
      ? 'gaussian-splat'
      : isModelClip
        ? 'model'
        : null;
  const showsStaticClipArtwork = staticClipIconKind !== null;

  const isGeneratingProxy = proxyStatus === 'generating';
  const hasProxy = proxyStatus === 'ready';
  const hasProxyError = proxyStatus === 'error';

  // Check if this clip is linked to the dragging/trimming clip
  const draggedClip = clipDrag
    ? clips.find((c) => c.id === clipDrag.clipId)
    : null;
  const trimmedClip = clipTrim
    ? clips.find((c) => c.id === clipTrim.clipId)
    : null;

  // Calculate live trim values (including inPoint/outPoint for waveform/thumbnail rendering)
  let displayStartTime = clip.startTime;
  let displayDuration = clip.duration;
  let displayInPoint = clip.inPoint;
  let displayOutPoint = clip.outPoint;

  if (isTrimming && clipTrim) {
    const deltaX = clipTrim.currentX - clipTrim.startX;
    const deltaTime = pixelToTime(deltaX);
    const sourceType = clip.source?.type;
    const isInfiniteClip = sourceType === 'text' || sourceType === 'image' || sourceType === 'solid' || sourceType === 'camera' || sourceType === 'splat-effector' || sourceType === 'math-scene';
    const canLoopExtendRight = canLoopExtendVectorClip(clip);
    const maxDuration = isInfiniteClip
      ? Number.MAX_SAFE_INTEGER
      : (clip.source?.naturalDuration || clip.duration);

    if (clipTrim.edge === 'left') {
      const maxTrim = clipTrim.originalDuration - 0.1;
      const minTrim = isInfiniteClip
        ? -clipTrim.originalStartTime
        : -clipTrim.originalInPoint;
      const clampedDelta = Math.max(minTrim, Math.min(maxTrim, deltaTime));
      displayStartTime = clipTrim.originalStartTime + clampedDelta;
      displayDuration = clipTrim.originalDuration - clampedDelta;
      // Update inPoint when trimming left edge
      displayInPoint = clipTrim.originalInPoint + clampedDelta;
    } else {
      const maxExtend = canLoopExtendRight
        ? Number.MAX_SAFE_INTEGER
        : maxDuration - clipTrim.originalOutPoint;
      const minTrim = -(clipTrim.originalDuration - 0.1);
      const clampedDelta = Math.max(minTrim, Math.min(maxExtend, deltaTime));
      displayDuration = clipTrim.originalDuration + clampedDelta;
      // Update outPoint when trimming right edge
      displayOutPoint = clipTrim.originalOutPoint + clampedDelta;
    }
  } else if (isLinkedToTrimming && clipTrim && trimmedClip) {
    // Apply same trim to linked clip visually
    const deltaX = clipTrim.currentX - clipTrim.startX;
    const deltaTime = pixelToTime(deltaX);
    const canLoopExtendRight = canLoopExtendVectorClip(clip);
    const maxDuration = clip.source?.naturalDuration || clip.duration;

    if (clipTrim.edge === 'left') {
      const maxTrim = clip.duration - 0.1;
      const minTrim = -clip.inPoint;
      const clampedDelta = Math.max(minTrim, Math.min(maxTrim, deltaTime));
      displayStartTime = clip.startTime + clampedDelta;
      displayDuration = clip.duration - clampedDelta;
      displayInPoint = clip.inPoint + clampedDelta;
    } else {
      const maxExtend = canLoopExtendRight
        ? Number.MAX_SAFE_INTEGER
        : maxDuration - clip.outPoint;
      const minTrim = -(clip.duration - 0.1);
      const clampedDelta = Math.max(minTrim, Math.min(maxExtend, deltaTime));
      displayDuration = clip.duration + clampedDelta;
      displayOutPoint = clip.outPoint + clampedDelta;
    }
  }

  const width = timeToPixel(displayDuration);

  // Calculate position - if dragging, use the computed position (with snapping/resistance)
  let left = timeToPixel(displayStartTime);
  if (isDragging && clipDrag) {
    // Always use snappedTime when available - it contains the position with snapping and resistance applied
    if (clipDrag.snappedTime !== null) {
      left = timeToPixel(clipDrag.snappedTime);
    }
  } else if (isLinkedToDragging && clipDrag && draggedClip) {
    // Move linked clip in sync - use computed position (snapped + resistance) if available
    if (clipDrag.snappedTime !== null) {
      const newDragTime = clipDrag.snappedTime;
      const timeDelta = newDragTime - draggedClip.startTime;
      left = timeToPixel(Math.max(0, clip.startTime + timeDelta));
    }
  } else if (clipDrag?.multiSelectClipIds?.includes(clip.id) && clipDrag.multiSelectTimeDelta !== undefined) {
    // This clip is part of multi-select drag (but not the primary dragged clip)
    left = timeToPixel(Math.max(0, clip.startTime + clipDrag.multiSelectTimeDelta));
  }
  const timelineViewportWidth = typeof window === 'undefined'
    ? TIMELINE_VIEWPORT_FALLBACK_PX
    : Math.max(TIMELINE_VIEWPORT_MIN_PX, window.innerWidth);
  const waveformRenderStartPx = Math.max(0, scrollX - left - TIMELINE_RENDER_OVERSCAN_PX);
  const waveformRenderEndPx = Math.min(width, scrollX - left + timelineViewportWidth + TIMELINE_RENDER_OVERSCAN_PX);
  const waveformRenderWindow = {
    startPx: waveformRenderStartPx,
    width: Math.max(0, waveformRenderEndPx - waveformRenderStartPx),
  };
  const thumbnailRenderStartPx = Math.max(0, scrollX - left - THUMBNAIL_RENDER_OVERSCAN_PX);
  const thumbnailRenderEndPx = Math.min(width, scrollX - left + timelineViewportWidth + THUMBNAIL_RENDER_OVERSCAN_PX);
  const thumbnailRenderWindow = {
    startPx: thumbnailRenderStartPx,
    width: Math.max(0, thumbnailRenderEndPx - thumbnailRenderStartPx),
  };
  const sourceSpan = Math.max(0, displayOutPoint - displayInPoint);
  const thumbnailVisibleInPoint = displayInPoint + sourceSpan * (thumbnailRenderWindow.startPx / Math.max(1, width));
  const thumbnailVisibleOutPoint = displayInPoint + sourceSpan * (
    (thumbnailRenderWindow.startPx + thumbnailRenderWindow.width) / Math.max(1, width)
  );

  useEffect(() => {
    if (!waveformsEnabled || !isAudioClip || sourceWaveformPyramidRef || clip.waveformGenerating || !clip.file) {
      return;
    }

    const shouldUpgrade =
      audioDisplayMode !== 'compact' ||
      zoom >= 250 ||
      width > 16_384;

    if (!shouldUpgrade) return;

    const fileKey = [
      clip.id,
      clip.file.name,
      clip.file.size,
      clip.file.lastModified,
    ].join(':');

    if (requestedWaveformPyramidUpgrades.has(fileKey)) return;
    requestedWaveformPyramidUpgrades.add(fileKey);

    const timer = window.setTimeout(() => {
      const { clips: currentClips, generateWaveformForClip } = useTimelineStore.getState();
      const currentClip = currentClips.find(current => current.id === clip.id);
      if (
        !currentClip ||
        currentClip.waveformGenerating ||
        currentClip.audioState?.sourceAnalysisRefs?.waveformPyramidId
      ) {
        return;
      }

      void generateWaveformForClip(clip.id);
    }, 300);

    return () => window.clearTimeout(timer);
  }, [
    audioDisplayMode,
    clip.file,
    clip.id,
    clip.waveformGenerating,
    isAudioClip,
    sourceWaveformPyramidRef,
    waveformsEnabled,
    width,
    zoom,
  ]);

  const processedWaveformRequestKey = [
    clip.id,
    clip.inPoint,
    clip.outPoint,
    clip.duration,
    clip.speed ?? 1,
    clip.reversed === true,
    clip.preservesPitch !== false,
    clip.audioState?.sourceAudioRevisionId ?? '',
    clip.audioState?.muted === true,
    JSON.stringify(clip.audioState?.editStack ?? []),
    JSON.stringify(clip.audioState?.effectStack ?? []),
    JSON.stringify((clip.effects ?? []).filter(effect => effect.type === 'audio-eq' || effect.type === 'audio-volume')),
  ].join(':');

  useEffect(() => {
    if (
      !waveformsEnabled ||
      !isAudioClip ||
      processedWaveformPyramidRef ||
      clip.waveformGenerating ||
      inFlightProcessedWaveformPyramidUpgrades.has(processedWaveformRequestKey)
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      const store = useTimelineStore.getState();
      const currentClip = store.clips.find(current => current.id === clip.id);
      if (
        !currentClip ||
        currentClip.waveformGenerating ||
        currentClip.audioState?.processedAnalysisRefs?.processedWaveformPyramidId
      ) {
        return;
      }

      const keyframes = store.clipKeyframes.get(currentClip.id) ?? [];
      if (!clipRequiresProcessedWaveformPyramid(currentClip, keyframes)) {
        return;
      }

      inFlightProcessedWaveformPyramidUpgrades.add(processedWaveformRequestKey);
      void store.generateProcessedWaveformForClip(currentClip.id)
        .finally(() => {
          inFlightProcessedWaveformPyramidUpgrades.delete(processedWaveformRequestKey);
        });
    }, 500);

    return () => window.clearTimeout(timer);
  }, [
    clip.id,
    clip.waveformGenerating,
    isAudioClip,
    processedWaveformPyramidRef,
    processedWaveformRequestKey,
    waveformsEnabled,
  ]);

  const waveformNaturalDuration = processedWaveformPyramid
    ? Math.max(0.001, processedWaveformPyramid.duration)
    : (clip.source?.naturalDuration || clip.duration);
  const waveformInPoint = processedWaveformPyramid ? 0 : displayInPoint;
  const waveformOutPoint = processedWaveformPyramid
    ? Math.max(0.001, processedWaveformPyramid.duration)
    : displayOutPoint;

  const clipMetaOffset = clip.isLoading
    ? 0
    : Math.min(
        Math.max(0, scrollX - left),
        Math.max(0, width - 48)
      );

  // Render only the visible filmstrip window. At deep zoom the full clip can be
  // hundreds of thousands of pixels wide, so tying thumbnails to full clip width
  // makes the entire timeline unresponsive.
  const visibleThumbs = thumbnailRenderWindow.width > 0
    ? Math.max(1, Math.ceil(thumbnailRenderWindow.width / THUMB_WIDTH) + 1)
    : 0;

  // Source-based thumbnail cache: pull thumbnails from cache by mediaFileId
  const sourceMediaFileId = clip.source?.mediaFileId || clip.mediaFileId;
  const isCompositionWithSegments = clip.isComposition && clip.clipSegments && clip.clipSegments.length > 0;
  const useSourceCache = clip.source?.type === 'video' && !!sourceMediaFileId && !isCompositionWithSegments;
  const cachedThumbnails = useThumbnailCache(
    useSourceCache ? sourceMediaFileId : undefined,
    thumbnailVisibleInPoint,
    thumbnailVisibleOutPoint,
    visibleThumbs,
    clip.reversed
  );
  // Fallback to clip.thumbnails for compositions/legacy clips without mediaFileId
  const legacyThumbnails = clip.thumbnails || [];
  const compositionSegments = clip.clipSegments ?? [];
  const showSegmentThumbnails = thumbnailsEnabled &&
    clip.isComposition &&
    compositionSegments.length > 0 &&
    !isAudioClip &&
    !showsStaticClipArtwork;
  const showRegularThumbnails = thumbnailsEnabled &&
    !isAudioClip &&
    !showsStaticClipArtwork &&
    !isCompositionWithSegments &&
    (useSourceCache ? cachedThumbnails.some(Boolean) : legacyThumbnails.length > 0);

  const keyframeTickGroups: ClipKeyframeTickGroup[] = keyframeTimeGroups ?? allKeyframeTimes.map(time => ({
    time,
    keyframeIds: [],
  }));
  const [keyframeGroupDrag, setKeyframeGroupDrag] = useState<KeyframeGroupDragState | null>(null);
  const [audioRegionDrag, setAudioRegionDrag] = useState<AudioRegionDragState | null>(null);
  const [audioBakePending, setAudioBakePending] = useState(false);

  const handleKeyframeTickMouseDown = (
    e: React.MouseEvent<HTMLButtonElement>,
    group: ClipKeyframeTickGroup
  ) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (!onMoveKeyframeGroup || group.keyframeIds.length === 0) return;

    setKeyframeGroupDrag({
      keyframeIds: group.keyframeIds,
      startX: e.clientX,
      startTime: group.time,
      clipWidth: Math.max(1, width),
      clipDuration: Math.max(0.001, displayDuration),
    });
  };

  useEffect(() => {
    if (!keyframeGroupDrag || !onMoveKeyframeGroup) return;

    const handleDocumentMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      const deltaX = e.clientX - keyframeGroupDrag.startX;
      const deltaTime = (deltaX / keyframeGroupDrag.clipWidth) * keyframeGroupDrag.clipDuration;
      let newTime = Math.max(
        0,
        Math.min(keyframeGroupDrag.clipDuration, keyframeGroupDrag.startTime + deltaTime)
      );

      if (e.shiftKey) {
        const movingIds = new Set(keyframeGroupDrag.keyframeIds);
        let bestDistancePx = KEYFRAME_TICK_SNAP_THRESHOLD_PX;

        for (const group of keyframeTickGroups) {
          if (group.keyframeIds.some(id => movingIds.has(id))) continue;

          const distancePx = Math.abs(
            ((group.time - newTime) / keyframeGroupDrag.clipDuration) * keyframeGroupDrag.clipWidth
          );

          if (distancePx <= bestDistancePx) {
            bestDistancePx = distancePx;
            newTime = group.time;
          }
        }
      }

      onMoveKeyframeGroup(keyframeGroupDrag.keyframeIds, newTime);
    };

    const handleDocumentMouseUp = () => {
      setKeyframeGroupDrag(null);
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [keyframeGroupDrag, keyframeTickGroups, onMoveKeyframeGroup]);

  const canSelectAudioRegion = audioFocusMode &&
    isAudioClip &&
    audioDisplayMode !== 'compact' &&
    toolMode === 'select' &&
    track.locked !== true;

  const timelineTimeFromAudioRegionClientX = useCallback((
    clientX: number,
    drag: Pick<AudioRegionDragState, 'rectLeft' | 'rectWidth'>,
  ): number => {
    const x = Math.max(0, Math.min(drag.rectWidth, clientX - drag.rectLeft));
    return displayStartTime + (x / Math.max(1, drag.rectWidth)) * Math.max(0.001, displayDuration);
  }, [displayDuration, displayStartTime]);

  const resolveAudioRegionDragSelection = useCallback((
    drag: AudioRegionDragState,
    clientX: number,
  ) => resolveTimelineAudioRegionSelection({
    clip: {
      ...clip,
      startTime: displayStartTime,
      duration: displayDuration,
      inPoint: displayInPoint,
      outPoint: displayOutPoint,
      waveform: clip.waveform,
    },
    anchorTimelineTime: drag.anchorTimelineTime,
    focusTimelineTime: timelineTimeFromAudioRegionClientX(clientX, drag),
    snapThresholdSeconds: Math.min(0.035, Math.max(0.002, 7 / Math.max(1, zoom))),
  }), [
    clip,
    displayDuration,
    displayInPoint,
    displayOutPoint,
    displayStartTime,
    timelineTimeFromAudioRegionClientX,
    zoom,
  ]);

  const handleAudioRegionMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canSelectAudioRegion || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const rect = e.currentTarget.getBoundingClientRect();
    const drag: AudioRegionDragState = {
      anchorTimelineTime: timelineTimeFromAudioRegionClientX(e.clientX, {
        rectLeft: rect.left,
        rectWidth: rect.width,
      }),
      startClientX: e.clientX,
      rectLeft: rect.left,
      rectWidth: rect.width,
    };

    setAudioRegionDrag(drag);
    setAudioRegionSelection(resolveAudioRegionDragSelection(drag, e.clientX));
  };

  useEffect(() => {
    if (!audioRegionDrag || !canSelectAudioRegion) return;

    const handleDocumentMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      setAudioRegionSelection(resolveAudioRegionDragSelection(audioRegionDrag, e.clientX));
    };

    const handleDocumentMouseUp = (e: MouseEvent) => {
      if (Math.abs(e.clientX - audioRegionDrag.startClientX) < 3) {
        clearAudioRegionSelection();
      }
      setAudioRegionDrag(null);
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [
    audioRegionDrag,
    canSelectAudioRegion,
    clearAudioRegionSelection,
    resolveAudioRegionDragSelection,
    setAudioRegionSelection,
  ]);

  // Track filtering
  if (isDragging && clipDrag && clipDrag.currentTrackId !== trackId) {
    return null;
  }
  if (!isDragging && !isLinkedToDragging && clip.trackId !== trackId) {
    return null;
  }
  if (clip.trackId !== trackId && !isDragging) {
    return null;
  }

  // Determine clip type class (audio, video, text, or image)
  const clipTypeClass = isSolidClip ? 'solid' : isMathSceneClip ? 'math-scene' : (isTextClip || isText3DClip) ? 'text' : isCameraClip ? 'camera' : isSplatEffectorClip ? 'splat-effector' : isAudioClip ? 'audio' : (clip.source?.type || 'video');

  // Check if this clip is part of a multi-select drag
  const isInMultiSelectDrag = clipDrag?.multiSelectClipIds?.includes(clip.id) && clipDrag.multiSelectTimeDelta !== undefined;
  const isTrackLocked = track.locked === true;

  const clipClass = [
    'timeline-clip',
    isSelected ? 'selected' : '',
    isInLinkedGroup ? 'linked-group' : '',
    isDragging ? 'dragging' : '',
    isInMultiSelectDrag ? 'dragging multiselect-dragging' : '',
    isLinkedToDragging ? 'linked-dragging' : '',
    isTrimming ? 'trimming' : '',
    isLinkedToTrimming ? 'linked-trimming' : '',
    isFading ? 'fading' : '',
    isDragging && clipDrag?.forcingOverlap ? 'forcing-overlap' : '',
    clipTypeClass,
    isAudioClip ? `audio-mode-${audioDisplayMode}` : '',
    isAudioClip && audioFocusMode ? 'audio-focus-active' : '',
    audioRegionSelection ? 'audio-region-selected' : '',
    clip.isLoading ? 'loading' : '',
    clip.needsReload ? 'needs-reload' : '',
    hasProxy ? 'has-proxy' : '',
    isGeneratingProxy ? 'generating-proxy' : '',
    hasProxyError ? 'proxy-error' : '',
    hasKeyframes(clip.id) ? 'has-keyframes' : '',
    clip.reversed ? 'reversed' : '',
    clip.transcriptStatus === 'ready' ? 'has-transcript' : '',
    clip.waveformGenerating ? 'generating-waveform' : '',
    waveformProcessingState,
    clip.parentClipId ? 'has-parent' : '',
    clip.isPendingDownload ? 'pending-download' : '',
    clip.downloadError ? 'download-error' : '',
    clip.isComposition ? 'composition' : '',
    aiMovePhase !== 'idle' ? 'ai-moving' : '',
    isTrackLocked ? 'track-locked' : '',
  ]
    .filter(Boolean)
    .join(' ');

  // Cut tool snapping helper
  const snapCutTime = (rawTime: number, shouldSnap: boolean): number => {
    log.debug('CUT SNAP', { shouldSnap, snappingEnabled, rawTime, zoom, playheadPosition });
    if (!shouldSnap) return rawTime;

    const snapThresholdPixels = 10;
    const snapThresholdTime = snapThresholdPixels / zoom;

    // Collect snap targets: playhead and all clip edges
    const snapTargets: number[] = [playheadPosition];
    clips.forEach(c => {
      snapTargets.push(c.startTime);
      snapTargets.push(c.startTime + c.duration);
    });

    log.debug('CUT SNAP targets:', { snapTargets, threshold: snapThresholdTime });

    // Find nearest snap target
    let nearestTarget = rawTime;
    let nearestDistance = Infinity;
    for (const target of snapTargets) {
      const distance = Math.abs(target - rawTime);
      if (distance < nearestDistance && distance <= snapThresholdTime) {
        nearestDistance = distance;
        nearestTarget = target;
      }
    }

    log.debug('CUT SNAP result:', { nearestTarget, nearestDistance, snapped: nearestTarget !== rawTime });
    return nearestTarget;
  };

  // Cut tool handlers
  const handleMouseMove = (e: React.MouseEvent) => {
    if (toolMode !== 'cut') {
      if (cutHoverInfo?.clipId === clip.id) onCutHover(null, null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    // Convert pixel position to time
    const rawCutTime = displayStartTime + (x / width) * displayDuration;
    // When snapping enabled: snap by default, Alt temporarily disables
    // When snapping disabled: don't snap, Alt temporarily enables
    const shouldSnap = snappingEnabled !== e.altKey;
    const cutTime = snapCutTime(rawCutTime, shouldSnap);
    onCutHover(clip.id, cutTime);
  };

  const handleMouseLeave = () => {
    if (cutHoverInfo?.clipId === clip.id) onCutHover(null, null);
  };

  const handleClick = (e: React.MouseEvent) => {
    if (toolMode !== 'cut') return;
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    // Convert pixel position to time within clip
    const rawCutTime = displayStartTime + (x / width) * displayDuration;
    // When snapping enabled: snap by default, Alt temporarily disables
    // When snapping disabled: don't snap, Alt temporarily enables
    const shouldSnap = snappingEnabled !== e.altKey;
    const cutTime = snapCutTime(rawCutTime, shouldSnap);
    onCutAtPosition(clip.id, cutTime);
    onCutHover(null, null);
  };

  // Calculate cut indicator position for this clip
  const cutIndicatorX = shouldShowCutIndicator && cutHoverInfo
    ? ((cutHoverInfo.time - displayStartTime) / displayDuration) * width
    : null;
  const audioRegionOverlay = audioRegionSelection && audioRegionSelection.endTime - audioRegionSelection.startTime > 0.001
    ? (() => {
        const regionStart = Math.max(displayStartTime, audioRegionSelection.startTime);
        const regionEnd = Math.min(displayStartTime + displayDuration, audioRegionSelection.endTime);
        if (regionEnd <= regionStart) return null;
        return {
          left: ((regionStart - displayStartTime) / Math.max(0.001, displayDuration)) * width,
          width: ((regionEnd - regionStart) / Math.max(0.001, displayDuration)) * width,
        };
      })()
    : null;
  const handleApplyAudioRegionEdit = (type: TimelineAudioRegionEditType) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    applyAudioRegionEdit(type);
  };
  const handleCopyAudioRegion = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    copySelectedAudioRegion();
  };
  const handlePasteAudioRegion = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    pasteAudioRegionToSelection();
  };
  const handleAudioEditStackMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const handleBakeAudioEditStack = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (audioBakePending) return;
    setAudioBakePending(true);
    void bakeClipAudioEditStack(clip.id).finally(() => {
      setAudioBakePending(false);
    });
  };
  const handleClearAudioEditStack = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    clearClipAudioEditStack(clip.id);
  };

  return (
    <div
      className={`${clipClass}${toolMode === 'cut' ? ' cut-mode' : ''} ${animationClass}`}
      style={{
        left,
        width,
        cursor: isTrackLocked ? 'not-allowed' : toolMode === 'cut' ? 'crosshair' : undefined,
        animationDelay: `${animationDelay}s`,
        // FLIP move animation: initial phase applies offset transform, animating phase transitions to 0
        ...(aiMovePhase === 'initial' && aiMove ? {
          transform: `translateX(${timeToPixel(aiMove.fromStartTime) - left}px)`,
        } : aiMovePhase === 'animating' && aiMove ? {
          transform: 'translateX(0)',
          transition: `transform ${aiMove.animationDuration}ms cubic-bezier(0.22, 1, 0.36, 1)`,
        } : {}),
        ...(isSolidClip && clip.solidColor ? {
          background: clip.solidColor,
          borderColor: clip.solidColor,
        } : mediaLabelHex ? {
          background: mediaLabelHex,
          borderColor: mediaLabelHex,
        } : {}),
      }}
      data-clip-id={clip.id}
      onMouseDown={isTrackLocked || toolMode === 'cut' ? undefined : onMouseDown}
      onDoubleClick={toolMode === 'cut' ? undefined : onDoubleClick}
      onContextMenu={onContextMenu}
      onMouseMove={isTrackLocked ? undefined : handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={isTrackLocked ? undefined : handleClick}
    >
      {/* Cut indicator line */}
      {shouldShowCutIndicator && cutIndicatorX !== null && cutIndicatorX >= 0 && cutIndicatorX <= width && (
        <div
          className="cut-indicator"
          style={{ left: cutIndicatorX }}
        />
      )}
      {/* YouTube pending download preview */}
      {clip.isPendingDownload && clip.youtubeThumbnail && (
        <div
          className="clip-youtube-preview"
          style={{ backgroundImage: `url(${clip.youtubeThumbnail})` }}
        />
      )}
      {/* Download progress bar */}
      {clip.isPendingDownload && !clip.downloadError && (
        <>
          <div className="clip-download-progress">
            <div
              className="clip-download-progress-bar"
              style={{ width: `${clip.downloadProgress || 0}%` }}
            />
          </div>
          <div className="clip-download-status">
            <div className="download-spinner" />
            <span>Downloading {Math.round(clip.downloadProgress || 0)}%{clip.downloadSpeed ? ` \u00B7 ${clip.downloadSpeed}` : ''}</span>
          </div>
        </>
      )}
      {/* Download error badge */}
      {clip.downloadError && (
        <div className="clip-download-error-badge" title={clip.downloadError}>
          Error
        </div>
      )}
      {/* Proxy generating indicator - fill badge */}
      {isGeneratingProxy && (
        <div className="clip-proxy-generating" title={`Generating proxy: ${proxyProgress}%`}>
          <span className="proxy-fill-badge">
            <span className="proxy-fill-bg">P</span>
            <span
              className="proxy-fill-progress"
              style={{ height: `${proxyProgress}%` }}
            >P</span>
          </span>
          <span className="proxy-percent">{proxyProgress}%</span>
        </div>
      )}
      {/* Proxy ready indicator */}
      {hasProxy && proxyEnabled && !isGeneratingProxy && (
        <div className="clip-proxy-badge" title="Proxy ready">
          P
        </div>
      )}
      {hasProxyError && (
        <div className="clip-proxy-error" title="Proxy generation failed">
          P!
        </div>
      )}
      {/* Reversed indicator */}
      {clip.reversed && (
        <div className="clip-reversed-badge" title="Reversed playback">
          {'\u27F2'}
        </div>
      )}
      {/* Linked group indicator */}
      {isInLinkedGroup && (
        <div className="clip-linked-group-badge" title="Multicam linked group">
          {'\u26D3'}
        </div>
      )}
      {/* Transcript badge with coverage fill */}
      {clip.transcriptStatus === 'ready' && clip.transcript && clip.transcript.length > 0 && (() => {
        const clipIn = clip.inPoint ?? 0;
        const clipOut = clip.outPoint ?? clip.duration;
        const clipDur = clipOut - clipIn;
        if (clipDur <= 0) return null;
        // Use transcribedRanges from MediaFile for coverage (silence still counts as transcribed)
        const mediaFileId = clip.source?.mediaFileId || clip.mediaFileId;
        const mediaFile = mediaFileId ? useMediaStore.getState().files.find(f => f.id === mediaFileId) : null;
        const ranges = mediaFile?.transcribedRanges ?? [];
        let pct = 0;
        if (ranges.length > 0) {
          // Intersect transcribed ranges with clip's [inPoint, outPoint]
          let covered = 0;
          for (const [rs, re] of ranges) {
            const s = Math.max(rs, clipIn);
            const e = Math.min(re, clipOut);
            if (s < e) covered += e - s;
          }
          pct = Math.min(100, Math.round((covered / clipDur) * 100));
        } else {
          // Fallback: use word envelope for old data without transcribedRanges
          const wordsInRange = clip.transcript!.filter(w => w.end > clipIn && w.start < clipOut);
          if (wordsInRange.length > 0) {
            const minStart = Math.max(clipIn, Math.min(...wordsInRange.map(w => w.start)));
            const maxEnd = Math.min(clipOut, Math.max(...wordsInRange.map(w => w.end)));
            pct = Math.min(100, Math.round(((maxEnd - minStart) / clipDur) * 100));
          }
        }
        if (pct <= 0) return null;
        return pct >= 100 ? (
          <div className="clip-transcript-badge" title="Fully transcribed">T</div>
        ) : (
          <div className="clip-transcript-badge clip-badge-fill" title={`${pct}% transcribed`}>
            <span className="clip-badge-bg">T</span>
            <span className="clip-badge-progress clip-badge-transcript-fill" style={{ height: `${pct}%` }}>T</span>
          </div>
        );
      })()}
      {/* Analysis badge with coverage fill */}
      {!isAudioClip && (clip.analysisStatus === 'ready' || clip.sceneDescriptionStatus === 'ready') && (() => {
        const clipIn = clip.inPoint ?? 0;
        const clipOut = clip.outPoint ?? clip.duration;
        const clipDur = clipOut - clipIn;
        if (clipDur <= 0) return null;
        // Calculate coverage from analysis frame timestamps
        let pct = 100;
        if (clip.analysis?.frames?.length) {
          const frames = clip.analysis.frames;
          const interval = (clip.analysis.sampleInterval || 500) / 1000;
          const framesInRange = frames.filter((f) => f.timestamp >= clipIn && f.timestamp < clipOut);
          const coveredTime = framesInRange.length * interval;
          pct = Math.min(100, Math.round((coveredTime / clipDur) * 100));
        }
        return pct >= 100 ? (
          <div className="clip-analysis-badge" title="Fully analyzed">A</div>
        ) : (
          <div className="clip-analysis-badge clip-badge-fill" title={`${pct}% analyzed`}>
            <span className="clip-badge-bg">A</span>
            <span className="clip-badge-progress clip-badge-analysis-fill" style={{ height: `${pct}%` }}>A</span>
          </div>
        );
      })()}
      {/* Waveform generation progress indicator */}
      {clip.waveformGenerating && (
        <div className="clip-waveform-indicator">
          <div className="waveform-progress" style={{ width: `${clip.waveformProgress || 50}%` }} />
        </div>
      )}
      {/* Audio waveform */}
      {waveformsEnabled && isAudioClip && clip.waveform && clip.waveform.length > 0 && (
        <div className="clip-waveform">
          <ClipWaveform
            waveform={clip.waveform}
            width={width}
            height={Math.max(20, trackBaseHeight - 12)}
            inPoint={waveformInPoint}
            outPoint={waveformOutPoint}
            naturalDuration={waveformNaturalDuration}
            displayMode={audioDisplayMode}
            pixelsPerSecond={zoom}
            pyramid={waveformPyramid}
            waveformVariant={waveformVariant}
            renderStartPx={waveformRenderWindow.startPx}
            renderWidth={waveformRenderWindow.width}
          />
        </div>
      )}
      {audioRegionOverlay && (
        <div
          className={`clip-audio-region-selection ${audioRegionSelection?.snappedToZeroCrossing ? 'snapped' : ''}`}
          style={{
            left: audioRegionOverlay.left,
            width: audioRegionOverlay.width,
          }}
        >
          <span className="clip-audio-region-edge left" />
          <span className="clip-audio-region-edge right" />
        </div>
      )}
      {audioRegionOverlay && canSelectAudioRegion && (
        <div
          className="clip-audio-region-toolbar"
          style={{ left: Math.max(4, audioRegionOverlay.left) }}
          onMouseDown={handleAudioEditStackMouseDown}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <button type="button" onClick={handleCopyAudioRegion} title="Copy selected audio region">Copy</button>
          <button type="button" onClick={handlePasteAudioRegion} disabled={!hasAudioRegionClipboard} title="Paste copied audio into selected region">Paste</button>
          <button type="button" onClick={handleApplyAudioRegionEdit('silence')} title="Replace selected region with silence">Sil</button>
          <button type="button" onClick={handleApplyAudioRegionEdit('insert-silence')} title="Insert silence at selected region start while preserving clip duration">Ins</button>
          <button type="button" onClick={handleApplyAudioRegionEdit('delete-silence')} title="Delete selected audio and fill the tail with silence">Del</button>
          <button type="button" onClick={handleApplyAudioRegionEdit('reverse')} title="Reverse selected region">Rev</button>
          <button type="button" onClick={handleApplyAudioRegionEdit('invert-polarity')} title="Invert selected region polarity">Inv</button>
          <button type="button" onClick={handleApplyAudioRegionEdit('swap-channels')} title="Swap left and right channels">LR</button>
          <button type="button" onClick={handleApplyAudioRegionEdit('mono-sum')} title="Sum selected channels to mono">Mono</button>
        </div>
      )}
      {isAudioClip && audioFocusMode && audioEditStack.length > 0 && (
        <div className="clip-audio-edit-stack" onMouseDown={handleAudioEditStackMouseDown}>
          <span className="clip-audio-edit-stack-count" title={`${activeAudioEditCount} active audio edits`}>
            {activeAudioEditCount}/{audioEditStack.length}
          </span>
          {audioEditStack.map(operation => (
            <button
              type="button"
              key={operation.id}
              className={operation.enabled === false ? 'disabled' : ''}
              title={`${operation.params.label ?? operation.type}: click to ${operation.enabled === false ? 'enable' : 'bypass'}, Alt-click to remove`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (e.altKey) {
                  removeClipAudioEditOperation(clip.id, operation.id);
                  return;
                }
                setClipAudioEditOperationEnabled(clip.id, operation.id, operation.enabled === false);
              }}
            >
              {String(operation.params.label ?? operation.type).slice(0, 3)}
            </button>
          ))}
          <button type="button" onClick={handleBakeAudioEditStack} disabled={audioBakePending || activeAudioEditCount === 0} title="Bake active audio edits into a new WAV source">
            {audioBakePending ? '...' : 'Bake'}
          </button>
          <button type="button" onClick={handleClearAudioEditStack} title="Clear audio edit stack">
            Clear
          </button>
        </div>
      )}
      {canSelectAudioRegion && (
        <div
          className="clip-audio-region-hitarea"
          onMouseDown={handleAudioRegionMouseDown}
          onDoubleClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            clearAudioRegionSelection();
          }}
          title="Drag audio region"
        />
      )}
      {/* Nested composition mixdown waveform - shown overlaid on thumbnails */}
      {waveformsEnabled && clip.isComposition && clip.mixdownWaveform && clip.mixdownWaveform.length > 0 && (
        <div className="clip-mixdown-waveform">
          <ClipWaveform
            waveform={clip.mixdownWaveform}
            width={width}
            height={Math.min(42, Math.max(16, trackBaseHeight / 3))}
            inPoint={displayInPoint}
            outPoint={displayOutPoint}
            naturalDuration={clip.duration}
            displayMode={audioDisplayMode}
            pixelsPerSecond={zoom}
            renderStartPx={waveformRenderWindow.startPx}
            renderWidth={waveformRenderWindow.width}
          />
        </div>
      )}
      {/* Nested composition mixdown generating indicator */}
      {clip.isComposition && clip.mixdownGenerating && (
        <div className="clip-mixdown-indicator">
          <span>Generating audio...</span>
        </div>
      )}
      {staticClipIconKind && (
        <div className="clip-static-artwork" aria-hidden="true">
          <StaticClipIcon kind={staticClipIconKind} className="clip-static-artwork-icon" />
        </div>
      )}
      {/* Segment-based thumbnails for nested compositions */}
      {showSegmentThumbnails && (
        <div
          className="clip-thumbnails clip-thumbnails-segments clip-thumbnails-windowed"
          style={{
            left: thumbnailRenderWindow.startPx,
            width: thumbnailRenderWindow.width,
            right: 'auto',
          }}
        >
          {compositionSegments.map((segment, segIdx) => {
            const windowStartNorm = thumbnailRenderWindow.startPx / Math.max(1, width);
            const windowEndNorm = (thumbnailRenderWindow.startPx + thumbnailRenderWindow.width) / Math.max(1, width);
            if (segment.endNorm < windowStartNorm || segment.startNorm > windowEndNorm) return null;
            const windowNormSpan = Math.max(0.0001, windowEndNorm - windowStartNorm);
            const clippedSegmentStart = Math.max(segment.startNorm, windowStartNorm);
            const clippedSegmentEnd = Math.min(segment.endNorm, windowEndNorm);
            const segmentWidth = ((clippedSegmentEnd - clippedSegmentStart) / windowNormSpan) * 100;
            const segmentLeft = ((clippedSegmentStart - windowStartNorm) / windowNormSpan) * 100;
            // Calculate how many thumbnails fit in this segment
            const segmentThumbCount = Math.max(1, Math.min(
              visibleThumbs,
              Math.ceil(((clippedSegmentEnd - clippedSegmentStart) * width) / THUMB_WIDTH) + 1,
            ));

            return (
              <div
                key={segIdx}
                className="clip-segment"
                style={{
                  position: 'absolute',
                  left: `${segmentLeft}%`,
                  width: `${segmentWidth}%`,
                  height: '100%',
                  display: 'flex',
                  overflow: 'hidden',
                }}
              >
                {segment.thumbnails.length > 0 ? (
                  Array.from({ length: segmentThumbCount }).map((_, i) => {
                    const thumbIndex = Math.floor((i / segmentThumbCount) * segment.thumbnails.length);
                    const thumb = segment.thumbnails[Math.min(thumbIndex, segment.thumbnails.length - 1)];
                    return (
                      <img
                        key={i}
                        src={thumb}
                        alt=""
                        className="clip-thumb"
                        draggable={false}
                        style={{ flex: '1 0 auto', minWidth: 0, objectFit: 'cover' }}
                      />
                    );
                  })
                ) : (
                  <div className="clip-segment-empty" style={{ width: '100%', height: '100%', background: '#1a1a1a' }} />
                )}
              </div>
            );
          })}
        </div>
      )}
      {/* Regular thumbnail filmstrip - source-based cache or legacy fallback */}
      {showRegularThumbnails && (
        <div
          className="clip-thumbnails clip-thumbnails-windowed"
          style={{
            left: thumbnailRenderWindow.startPx,
            width: thumbnailRenderWindow.width,
            right: 'auto',
          }}
        >
          {useSourceCache ? (
            // Source-based cache: thumbnails already mapped to visible range by hook
            cachedThumbnails.map((thumb, i) => thumb ? (
              <img
                key={i}
                src={thumb}
                alt=""
                className="clip-thumb"
                draggable={false}
              />
            ) : (
              <div key={i} className="clip-thumb clip-thumb-placeholder" />
            ))
          ) : (
            // Legacy fallback for clips without mediaFileId (compositions, old projects)
            Array.from({ length: visibleThumbs }).map((_, i) => {
              const naturalDuration = clip.source?.naturalDuration || clip.duration;
              const startRatio = displayInPoint / naturalDuration;
              const endRatio = displayOutPoint / naturalDuration;
              const positionInTrimmed = Math.min(1, Math.max(
                0,
                (thumbnailRenderWindow.startPx + i * THUMB_WIDTH) / Math.max(1, width),
              ));
              const sourceRatio = startRatio + positionInTrimmed * (endRatio - startRatio);
              const thumbIndex = Math.floor(sourceRatio * legacyThumbnails.length);
              const thumb = legacyThumbnails[Math.min(Math.max(0, thumbIndex), legacyThumbnails.length - 1)];
              return (
                <img
                  key={i}
                  src={thumb}
                  alt=""
                  className="clip-thumb"
                  draggable={false}
                />
              );
            })
          )}
        </div>
      )}
      {/* Nested composition clip boundary markers */}
      {clip.isComposition && clip.nestedClipBoundaries && clip.nestedClipBoundaries.length > 0 && (
        <div className="nested-clip-boundaries">
          {clip.nestedClipBoundaries.map((boundary, i) => (
            <div
              key={i}
              className="nested-boundary-line"
              style={{ left: `${boundary * 100}%` }}
            />
          ))}
        </div>
      )}
      {/* Needs reload indicator */}
      {clip.needsReload && (
        <div className="clip-reload-badge" title="Click media file to reload">
          !
        </div>
      )}
      <div className="clip-content">
        <div
          className="clip-meta"
          style={clipMetaOffset > 0 ? { transform: `translateX(${clipMetaOffset}px)` } : undefined}
        >
          {clip.isLoading && <div className="clip-loading-spinner" />}
          <div className="clip-name-row">
            {isSolidClip && (
              <span className="clip-solid-swatch" title="Solid Clip" style={{ background: clip.solidColor || '#fff' }} />
            )}
            {(isTextClip || isText3DClip) && (
              <span className="clip-text-icon" title={isText3DClip ? '3D Text Clip' : 'Text Clip'}>
                {isText3DClip ? '3T' : 'T'}
              </span>
            )}
            {isVectorAnimationClip && (
              <span className="clip-text-icon" title={vectorAnimationTitle}>{vectorAnimationIcon}</span>
            )}
            {isMathSceneClip && (
              <span className="clip-text-icon" title="Math Scene Clip">ƒ</span>
            )}
            {staticClipIconKind && (
              <StaticClipIcon
                kind={staticClipIconKind}
                className="clip-type-icon"
              />
            )}
            {isSplatEffectorClip && (
              <span className="clip-text-icon" title="3D Effector Clip">E</span>
            )}
            <span className="clip-name">
              {isTextClip && clip.textProperties
                ? clip.textProperties.text.slice(0, 30) || 'Text'
                : isMathSceneClip && clip.mathScene
                  ? clip.mathScene.objects.find((object) => object.type === 'function')?.expression || 'Math Scene'
                : isText3DClip && text3DProperties
                  ? text3DProperties.text.slice(0, 30) || '3D Text'
                  : clip.name}
            </span>
            {/* PickWhip disabled */}
          </div>
          <span className="clip-duration">{formatTime(displayDuration)}</span>
        </div>
      </div>
      {/* Transcript word markers */}
      {showTranscriptMarkers && clip.transcript && clip.transcript.length > 0 && (
        <div className="clip-transcript-markers">
          {clip.transcript.map((word) => {
            // Word times are relative to clip's inPoint
            const wordStartInClip = word.start - clip.inPoint;
            const wordEndInClip = word.end - clip.inPoint;

            // Only show markers that are visible within the clip's current trim
            if (wordEndInClip < 0 || wordStartInClip > displayDuration) {
              return null;
            }

            // Calculate marker position and width
            const markerStart = Math.max(0, wordStartInClip);
            const markerEnd = Math.min(displayDuration, wordEndInClip);
            const markerLeft = (markerStart / displayDuration) * 100;
            const markerWidth = ((markerEnd - markerStart) / displayDuration) * 100;

            return (
              <div
                key={word.id}
                className="transcript-marker"
                style={{
                  left: `${markerLeft}%`,
                  width: `${Math.max(0.5, markerWidth)}%`,
                }}
                title={word.text}
              />
            );
          })}
        </div>
      )}
      {/* Transcribing indicator */}
      {clip.transcriptStatus === 'transcribing' && (
        <div className="clip-transcribing-indicator">
          <div className="transcribing-progress" style={{ width: `${clip.transcriptProgress || 0}%` }} />
        </div>
      )}
      {/* Analysis overlay - graph showing focus/motion (renders during analysis and when ready) */}
      {/* Only show analysis overlay for video clips, not audio */}
      {!isAudioClip && clip.analysis && (clip.analysisStatus === 'ready' || clip.analysisStatus === 'analyzing') && (
        <>
          <div className="analysis-legend-labels">
            <span className="legend-focus">Focus</span>
            <span className="legend-motion">Motion</span>
            {clip.analysisStatus === 'analyzing' && (
              <span className="legend-progress">{clip.analysisProgress || 0}%</span>
            )}
          </div>
          <div className="clip-analysis-overlay">
            <ClipAnalysisOverlay
              analysis={clip.analysis}
              clipDuration={displayDuration}
              clipInPoint={clip.inPoint}
              clipStartTime={displayStartTime}
              width={width}
              height={trackBaseHeight}
            />
          </div>
        </>
      )}
      {/* Analyzing indicator (thin progress bar at bottom) */}
      {clip.analysisStatus === 'analyzing' && (
        <div className="clip-analyzing-indicator">
          <div className="analyzing-progress" style={{ width: `${clip.analysisProgress || 0}%` }} />
        </div>
      )}
      {/* Keyframe tick marks on clip bar */}
      {keyframeTickGroups.length > 0 && (
        <div className="clip-keyframe-ticks">
          {keyframeTickGroups.map((group, i) => {
            const xPercent = (group.time / displayDuration) * 100;
            if (xPercent < 0 || xPercent > 100) return null;
            const isDraggingKeyframeGroup = keyframeGroupDrag
              ? group.keyframeIds.some(id => keyframeGroupDrag.keyframeIds.includes(id))
              : false;
            const keyframeCount = group.keyframeIds.length || 1;
            return (
              <button
                type="button"
                key={`${group.time}:${group.keyframeIds.join('|') || i}`}
                className={`keyframe-tick${isDraggingKeyframeGroup ? ' dragging' : ''}${group.hasStateChange ? ' state-change' : ''}`}
                style={{ left: `${xPercent}%` }}
                onMouseDown={isTrackLocked ? undefined : (e) => handleKeyframeTickMouseDown(e, group)}
                onClick={(e) => e.stopPropagation()}
                aria-label={`Move ${keyframeCount} keyframe${keyframeCount === 1 ? '' : 's'} at ${formatTime(group.time)}`}
                title={`Drag to move ${keyframeCount} keyframe${keyframeCount === 1 ? '' : 's'} at ${formatTime(group.time)} (Shift snaps to clip keyframes)`}
              />
            );
          })}
        </div>
      )}
      {/* Fade curve - SVG bezier curve showing opacity animation */}
      {opacityKeyframes.length >= 2 && (
        <div className="fade-curve-container">
          <FadeCurve
            key={opacityKeyframes.map(k => `${k.id}:${k.time.toFixed(3)}:${k.value}:${k.handleIn?.x ?? ''}:${k.handleIn?.y ?? ''}:${k.handleOut?.x ?? ''}:${k.handleOut?.y ?? ''}`).join('|')}
            keyframes={opacityKeyframes}
            clipDuration={displayDuration}
            width={width}
            height={trackBaseHeight}
          />
        </div>
      )}
      {!isTrackLocked && (
        <>
          {/* Fade handles - corner handles for adjusting fade-in/out */}
          <div
            className={`fade-handle left${fadeInDuration > 0 ? ' active' : ''}`}
            style={fadeInDuration > 0 ? { left: timeToPixel(fadeInDuration) - 6 } : undefined}
            onMouseDown={(e) => {
              e.stopPropagation();
              onFadeStart(e, 'left');
            }}
            title={fadeInDuration > 0 ? `Fade In: ${fadeInDuration.toFixed(2)}s` : 'Drag to add fade in'}
          />
          <div
            className={`fade-handle right${fadeOutDuration > 0 ? ' active' : ''}`}
            style={fadeOutDuration > 0 ? { right: timeToPixel(fadeOutDuration) - 6 } : undefined}
            onMouseDown={(e) => {
              e.stopPropagation();
              onFadeStart(e, 'right');
            }}
            title={fadeOutDuration > 0 ? `Fade Out: ${fadeOutDuration.toFixed(2)}s` : 'Drag to add fade out'}
          />
          {/* Trim handles */}
          <div
            className="trim-handle left"
            onMouseDown={(e) => {
              e.stopPropagation();
              onTrimStart(e, 'left');
            }}
          />
          <div
            className="trim-handle right"
            onMouseDown={(e) => {
              e.stopPropagation();
              onTrimStart(e, 'right');
            }}
          />
        </>
      )}
    </div>
  );
}

export const TimelineClip = memo(TimelineClipComponent);
