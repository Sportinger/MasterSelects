// TimelineClip component - Clip rendering within tracks

import './TimelineClip.css';
import { memo, type CSSProperties, useRef, useState, useEffect, useCallback, useMemo } from 'react';
import type { TimelineClipProps } from './types';
import { THUMB_WIDTH } from './constants';
import { useTimelineStore } from '../../stores/timeline';
import { useMediaStore } from '../../stores/mediaStore';
import { getLabelHex } from '../panels/media/labelColors';
import { getTimelineTrackColor, TIMELINE_TRACK_COLOR_HIDDEN } from './trackColor';
// PickWhip disabled
import {
  isVectorAnimationSourceType,
  shouldLoopVectorAnimation,
} from '../../types/vectorAnimation';
import { ClipSpectrogram } from './components/ClipSpectrogram';
import { ClipWaveform } from './components/ClipWaveform';
import { ClipAnalysisOverlay } from './components/ClipAnalysisOverlay';
import { FadeCurve } from './components/FadeCurve';
import { useThumbnailCache } from '../../hooks/useThumbnailCache';
import { useTimelineSpectrogramTileSetState } from './hooks/useTimelineSpectrogramTileSet';
import { useTimelineWaveformPyramidState } from './hooks/useTimelineWaveformPyramid';
import {
  clipRequiresProcessedWaveformPyramid,
  createProcessedClipAudioStateHash,
} from '../../services/audio/processedWaveformEligibility';
import {
  collectAudioEffectInstanceRouteSettings,
  collectLegacyAudioEffectRouteSettings,
} from '../../services/audio/audioGraphRouteSettings';
import { resolveTimelineAudioRegionSelection } from './utils/audioEditSelection';
import { resolveProcessedAudioAnalysisDisplayStatus } from './utils/audioAnalysisDisplayStatus';
import { resolveAudioWaveformDiagnostics } from './utils/audioWaveformDiagnostics';
import { resolveAudioVolumeAutomationCurveKeyframes } from './utils/audioAutomationCurve';
import {
  frequencyHzFromSpectralY,
  getSpectralMaxFrequencyHz,
  resolveTimelineSpectralBrushSelection,
  resolveTimelineSpectralRegionSelection,
  spectralYFromFrequencyHz,
} from './utils/spectralSelection';
import type {
  TimelineAudioRegionEditType,
  TimelineSpectralRegionEditType,
} from '../../stores/timeline/types';
import {
  dispatchTimelineClipPointerClick,
  dispatchTimelineClipPointerMove,
  getTimelineToolCursor,
  isTimelineBladeTool,
  isTimelinePointerTool,
} from './tools/pointer/timelineToolPointerDispatcher';

const KEYFRAME_TICK_SNAP_THRESHOLD_PX = 10;
const TIMELINE_VIEWPORT_FALLBACK_PX = 1600;
const TIMELINE_VIEWPORT_MIN_PX = 1600;
const TIMELINE_RENDER_OVERSCAN_PX = 512;
const THUMBNAIL_RENDER_OVERSCAN_PX = THUMB_WIDTH * 3;
const CLIP_RIGHT_STICKY_PADDING_PX = 8;
const WAVEFORM_PYRAMID_AUTO_UPGRADE_ZOOM = 250;
const WAVEFORM_PYRAMID_AUTO_UPGRADE_WIDTH = 16_384;
const inFlightSourceWaveformPyramidUpgrades = new Set<string>();
const inFlightProcessedWaveformPyramidUpgrades = new Set<string>();
const inFlightSpectrogramTileSetUpgrades = new Set<string>();
const EMPTY_CLIP_KEYFRAMES = [] as const;
type LabelableMediaStoreItem = {
  id?: string;
  name?: string;
  labelColor?: string;
  meshType?: string;
};
const EMPTY_LABELABLE_MEDIA_ITEMS: LabelableMediaStoreItem[] = [];

function canLoopExtendVectorClip(clip: TimelineClipProps['clip']): boolean {
  return isVectorAnimationSourceType(clip.source?.type) &&
    shouldLoopVectorAnimation(clip.source.vectorAnimationSettings);
}

function finiteNumberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function getClipSourceDuration(clip: TimelineClipProps['clip']): number {
  const naturalDuration = clip.source?.naturalDuration;
  if (Number.isFinite(naturalDuration) && naturalDuration && naturalDuration > 0) {
    return naturalDuration;
  }
  return Math.max(clip.outPoint, clip.inPoint + clip.duration, clip.duration, 0.1);
}

function getSlippedSourceWindow(
  clip: TimelineClipProps['clip'],
  sourceDelta: number,
): { inPoint: number; outPoint: number } {
  const visibleSourceDuration = clip.outPoint - clip.inPoint;
  const maxInPoint = Math.max(0, getClipSourceDuration(clip) - visibleSourceDuration);
  const inPoint = Math.max(0, Math.min(maxInPoint, clip.inPoint + sourceDelta));
  return {
    inPoint,
    outPoint: inPoint + visibleSourceDuration,
  };
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
type SpectralRegionDragState = AudioRegionDragState & {
  anchorFrequencyHz: number;
  startClientY: number;
  rectTop: number;
  rectHeight: number;
  maxFrequencyHz: number;
  mode: 'rectangle' | 'brush';
  brushTimeRadiusSeconds?: number;
  brushFrequencyRadiusHz?: number;
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
  timelineViewportWidth,
  proxyEnabled,
  proxyStatus,
  proxyProgress,
  showTranscriptMarkers,
  snappingEnabled,
  onMouseDown,
  onDoubleClick,
  onContextMenu,
  onTrimStart,
  onFadeStart,
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
  const activeTimelineToolId = useTimelineStore(s => s.activeTimelineToolId);
  const timelineToolPreview = useTimelineStore(s => s.timelineToolPreview);
  const setTimelineToolPreview = useTimelineStore(s => s.setTimelineToolPreview);
  const applyTimelineEditOperation = useTimelineStore(s => s.applyTimelineEditOperation);
  const setActiveTimelineTool = useTimelineStore(s => s.setActiveTimelineTool);
  const timelineTrackColorsVisible = useTimelineStore(s => s.audioLayerAdvancedMode !== false);
  const audioRegionSelection = useTimelineStore(s =>
    s.audioRegionSelection?.clipId === clip.id ? s.audioRegionSelection : null
  );
  const audioSpectralRegionSelection = useTimelineStore(s =>
    s.audioSpectralRegionSelection?.clipId === clip.id ? s.audioSpectralRegionSelection : null
  );
  const setAudioRegionSelection = useTimelineStore(s => s.setAudioRegionSelection);
  const clearAudioRegionSelection = useTimelineStore(s => s.clearAudioRegionSelection);
  const setAudioSpectralRegionSelection = useTimelineStore(s => s.setAudioSpectralRegionSelection);
  const clearAudioSpectralRegionSelection = useTimelineStore(s => s.clearAudioSpectralRegionSelection);
  const hasAudioRegionClipboard = useTimelineStore(s => s.audioRegionClipboard !== null);
  const applyAudioRegionEdit = useTimelineStore(s => s.applyAudioRegionEdit);
  const applySpectralRegionEdit = useTimelineStore(s => s.applySpectralRegionEdit);
  const addClipSpectralImageLayer = useTimelineStore(s => s.addClipSpectralImageLayer);
  const copySelectedAudioRegion = useTimelineStore(s => s.copySelectedAudioRegion);
  const pasteAudioRegionToSelection = useTimelineStore(s => s.pasteAudioRegionToSelection);
  const setClipAudioEditOperationEnabled = useTimelineStore(s => s.setClipAudioEditOperationEnabled);
  const removeClipAudioEditOperation = useTimelineStore(s => s.removeClipAudioEditOperation);
  const clearClipAudioEditStack = useTimelineStore(s => s.clearClipAudioEditStack);
  const bakeClipAudioEditStack = useTimelineStore(s => s.bakeClipAudioEditStack);
  const clipAudioKeyframes = useTimelineStore(s => s.clipKeyframes.get(clip.id) ?? EMPTY_CLIP_KEYFRAMES);
  const processedWaveformPyramidRef = clip.audioState?.processedAnalysisRefs?.processedWaveformPyramidId;
  const sourceWaveformPyramidRef = clip.audioState?.sourceAnalysisRefs?.waveformPyramidId;
  const processedSpectrogramTileSetRef = clip.audioState?.processedAnalysisRefs?.spectrogramTileSetIds?.[0];
  const sourceSpectrogramTileSetRef = clip.audioState?.sourceAnalysisRefs?.spectrogramTileSetIds?.[0];
  const processedWaveformState = useTimelineWaveformPyramidState(processedWaveformPyramidRef);
  const sourceWaveformState = useTimelineWaveformPyramidState(sourceWaveformPyramidRef);
  const processedSpectrogramState = useTimelineSpectrogramTileSetState(processedSpectrogramTileSetRef);
  const sourceSpectrogramState = useTimelineSpectrogramTileSetState(sourceSpectrogramTileSetRef);
  const processedWaveformPyramid = processedWaveformState.pyramid;
  const sourceWaveformPyramid = sourceWaveformState.pyramid;
  const waveformPyramid = processedWaveformPyramid ?? sourceWaveformPyramid;
  const processedSpectrogramTileSet = processedSpectrogramState.tileSet;
  const sourceSpectrogramTileSet = sourceSpectrogramState.tileSet;
  const spectrogramTileSet = processedSpectrogramTileSet ?? sourceSpectrogramTileSet;
  const spectrogramVariant = processedSpectrogramTileSet ? 'processed' : 'source';
  const spectralMaxFrequencyHz = getSpectralMaxFrequencyHz(spectrogramTileSet?.sampleRate);
  const selectedSpectralImageFileId = useMediaStore(s => {
    for (const id of s.selectedIds) {
      const file = s.files.find(candidate => candidate.id === id);
      if (file?.type === 'image') return file.id;
    }
    return null;
  });
  const spectralImageMediaFiles = useMediaStore(s => s.files);
  const spectralImageFilesById = useMemo(() => {
    const entries = spectralImageMediaFiles
      .filter(file => file.type === 'image')
      .map(file => [file.id, file] as const);
    return new Map(entries);
  }, [spectralImageMediaFiles]);
  const selectedSpectralImageFile = selectedSpectralImageFileId
    ? spectralImageFilesById.get(selectedSpectralImageFileId) ?? null
    : null;
  const waveformVariant = processedWaveformPyramid
    ? 'processed'
    : sourceWaveformPyramid
      ? 'source'
      : 'legacy';
  const waveformDisplayGain = useMemo(() => {
    const clipAudioEffectIds = new Set((clip.audioState?.effectStack ?? []).map(effect => effect.id));
    const graphSettings = collectAudioEffectInstanceRouteSettings(clip.audioState?.effectStack);
    const legacySettings = collectLegacyAudioEffectRouteSettings(clip.effects, clipAudioEffectIds);
    return Math.max(0, Math.min(8, graphSettings.volume * legacySettings.volume));
  }, [clip.audioState?.effectStack, clip.effects]);
  const waveformProcessingState = processedWaveformPyramidRef && !processedWaveformState.pyramid
    ? `waveform-processed-${processedWaveformState.status}`
    : '';
  const spectrogramProcessingState = audioDisplayMode === 'spectral'
    && processedSpectrogramTileSetRef
    && !processedSpectrogramState.tileSet
    ? `spectrogram-processed-${processedSpectrogramState.status}`
    : '';
  const needsProcessedAudioAnalysis = useMemo(
    () => clipRequiresProcessedWaveformPyramid(clip, clipAudioKeyframes),
    [clip, clipAudioKeyframes],
  );
  const canResolveAudioSourceForAnalysis = Boolean(
    clip.isComposition ||
    clip.file ||
    clip.mediaFileId ||
    clip.source?.mediaFileId,
  );
  const processedWaveformStatus = resolveProcessedAudioAnalysisDisplayStatus({
    artifactLabel: 'waveform',
    needsProcessed: needsProcessedAudioAnalysis,
    processedRef: processedWaveformPyramidRef,
    processedReady: Boolean(processedWaveformPyramid),
    fallbackAvailable: Boolean(
      sourceWaveformPyramid ||
      (clip.waveform?.length ?? 0) > 0 ||
      clip.waveformChannels?.some(channel => channel.length > 0),
    ),
    loadStatus: processedWaveformState.status,
    jobActive: clip.audioAnalysisJob?.artifactKinds.includes('processed-waveform-pyramid') === true,
    autoGenerateEligible: canResolveAudioSourceForAnalysis,
  });
  const processedSpectrogramStatus = resolveProcessedAudioAnalysisDisplayStatus({
    artifactLabel: 'spectrogram',
    needsProcessed: needsProcessedAudioAnalysis,
    processedRef: processedSpectrogramTileSetRef,
    processedReady: Boolean(processedSpectrogramTileSet),
    fallbackAvailable: Boolean(sourceSpectrogramTileSet),
    loadStatus: processedSpectrogramState.status,
    jobActive: clip.audioAnalysisJob?.artifactKinds.includes('spectrogram-tiles') === true,
    autoGenerateEligible: canResolveAudioSourceForAnalysis,
  });
  const audioAnalysisDisplayStatus = audioDisplayMode === 'spectral'
    ? processedSpectrogramStatus
    : processedWaveformStatus;
  const audioEditStack = clip.audioState?.editStack ?? [];
  const activeAudioEditCount = audioEditStack.filter(operation => operation.enabled !== false).length;

  const isBladeToolActive = isTimelineBladeTool(activeTimelineToolId);
  const isPointerToolActive = isTimelinePointerTool(activeTimelineToolId);
  const timelineToolCursor = getTimelineToolCursor(activeTimelineToolId);
  const canUseTrimHandles =
    activeTimelineToolId === 'select' ||
    activeTimelineToolId === 'edge-trim' ||
    activeTimelineToolId === 'ripple-trim' ||
    activeTimelineToolId === 'rolling-edit' ||
    activeTimelineToolId === 'rate-stretch';
  const canUseFadeHandles = activeTimelineToolId === 'select';
  const canUseBodyToolGesture = activeTimelineToolId === 'slip' || activeTimelineToolId === 'slide';

  // Subscribe to playhead position only when blade tool is active (avoids re-renders during playback)
  const playheadPosition = useTimelineStore((state) =>
    isBladeToolActive ? state.playheadPosition : 0
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
      const solidItems = s.solidItems ?? EMPTY_LABELABLE_MEDIA_ITEMS;
      const solid = mediaFileId
        ? solidItems.find(si => si.id === mediaFileId)
        : solidItems.find(si => si.name === clip.name);
      if (solid?.labelColor && solid.labelColor !== 'none') return getLabelHex(solid.labelColor);
    }
    if (clip.source?.type === 'text') {
      const textItems = s.textItems ?? EMPTY_LABELABLE_MEDIA_ITEMS;
      const text = mediaFileId
        ? textItems.find(ti => ti.id === mediaFileId)
        : textItems.find(ti => ti.name === clip.name);
      if (text?.labelColor && text.labelColor !== 'none') return getLabelHex(text.labelColor);
    }
    if (clip.source?.type === 'model') {
      const meshItems = s.meshItems ?? EMPTY_LABELABLE_MEDIA_ITEMS;
      const mesh = mediaFileId
        ? meshItems.find(m => m.id === mediaFileId)
        : meshItems.find(m => m.name === clip.name || m.meshType === clip.meshType);
      if (mesh?.labelColor && mesh.labelColor !== 'none') return getLabelHex(mesh.labelColor);
    }
    if (clip.source?.type === 'camera') {
      const cameraItems = s.cameraItems ?? EMPTY_LABELABLE_MEDIA_ITEMS;
      const cam = mediaFileId
        ? cameraItems.find(c => c.id === mediaFileId)
        : cameraItems[0];
      if (cam?.labelColor && cam.labelColor !== 'none') return getLabelHex(cam.labelColor);
    }
    if (clip.source?.type === 'splat-effector') {
      const splatEffectorItems = s.splatEffectorItems ?? EMPTY_LABELABLE_MEDIA_ITEMS;
      const effector = mediaFileId
        ? splatEffectorItems.find(e => e.id === mediaFileId)
        : splatEffectorItems.find(e => e.name === clip.name);
      if (effector?.labelColor && effector.labelColor !== 'none') return getLabelHex(effector.labelColor);
    }
    return null;
  });

  // Animation phase for enter/exit transitions
  const clipAnimationPhase = useTimelineStore(s => s.clipAnimationPhase);
  const compositionSwitchDirection = useTimelineStore(s => s.compositionSwitchDirection);
  const clipEntranceKey = useTimelineStore(s => s.clipEntranceAnimationKey);
  const aiMove = useTimelineStore(s => s.aiMovingClips.get(clip.id));
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

  // Check if this clip should show blade indicator (either directly hovered or linked to hovered clip)
  const isDirectlyHovered = timelineToolPreview?.clipId === clip.id;
  const linkedClip = clip.linkedClipId ? clips.find(c => c.id === clip.linkedClipId) : null;
  const isLinkedToHovered = linkedClip && timelineToolPreview?.clipId === linkedClip.id;
  // Also check reverse link - if another clip links to this one
  const reverseLinkedClip = clips.find(c => c.linkedClipId === clip.id);
  const isReverseLinkedToHovered = reverseLinkedClip && timelineToolPreview?.clipId === reverseLinkedClip.id;
  const shouldShowCutIndicator = isBladeToolActive &&
    timelineToolPreview &&
    isTimelineBladeTool(timelineToolPreview.toolId) &&
    timelineToolPreview.plane === 'clip-local' &&
    !timelineToolPreview.blocked &&
    (isDirectlyHovered || isLinkedToHovered || isReverseLinkedToHovered);

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

  const isSlipPreview =
    clipDrag?.toolGesture === 'slip' &&
    clipDrag.sourceTimeDelta !== undefined &&
    (isDragging || (!clipDrag.altKeyPressed && isLinkedToDragging));
  if (isSlipPreview) {
    const sourceWindow = getSlippedSourceWindow(clip, clipDrag.sourceTimeDelta ?? 0);
    displayInPoint = sourceWindow.inPoint;
    displayOutPoint = sourceWindow.outPoint;
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
  const visibleTimelineViewportWidth = timelineViewportWidth > 0
    ? timelineViewportWidth
    : TIMELINE_VIEWPORT_FALLBACK_PX;
  const renderTimelineViewportWidth = Math.max(
    TIMELINE_VIEWPORT_MIN_PX,
    visibleTimelineViewportWidth
  );
  const waveformRenderStartPx = Math.max(0, scrollX - left - TIMELINE_RENDER_OVERSCAN_PX);
  const waveformRenderEndPx = Math.min(width, scrollX - left + renderTimelineViewportWidth + TIMELINE_RENDER_OVERSCAN_PX);
  const waveformRenderWindow = {
    startPx: waveformRenderStartPx,
    width: Math.max(0, waveformRenderEndPx - waveformRenderStartPx),
  };
  const thumbnailRenderStartPx = Math.max(0, scrollX - left - THUMBNAIL_RENDER_OVERSCAN_PX);
  const thumbnailRenderEndPx = Math.min(width, scrollX - left + renderTimelineViewportWidth + THUMBNAIL_RENDER_OVERSCAN_PX);
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
    if (!waveformsEnabled || !isAudioClip || sourceWaveformPyramidRef || clip.waveformGenerating) {
      return;
    }

    const shouldUpgrade =
      audioDisplayMode === 'detailed' ||
      (audioDisplayMode === 'compact' && (zoom >= WAVEFORM_PYRAMID_AUTO_UPGRADE_ZOOM || width > WAVEFORM_PYRAMID_AUTO_UPGRADE_WIDTH));

    if (!shouldUpgrade) return;

    const sourceKey = clip.file
      ? [
          clip.id,
          clip.file.name,
          clip.file.size,
          clip.file.lastModified,
        ].join(':')
      : [
          clip.id,
          clip.mediaFileId ?? clip.source?.mediaFileId ?? 'no-media-file',
          clip.name,
        ].join(':');

    const fileKey = [
      clip.id,
      sourceKey,
      audioDisplayMode,
    ].join(':');

    if (inFlightSourceWaveformPyramidUpgrades.has(fileKey)) return;
    inFlightSourceWaveformPyramidUpgrades.add(fileKey);

    const timer = window.setTimeout(() => {
      const { clips: currentClips, generateWaveformForClip } = useTimelineStore.getState();
      const currentClip = currentClips.find(current => current.id === clip.id);
      if (
        !currentClip ||
        currentClip.waveformGenerating ||
        currentClip.audioState?.sourceAnalysisRefs?.waveformPyramidId
      ) {
        inFlightSourceWaveformPyramidUpgrades.delete(fileKey);
        return;
      }

      void generateWaveformForClip(clip.id)
        .finally(() => {
          inFlightSourceWaveformPyramidUpgrades.delete(fileKey);
        });
    }, 300);

    return () => {
      window.clearTimeout(timer);
      inFlightSourceWaveformPyramidUpgrades.delete(fileKey);
    };
  }, [
    audioDisplayMode,
    clip.file,
    clip.mediaFileId,
    clip.name,
    clip.source?.mediaFileId,
    clip.id,
    clip.waveformGenerating,
    isAudioClip,
    sourceWaveformPyramidRef,
    waveformsEnabled,
    width,
    zoom,
  ]);

  const processedWaveformRequestKey = useMemo(
    () => `${clip.id}:${createProcessedClipAudioStateHash(clip, { keyframes: clipAudioKeyframes })}`,
    [clip, clipAudioKeyframes],
  );

  useEffect(() => {
    if (
      !waveformsEnabled ||
      !isAudioClip ||
      audioDisplayMode === 'spectral' ||
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
    audioDisplayMode,
    isAudioClip,
    processedWaveformPyramidRef,
    processedWaveformRequestKey,
    waveformsEnabled,
  ]);

  const spectrogramRequestKey = [
    'spectrogram',
    processedWaveformRequestKey,
    sourceSpectrogramTileSetRef ?? '',
    processedSpectrogramTileSetRef ?? '',
  ].join(':');

  useEffect(() => {
    if (
      !waveformsEnabled ||
      !isAudioClip ||
      audioDisplayMode !== 'spectral' ||
      clip.waveformGenerating ||
      inFlightSpectrogramTileSetUpgrades.has(spectrogramRequestKey)
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      const store = useTimelineStore.getState();
      const currentClip = store.clips.find(current => current.id === clip.id);
      if (!currentClip || currentClip.waveformGenerating) {
        return;
      }

      const keyframes = store.clipKeyframes.get(currentClip.id) ?? [];
      const needsProcessedSpectrogram = clipRequiresProcessedWaveformPyramid(currentClip, keyframes);
      const requiredRef = needsProcessedSpectrogram
        ? currentClip.audioState?.processedAnalysisRefs?.spectrogramTileSetIds?.[0]
        : currentClip.audioState?.sourceAnalysisRefs?.spectrogramTileSetIds?.[0];

      if (requiredRef) {
        return;
      }
      if (!currentClip.isComposition && !currentClip.file) {
        return;
      }

      inFlightSpectrogramTileSetUpgrades.add(spectrogramRequestKey);
      void store.generateSpectrogramForClip(currentClip.id)
        .finally(() => {
          inFlightSpectrogramTileSetUpgrades.delete(spectrogramRequestKey);
        });
    }, 650);

    return () => window.clearTimeout(timer);
  }, [
    audioDisplayMode,
    clip.id,
    clip.waveformGenerating,
    isAudioClip,
    processedSpectrogramTileSetRef,
    sourceSpectrogramTileSetRef,
    spectrogramRequestKey,
    waveformsEnabled,
  ]);

  const waveformNaturalDuration = processedWaveformPyramid
    ? Math.max(0.001, processedWaveformPyramid.duration)
    : (clip.source?.naturalDuration || clip.duration);
  const waveformInPoint = processedWaveformPyramid ? 0 : displayInPoint;
  const waveformOutPoint = processedWaveformPyramid
    ? Math.max(0.001, processedWaveformPyramid.duration)
    : displayOutPoint;
  const spectrogramNaturalDuration = processedSpectrogramTileSet
    ? Math.max(0.001, processedSpectrogramTileSet.duration)
    : (clip.source?.naturalDuration || clip.duration);
  const spectrogramInPoint = processedSpectrogramTileSet ? 0 : displayInPoint;
  const spectrogramOutPoint = processedSpectrogramTileSet
    ? Math.max(0.001, processedSpectrogramTileSet.duration)
    : displayOutPoint;
  const audioWaveformDiagnostics = useMemo(() => {
    if (!isAudioClip || !waveformsEnabled) return null;
    if (!waveformPyramid && (!clip.waveform || clip.waveform.length === 0)) return null;

    return resolveAudioWaveformDiagnostics({
      waveform: clip.waveform,
      pyramid: waveformPyramid,
      inPoint: waveformInPoint,
      outPoint: waveformOutPoint,
      naturalDuration: waveformNaturalDuration,
      gain: waveformVariant === 'processed' ? 1 : waveformDisplayGain,
    });
  }, [
    clip.waveform,
    isAudioClip,
    waveformDisplayGain,
    waveformInPoint,
    waveformNaturalDuration,
    waveformOutPoint,
    waveformPyramid,
    waveformVariant,
    waveformsEnabled,
  ]);
  const audioVolumeAutomationKeyframes = useMemo(() => {
    if (!isAudioClip) return [];

    return resolveAudioVolumeAutomationCurveKeyframes({
      keyframes: clipAudioKeyframes,
      legacyEffects: clip.effects,
      audioEffectStack: clip.audioState?.effectStack,
      clipDuration: displayDuration,
    });
  }, [
    clip.audioState?.effectStack,
    clip.effects,
    clipAudioKeyframes,
    displayDuration,
    isAudioClip,
  ]);
  const visibleFadeCurveKeyframes = isAudioClip ? audioVolumeAutomationKeyframes : opacityKeyframes;
  const visibleFadeCurveKey = visibleFadeCurveKeyframes
    .map(k => `${k.id}:${k.time.toFixed(3)}:${k.value}:${k.handleIn?.x ?? ''}:${k.handleIn?.y ?? ''}:${k.handleOut?.x ?? ''}:${k.handleOut?.y ?? ''}`)
    .join('|');

  const clipMetaOffset = clip.isLoading
    ? 0
    : Math.min(
        Math.max(0, scrollX - left),
        Math.max(0, width - 48)
      );
  const clipRightOverflow = left + width - (scrollX + visibleTimelineViewportWidth);
  const clipRightStickyOffset = Math.max(
    0,
    Math.min(
      Math.max(0, width - 18),
      clipRightOverflow > 0 ? clipRightOverflow + CLIP_RIGHT_STICKY_PADDING_PX : 0
    )
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
  const [spectralRegionDrag, setSpectralRegionDrag] = useState<SpectralRegionDragState | null>(null);
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
    audioDisplayMode === 'detailed' &&
    activeTimelineToolId === 'select' &&
    track.locked !== true;
  const canSelectSpectralRegion = audioFocusMode &&
    isAudioClip &&
    audioDisplayMode === 'spectral' &&
    activeTimelineToolId === 'select' &&
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

  const resolveSpectralRegionDragSelection = useCallback((
    drag: SpectralRegionDragState,
    clientX: number,
    clientY: number,
  ) => {
    const selectionClip = {
      ...clip,
      startTime: displayStartTime,
      duration: displayDuration,
      inPoint: displayInPoint,
      outPoint: displayOutPoint,
      waveform: clip.waveform,
    };
    const focusTimelineTime = timelineTimeFromAudioRegionClientX(clientX, drag);
    const focusFrequencyHz = frequencyHzFromSpectralY(clientY - drag.rectTop, drag.rectHeight, drag.maxFrequencyHz);

    if (drag.mode === 'brush') {
      return resolveTimelineSpectralBrushSelection({
        clip: selectionClip,
        centerTimelineTime: focusTimelineTime,
        centerFrequencyHz: focusFrequencyHz,
        timeRadiusSeconds: drag.brushTimeRadiusSeconds ?? 0.08,
        frequencyRadiusHz: drag.brushFrequencyRadiusHz ?? drag.maxFrequencyHz * 0.04,
        maxFrequencyHz: drag.maxFrequencyHz,
      });
    }

    return resolveTimelineSpectralRegionSelection({
      clip: selectionClip,
      anchorTimelineTime: drag.anchorTimelineTime,
      focusTimelineTime,
      anchorFrequencyHz: drag.anchorFrequencyHz,
      focusFrequencyHz,
      maxFrequencyHz: drag.maxFrequencyHz,
    });
  }, [
    clip,
    displayDuration,
    displayInPoint,
    displayOutPoint,
    displayStartTime,
    timelineTimeFromAudioRegionClientX,
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

  const handleSpectralRegionMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canSelectSpectralRegion || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const rect = e.currentTarget.getBoundingClientRect();
    const brushMode = e.shiftKey || e.altKey;
    const drag: SpectralRegionDragState = {
      anchorTimelineTime: timelineTimeFromAudioRegionClientX(e.clientX, {
        rectLeft: rect.left,
        rectWidth: rect.width,
      }),
      anchorFrequencyHz: frequencyHzFromSpectralY(e.clientY - rect.top, rect.height, spectralMaxFrequencyHz),
      startClientX: e.clientX,
      startClientY: e.clientY,
      rectLeft: rect.left,
      rectWidth: rect.width,
      rectTop: rect.top,
      rectHeight: rect.height,
      maxFrequencyHz: spectralMaxFrequencyHz,
      mode: brushMode ? 'brush' : 'rectangle',
      brushTimeRadiusSeconds: brushMode ? Math.max(0.025, Math.min(0.5, 18 / Math.max(1, zoom))) : undefined,
      brushFrequencyRadiusHz: brushMode ? Math.max(80, spectralMaxFrequencyHz * 0.045) : undefined,
    };

    setSpectralRegionDrag(drag);
    setAudioSpectralRegionSelection(resolveSpectralRegionDragSelection(drag, e.clientX, e.clientY));
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

  useEffect(() => {
    if (!spectralRegionDrag || !canSelectSpectralRegion) return;

    const handleDocumentMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      setAudioSpectralRegionSelection(resolveSpectralRegionDragSelection(spectralRegionDrag, e.clientX, e.clientY));
    };

    const handleDocumentMouseUp = (e: MouseEvent) => {
      if (
        spectralRegionDrag.mode !== 'brush' &&
        Math.abs(e.clientX - spectralRegionDrag.startClientX) < 3 &&
        Math.abs(e.clientY - spectralRegionDrag.startClientY) < 3
      ) {
        clearAudioSpectralRegionSelection();
      }
      setSpectralRegionDrag(null);
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [
    canSelectSpectralRegion,
    clearAudioSpectralRegionSelection,
    resolveSpectralRegionDragSelection,
    setAudioSpectralRegionSelection,
    spectralRegionDrag,
  ]);

  // Determine clip type class (audio, video, text, or image)
  const clipTypeClass = isSolidClip ? 'solid' : isMathSceneClip ? 'math-scene' : (isTextClip || isText3DClip) ? 'text' : isCameraClip ? 'camera' : isSplatEffectorClip ? 'splat-effector' : isAudioClip ? 'audio' : (clip.source?.type || 'video');

  // Check if this clip is part of a multi-select drag
  const isInMultiSelectDrag = clipDrag?.multiSelectClipIds?.includes(clip.id) && clipDrag.multiSelectTimeDelta !== undefined;
  const isTrackLocked = track.locked === true;
  const trackTypeIndex = useMemo(
    () => tracks.filter(candidate => candidate.type === track.type).findIndex(candidate => candidate.id === track.id),
    [track.id, track.type, tracks],
  );
  const trackColor = timelineTrackColorsVisible ? getTimelineTrackColor(track, trackTypeIndex) : TIMELINE_TRACK_COLOR_HIDDEN;

  const clipClass = [
    'timeline-clip',
    isSelected ? 'selected' : '',
    isInLinkedGroup ? 'linked-group' : '',
    isDragging ? 'dragging' : '',
    clipDrag?.toolGesture === 'slip' && (isDragging || isLinkedToDragging) ? 'slipping' : '',
    clipDrag?.toolGesture === 'slide' && (isDragging || isLinkedToDragging) ? 'sliding' : '',
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
    audioSpectralRegionSelection ? 'spectral-region-selected' : '',
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
    spectrogramProcessingState,
    audioDisplayMode === 'spectral' ? '' : (processedWaveformStatus?.className ?? ''),
    audioDisplayMode === 'spectral' ? (processedSpectrogramStatus?.className ?? '') : '',
    ...(audioWaveformDiagnostics?.classNames ?? []),
    clip.parentClipId ? 'has-parent' : '',
    clip.isPendingDownload ? 'pending-download' : '',
    clip.downloadError ? 'download-error' : '',
    clip.isComposition ? 'composition' : '',
    aiMovePhase !== 'idle' ? 'ai-moving' : '',
    isTrackLocked ? 'track-locked' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const getClipPointerContext = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      toolId: activeTimelineToolId,
      clip,
      track,
      clips,
      playheadPosition,
      snappingEnabled,
      displayStartTime,
      displayDuration,
      width,
      clientX: e.clientX,
      rectLeft: rect.left,
      altKey: e.altKey,
    };
  };

  // Timeline tool pointer handlers
  const handleMouseMove = (e: React.MouseEvent) => {
    const result = dispatchTimelineClipPointerMove(getClipPointerContext(e));
    if (!result.handled) {
      if (timelineToolPreview?.clipId === clip.id) setTimelineToolPreview(null);
      return;
    }
    setTimelineToolPreview(result.preview ?? null);
  };

  const handleMouseLeave = () => {
    if (timelineToolPreview?.clipId === clip.id) setTimelineToolPreview(null);
  };

  const handleClick = (e: React.MouseEvent) => {
    const result = dispatchTimelineClipPointerClick(getClipPointerContext(e));
    if (!result.handled) return;
    e.preventDefault();
    e.stopPropagation();

    if (result.operation) {
      applyTimelineEditOperation(result.operation, {
        source: 'ui',
      historyLabel: result.operation.type === 'select-clips-from-time'
        ? 'Track select'
        : result.operation.type === 'split-all-at-time'
          ? 'Blade all tracks'
          : 'Blade clip',
      });
    }
    if (result.nextToolId) setActiveTimelineTool(result.nextToolId);
    setTimelineToolPreview(null);
  };

  // Calculate cut indicator position for this clip
  const cutIndicatorX = shouldShowCutIndicator && timelineToolPreview?.time !== undefined
    ? ((timelineToolPreview.time - displayStartTime) / displayDuration) * width
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
  const spectralRegionOverlay = audioSpectralRegionSelection &&
    audioSpectralRegionSelection.endTime - audioSpectralRegionSelection.startTime > 0.001 &&
    audioSpectralRegionSelection.frequencyMaxHz - audioSpectralRegionSelection.frequencyMinHz > 1
    ? (() => {
        const regionStart = Math.max(displayStartTime, audioSpectralRegionSelection.startTime);
        const regionEnd = Math.min(displayStartTime + displayDuration, audioSpectralRegionSelection.endTime);
        if (regionEnd <= regionStart) return null;

        const laneTop = 18;
        const laneHeight = Math.max(1, trackBaseHeight - laneTop - 4);
        const top = laneTop + spectralYFromFrequencyHz(
          audioSpectralRegionSelection.frequencyMaxHz,
          laneHeight,
          spectralMaxFrequencyHz,
        );
        const bottom = laneTop + spectralYFromFrequencyHz(
          audioSpectralRegionSelection.frequencyMinHz,
          laneHeight,
          spectralMaxFrequencyHz,
        );

        return {
          left: ((regionStart - displayStartTime) / Math.max(0.001, displayDuration)) * width,
          width: ((regionEnd - regionStart) / Math.max(0.001, displayDuration)) * width,
          top,
          height: Math.max(2, bottom - top),
        };
      })()
    : null;
  const sourceTimeToDisplayTimelineTime = useCallback((sourceTime: number): number => {
    const sourceStart = Math.max(0, displayInPoint ?? 0);
    const sourceEnd = Math.max(sourceStart + 0.001, displayOutPoint ?? sourceStart + displayDuration);
    const sourceRatio = Math.max(0, Math.min(1, (sourceTime - sourceStart) / (sourceEnd - sourceStart)));
    const timelineRatio = clip.reversed ? 1 - sourceRatio : sourceRatio;
    return displayStartTime + timelineRatio * displayDuration;
  }, [clip.reversed, displayDuration, displayInPoint, displayOutPoint, displayStartTime]);
  const spectralImageLayerOverlays = useMemo(() => {
    if (!canSelectSpectralRegion && audioDisplayMode !== 'spectral') return [];
    const layers = clip.audioState?.spectralLayers ?? [];
    if (layers.length === 0) return [];

    const laneTop = 18;
    const laneHeight = Math.max(1, trackBaseHeight - laneTop - 4);
    return layers.flatMap(layer => {
      const layerDuration = finiteNumberOr(layer.duration, 0);
      if (layer.enabled === false || layerDuration <= 0) return [];

      const layerTimeStart = finiteNumberOr(layer.timeStart, 0);
      const layerFrequencyMin = finiteNumberOr(layer.frequencyMin, 0);
      const layerFrequencyMax = finiteNumberOr(layer.frequencyMax, spectralMaxFrequencyHz);
      const timelineStart = sourceTimeToDisplayTimelineTime(layerTimeStart);
      const timelineEnd = sourceTimeToDisplayTimelineTime(layerTimeStart + layerDuration);
      const regionStart = Math.max(displayStartTime, Math.min(timelineStart, timelineEnd));
      const regionEnd = Math.min(displayStartTime + displayDuration, Math.max(timelineStart, timelineEnd));
      if (regionEnd <= regionStart) return [];

      const top = laneTop + spectralYFromFrequencyHz(layerFrequencyMax, laneHeight, spectralMaxFrequencyHz);
      const bottom = laneTop + spectralYFromFrequencyHz(layerFrequencyMin, laneHeight, spectralMaxFrequencyHz);
      const mediaFile = spectralImageFilesById.get(layer.imageMediaFileId);
      return [{
        id: layer.id,
        left: ((regionStart - displayStartTime) / Math.max(0.001, displayDuration)) * width,
        width: ((regionEnd - regionStart) / Math.max(0.001, displayDuration)) * width,
        top,
        height: Math.max(8, bottom - top),
        layer,
        mediaFile,
      }];
    });
  }, [
    audioDisplayMode,
    canSelectSpectralRegion,
    clip.audioState?.spectralLayers,
    displayDuration,
    displayStartTime,
    sourceTimeToDisplayTimelineTime,
    spectralImageFilesById,
    spectralMaxFrequencyHz,
    trackBaseHeight,
    width,
  ]);
  const handleApplyAudioRegionEdit = (type: TimelineAudioRegionEditType) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    applyAudioRegionEdit(type);
  };
  const handleApplyAudioRegionEditWithParams = (
    type: TimelineAudioRegionEditType,
    params: Record<string, string | number | boolean | null>,
  ) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    applyAudioRegionEdit(type, { params });
  };
  const handleApplyAudioRepairEdit = (
    label: string,
    params: Record<string, string | number | boolean | null>,
  ) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    applyAudioRegionEdit('repair', {
      params: {
        label,
        ...params,
      },
    });
  };
  const handleApplySpectralRegionEdit = (type: TimelineSpectralRegionEditType) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    applySpectralRegionEdit(type);
  };
  const addSpectralImageLayerFromSelection = useCallback((imageMediaFileId: string) => {
    if (!audioSpectralRegionSelection) return null;
    const start = Math.min(audioSpectralRegionSelection.sourceInPoint, audioSpectralRegionSelection.sourceOutPoint);
    const end = Math.max(audioSpectralRegionSelection.sourceInPoint, audioSpectralRegionSelection.sourceOutPoint);
    if (end - start <= 0.0005) return null;

    return addClipSpectralImageLayer(clip.id, {
      imageMediaFileId,
      timeStart: start,
      duration: end - start,
      frequencyMin: audioSpectralRegionSelection.frequencyMinHz,
      frequencyMax: audioSpectralRegionSelection.frequencyMaxHz,
      opacity: 0.85,
      blendMode: 'attenuate',
      gainDb: -18,
      featherTime: 0.02,
      featherFrequency: 80,
    });
  }, [addClipSpectralImageLayer, audioSpectralRegionSelection, clip.id]);
  const handleAddSelectedImageSpectralLayer = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedSpectralImageFile) return;
    addSpectralImageLayerFromSelection(selectedSpectralImageFile.id);
  };
  const getDroppedImageMediaFileId = (dataTransfer: DataTransfer): string | null => {
    const mediaFileId = dataTransfer.getData('application/x-media-file-id');
    if (!mediaFileId) return null;
    const file = useMediaStore.getState().files.find(candidate => candidate.id === mediaFileId);
    return file?.type === 'image' ? file.id : null;
  };
  const handleSpectralImageLayerDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!canSelectSpectralRegion || !getDroppedImageMediaFileId(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  };
  const handleSpectralImageLayerDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!canSelectSpectralRegion) return;
    const imageMediaFileId = getDroppedImageMediaFileId(e.dataTransfer);
    if (!imageMediaFileId) return;

    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const centerTime = timelineTimeFromAudioRegionClientX(e.clientX, {
      rectLeft: rect.left,
      rectWidth: rect.width,
    });
    const layerDuration = Math.max(0.15, Math.min(displayDuration, Math.max(0.65, 160 / Math.max(1, zoom))));
    const centerFrequency = frequencyHzFromSpectralY(e.clientY - rect.top, rect.height, spectralMaxFrequencyHz);
    const frequencySpan = Math.max(120, spectralMaxFrequencyHz * 0.16);
    const selection = resolveTimelineSpectralRegionSelection({
      clip: {
        ...clip,
        startTime: displayStartTime,
        duration: displayDuration,
        inPoint: displayInPoint,
        outPoint: displayOutPoint,
        waveform: clip.waveform,
      },
      anchorTimelineTime: centerTime - layerDuration / 2,
      focusTimelineTime: centerTime + layerDuration / 2,
      anchorFrequencyHz: centerFrequency - frequencySpan / 2,
      focusFrequencyHz: centerFrequency + frequencySpan / 2,
      maxFrequencyHz: spectralMaxFrequencyHz,
    });

    addClipSpectralImageLayer(clip.id, {
      imageMediaFileId,
      timeStart: selection.sourceInPoint,
      duration: Math.max(0.001, selection.sourceOutPoint - selection.sourceInPoint),
      frequencyMin: selection.frequencyMinHz,
      frequencyMax: selection.frequencyMaxHz,
      opacity: 0.85,
      blendMode: 'attenuate',
      gainDb: -18,
      featherTime: 0.02,
      featherFrequency: 80,
    });
    setAudioSpectralRegionSelection(selection);
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

  // Track filtering must stay after all hooks so React sees a stable hook order
  // while clips move between tracks during drag and linked edits.
  if (isDragging && clipDrag && clipDrag.currentTrackId !== trackId) {
    return null;
  }
  if (!isDragging && !isLinkedToDragging && clip.trackId !== trackId) {
    return null;
  }
  if (clip.trackId !== trackId && !isDragging) {
    return null;
  }
  const clipStyle = {
    left,
    width,
    cursor: isTrackLocked ? 'not-allowed' : timelineToolCursor,
    animationDelay: `${animationDelay}s`,
    '--track-color': trackColor,
    '--clip-right-sticky-offset': `${clipRightStickyOffset}px`,
    // FLIP move animation: initial phase applies offset transform, animating phase transitions to 0
    ...(aiMovePhase === 'initial' && aiMove ? {
      transform: `translateX(${timeToPixel(aiMove.fromStartTime) - left}px)`,
    } : aiMovePhase === 'animating' && aiMove ? {
      transform: 'translateX(0)',
      transition: `transform ${aiMove.animationDuration}ms cubic-bezier(0.22, 1, 0.36, 1)`,
    } : {}),
    ...(isAudioClip && audioFocusMode ? {
      background: `linear-gradient(180deg, color-mix(in srgb, ${trackColor} 72%, #202020), color-mix(in srgb, ${trackColor} 34%, #101010))`,
      borderColor: trackColor,
    } : isSolidClip && clip.solidColor ? {
      background: clip.solidColor,
      borderColor: clip.solidColor,
    } : mediaLabelHex ? {
      background: mediaLabelHex,
      borderColor: mediaLabelHex,
    } : {}),
  } as CSSProperties & {
    '--track-color'?: string;
    '--clip-right-sticky-offset'?: string;
  };

  return (
    <div
      className={`${clipClass}${isBladeToolActive ? ' cut-mode' : ''} ${animationClass}`}
      style={clipStyle}
      data-clip-id={clip.id}
      onMouseDown={isTrackLocked || (isPointerToolActive && !canUseBodyToolGesture) ? undefined : onMouseDown}
      onDoubleClick={isPointerToolActive ? undefined : onDoubleClick}
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
        <div
          className="clip-waveform-indicator"
          title={clip.audioAnalysisJob ? `${clip.audioAnalysisJob.label}: ${clip.audioAnalysisJob.phase}` : undefined}
        >
          <div
            className="waveform-progress"
            style={{ width: `${clip.audioAnalysisJob?.progress ?? clip.waveformProgress ?? 50}%` }}
          />
        </div>
      )}
      {/* Audio waveform / spectrogram */}
      {waveformsEnabled && isAudioClip && (
        audioDisplayMode === 'spectral'
        || waveformPyramid
        || (clip.waveform && clip.waveform.length > 0)
        || clip.waveformChannels?.some(channel => channel.length > 0)
      ) && (
        <div className="clip-waveform">
          {audioDisplayMode === 'spectral' && spectrogramTileSet ? (
            <ClipSpectrogram
              tileSet={spectrogramTileSet}
              width={width}
              height={Math.max(20, trackBaseHeight - 12)}
              inPoint={spectrogramInPoint}
              outPoint={spectrogramOutPoint}
              naturalDuration={spectrogramNaturalDuration}
              renderStartPx={waveformRenderWindow.startPx}
              renderWidth={waveformRenderWindow.width}
              variant={spectrogramVariant}
            />
          ) : audioDisplayMode === 'spectral' ? (
            <div className="spectrogram-pending" />
          ) : waveformPyramid || (clip.waveform && clip.waveform.length > 0) || clip.waveformChannels?.some(channel => channel.length > 0) ? (
            <ClipWaveform
              waveform={clip.waveform ?? []}
              waveformChannels={clip.waveformChannels}
              width={width}
              height={Math.max(20, trackBaseHeight - 12)}
              inPoint={waveformInPoint}
              outPoint={waveformOutPoint}
              naturalDuration={waveformNaturalDuration}
              displayMode={audioDisplayMode}
              pixelsPerSecond={zoom}
              pyramid={waveformPyramid}
              waveformVariant={waveformVariant}
              displayGain={waveformDisplayGain}
              renderStartPx={waveformRenderWindow.startPx}
              renderWidth={waveformRenderWindow.width}
            />
          ) : null}
          {(audioAnalysisDisplayStatus || (audioWaveformDiagnostics?.badges.length ?? 0) > 0) && (
            <div className="clip-audio-status-stack">
              {audioAnalysisDisplayStatus && (
                <div
                  className={`clip-audio-analysis-status clip-audio-analysis-status-${audioAnalysisDisplayStatus.kind}`}
                  title={audioAnalysisDisplayStatus.title}
                  data-audio-analysis-status={audioAnalysisDisplayStatus.kind}
                >
                  {audioAnalysisDisplayStatus.label}
                </div>
              )}
              {audioWaveformDiagnostics?.badges.map((badge) => (
                <div
                  key={badge.kind}
                  className={`clip-audio-diagnostic-badge ${badge.className}`}
                  title={badge.title}
                  data-audio-diagnostic={badge.kind}
                  data-audio-diagnostic-source={audioWaveformDiagnostics.source}
                >
                  {badge.label}
                </div>
              ))}
            </div>
          )}
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
          <button type="button" onClick={handleApplyAudioRegionEditWithParams('split-stereo', { sourceChannel: 0, label: 'Split stereo left' })} title="Copy left channel across selected channels">L-M</button>
          <button type="button" onClick={handleApplyAudioRegionEditWithParams('split-stereo', { sourceChannel: 1, label: 'Split stereo right' })} title="Copy right channel across selected channels">R-M</button>
          <button type="button" onClick={handleApplyAudioRepairEdit('Hum notch', { repairType: 'hum-notch', baseFrequencyHz: 50, harmonicCount: 6, q: 35, featherTime: 0.02 })} title="Apply 50 Hz hum notch repair">Hum</button>
          <button type="button" onClick={handleApplyAudioRepairEdit('De-click', { repairType: 'de-click', threshold: 0.35, ratio: 4 })} title="Interpolate impulse clicks in the selected region">Click</button>
          <button type="button" onClick={handleApplyAudioRepairEdit('Splice smooth', { repairType: 'splice-smooth', edgeSeconds: 0.008 })} title="Smooth selected region boundaries">Smth</button>
          <button type="button" onClick={handleApplyAudioRepairEdit('Match loudness', { repairType: 'loudness-match', targetDb: -20, minGainDb: -24, maxGainDb: 24, featherTime: 0.01 })} title="Normalize selected region RMS toward -20 dBFS">LUFS</button>
        </div>
      )}
      {spectralRegionOverlay && (
        <div
          className={`clip-spectral-region-selection ${audioSpectralRegionSelection?.selectionMode === 'brush' ? 'brush' : 'rectangle'}`}
          style={{
            left: spectralRegionOverlay.left,
            width: spectralRegionOverlay.width,
            top: spectralRegionOverlay.top,
            height: spectralRegionOverlay.height,
          }}
        >
          <span className="clip-spectral-region-corner tl" />
          <span className="clip-spectral-region-corner tr" />
          <span className="clip-spectral-region-corner bl" />
          <span className="clip-spectral-region-corner br" />
        </div>
      )}
      {spectralImageLayerOverlays.map(({ id, left: overlayLeft, width: overlayWidth, top, height, layer, mediaFile }) => {
        const blendMode = layer.blendMode ?? 'attenuate';
        const opacity = finiteNumberOr(layer.opacity, 0.85);
        const gainDb = finiteNumberOr(layer.gainDb, -18);
        const imageUrl = mediaFile?.thumbnailUrl || mediaFile?.url;

        return (
          <div
            key={id}
            className={`clip-spectral-image-layer blend-${blendMode} ${layer.enabled === false ? 'disabled' : ''}`}
            style={{
              left: overlayLeft,
              width: overlayWidth,
              top,
              height,
              opacity: Math.max(0.18, opacity),
              backgroundImage: imageUrl ? `url(${imageUrl})` : undefined,
            }}
            title={`${mediaFile?.name ?? 'Spectral image'}: ${blendMode}, ${gainDb.toFixed(1)} dB`}
          >
            <span>{blendMode}</span>
          </div>
        );
      })}
      {spectralRegionOverlay && canSelectSpectralRegion && (
        <div
          className="clip-spectral-region-toolbar"
          style={{
            left: Math.max(4, spectralRegionOverlay.left),
            top: Math.max(20, spectralRegionOverlay.top),
          }}
          onMouseDown={handleAudioEditStackMouseDown}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <button type="button" onClick={handleApplySpectralRegionEdit('spectral-mask')} title="Attenuate selected frequency region">Mask</button>
          <button type="button" onClick={handleApplySpectralRegionEdit('spectral-resynthesis')} title="Create a resynthesis operation for the selected frequency region">Resyn</button>
          <button
            type="button"
            onClick={handleAddSelectedImageSpectralLayer}
            disabled={!selectedSpectralImageFile}
            title={selectedSpectralImageFile ? `Add ${selectedSpectralImageFile.name} as a spectral image layer` : 'Select an image in the Media panel first'}
          >
            Img
          </button>
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
      {canSelectSpectralRegion && (
        <div
          className="clip-audio-region-hitarea clip-spectral-region-hitarea"
          onMouseDown={handleSpectralRegionMouseDown}
          onDragOver={handleSpectralImageLayerDragOver}
          onDrop={handleSpectralImageLayerDrop}
          onDoubleClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            clearAudioSpectralRegionSelection();
          }}
          title="Drag spectral region; hold Shift or Alt for brush"
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
      {/* Fade curve - SVG bezier curve showing opacity or audio-volume automation */}
      {visibleFadeCurveKeyframes.length >= 2 && (
        <div
          className={`fade-curve-container ${isAudioClip ? 'audio-automation-curve-container' : ''}`}
          data-audio-automation-curve={isAudioClip ? 'volume' : undefined}
        >
          <FadeCurve
            key={visibleFadeCurveKey}
            keyframes={visibleFadeCurveKeyframes}
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
              if (!canUseFadeHandles) return;
              e.stopPropagation();
              onFadeStart(e, 'left');
            }}
            title={fadeInDuration > 0 ? `Fade In: ${fadeInDuration.toFixed(2)}s` : 'Drag to add fade in'}
          />
          <div
            className={`fade-handle right${fadeOutDuration > 0 ? ' active' : ''}`}
            style={fadeOutDuration > 0 ? { right: timeToPixel(fadeOutDuration) - 6 } : undefined}
            onMouseDown={(e) => {
              if (!canUseFadeHandles) return;
              e.stopPropagation();
              onFadeStart(e, 'right');
            }}
            title={fadeOutDuration > 0 ? `Fade Out: ${fadeOutDuration.toFixed(2)}s` : 'Drag to add fade out'}
          />
          {/* Trim handles */}
          <div
            className="trim-handle left"
            onMouseDown={(e) => {
              if (!canUseTrimHandles) return;
              e.stopPropagation();
              onTrimStart(e, 'left');
            }}
          />
          <div
            className="trim-handle right"
            onMouseDown={(e) => {
              if (!canUseTrimHandles) return;
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
