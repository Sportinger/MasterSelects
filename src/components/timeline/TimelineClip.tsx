// TimelineClip component - Clip rendering within tracks

import './TimelineClip.css';
import { memo, type CSSProperties, useRef, useState, useEffect, useCallback, useMemo } from 'react';
import type { TimelineClipProps } from './types';
import { useTimelineStore } from '../../stores/timeline';
import { useMediaStore } from '../../stores/mediaStore';
import { getTimelineTrackColor, TIMELINE_TRACK_COLOR_HIDDEN } from './trackColor';
import { ClipAudioEditStackControls } from './components/ClipAudioEditStackControls';
import { ClipAudioRegionSelectionOverlay } from './components/ClipAudioRegionSelectionOverlay';
import { ClipSpectralRegionOverlays } from './components/ClipSpectralRegionOverlays';
import { ClipAudioRegionContextMenu } from './components/ClipAudioRegionContextMenu';
import { ClipVideoBakeRegionOverlays } from './components/ClipVideoBakeRegionOverlays';
import { ClipAudioEditOperationOverlays } from './components/ClipAudioEditOperationOverlays';
import { ClipKeyframeTicks } from './components/ClipKeyframeTicks';
import { ClipFadeTrimControls } from './components/ClipFadeTrimControls';
import { ClipSelectionHitareas } from './components/ClipSelectionHitareas';
import {
  ClipPassiveBackgroundLayer,
  ClipPassiveForegroundLayer,
} from './components/ClipPassiveVisualLayers';
import { useTimelineSpectrogramTileSetState } from './hooks/useTimelineSpectrogramTileSet';
import { useTimelineWaveformPyramidState } from './hooks/useTimelineWaveformPyramid';
import {
  clipRequiresProcessedWaveformPyramid,
  createProcessedClipAudioStateHash,
} from '../../services/audio/processedWaveformEligibility';
import { canDeriveProcessedWaveformPyramid } from '../../services/audio/DerivedWaveformPyramidService';
import {
  collectAudioEffectInstanceRouteSettings,
  collectLegacyAudioEffectRouteSettings,
} from '../../services/audio/audioGraphRouteSettings';
import {
  resolveAudioEditOperationOverlays,
  resolveClipVideoBakeRegionOverlays,
  type AudioEditOperationOverlay,
  type ClipVideoBakeRegionOverlay,
} from './utils/activeRegionOverlays';
import { resolveProcessedAudioAnalysisDisplayStatus } from './utils/audioAnalysisDisplayStatus';
import { resolveAudioWaveformDiagnostics } from './utils/audioWaveformDiagnostics';
import { resolveAudioVolumeAutomationCurveKeyframes } from './utils/audioAutomationCurve';
import { resolveClipLabelHex } from './utils/resolveClipLabelHex';
import {
  resolveHorizontalRenderWindow,
  resolveStableWaveformRenderGeometry,
  resolveTimelineViewportWidth,
} from './utils/waveformRenderGeometry';
import { resolveClipMediaClassification } from './utils/clipMediaClassification';
import {
  canLoopExtendTimelineVectorClip,
  getTimelineClipSourceDuration,
} from './utils/clipSourceTiming';
import { resolveSourceExtensionGhosts } from './utils/sourceExtensionGhosts';
import {
  frequencyHzFromSpectralY,
  getSpectralMaxFrequencyHz,
  resolveTimelineSpectralRegionSelection,
} from './utils/spectralSelection';
import {
  resolveSpectralImageLayerOverlays,
  resolveSpectralRegionOverlay,
} from './utils/spectralRegionOverlays';
import type {
  TimelineAudioRegionSelection,
  TimelineSpectralRegionEditType,
} from '../../stores/timeline/types';
import {
  dispatchTimelineClipPointerClick,
  dispatchTimelineClipPointerMove,
  getTimelineToolCursor,
  isTimelineBladeTool,
  isTimelinePointerTool,
} from './tools/pointer/timelineToolPointerDispatcher';
import { getTrimHandleArrowDirections } from './utils/trimHandleDirections';
import {
  hasLegacyWaveformSamples,
} from '../../utils/audioWaveformPresence';
import {
  createTimelineSourceWaveformGenerationRequest,
  scheduleVisibleTimelineSourceWaveformGeneration,
} from '../../services/timeline/timelineSourceWaveformWarmup';
import { useClipThumbnailFilmstripPlan } from './hooks/useClipThumbnailFilmstripPlan';
import {
  scheduleTimelineProcessedWaveformDerivation,
  scheduleTimelineSpectrogramTileGeneration,
} from '../../services/timeline/timelineAudioArtifactGenerationWarmup';
import { useClipAudioMediaViewProps } from './hooks/useClipAudioMediaViewProps';
import { useClipAudioRegionControls } from './hooks/useClipAudioRegionControls';
import { useClipStemSwitcher } from './hooks/useClipStemSwitcher';
import { useClipAnimationState } from './hooks/useClipAnimationState';
import {
  useClipRegionInteractions,
  type AudioRegionDragState,
  type AudioRegionMoveDragState,
  type AudioRegionResizeDragState,
  type SpectralRegionDragState,
  type VideoBakeRegionDragState,
} from './hooks/useClipRegionInteractions';
import { useClipKeyframeTickDrag } from './hooks/useClipKeyframeTickDrag';

const TIMELINE_VIEWPORT_FALLBACK_PX = 1600;
const TIMELINE_VIEWPORT_MIN_PX = 1600;
const TIMELINE_RENDER_OVERSCAN_PX = 512;
const CLIP_RIGHT_STICKY_PADDING_PX = 8;
const WAVEFORM_PYRAMID_AUTO_UPGRADE_ZOOM = 250;
const WAVEFORM_PYRAMID_AUTO_UPGRADE_WIDTH = 16_384;
const EMPTY_CLIP_KEYFRAMES = [] as const;
const EMPTY_AUDIO_EDIT_STACK = [] as const;
const EMPTY_WAVEFORM: number[] = [];
const EMPTY_SPECTRAL_LAYERS = [] as const;

function getSlippedSourceWindow(
  clip: TimelineClipProps['clip'],
  sourceDelta: number,
): { inPoint: number; outPoint: number } {
  const visibleSourceDuration = clip.outPoint - clip.inPoint;
  const maxInPoint = Math.max(0, getTimelineClipSourceDuration(clip) - visibleSourceDuration);
  const inPoint = Math.max(0, Math.min(maxInPoint, clip.inPoint + sourceDelta));
  return {
    inPoint,
    outPoint: inPoint + visibleSourceDuration,
  };
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
  isTrimFollower,
  isClipDragActive,
  clipDrag,
  clipTrim,
  zoom,
  scrollX,
  timelineViewportWidth,
  proxyEnabled,
  proxyStatus,
  proxyProgress,
  audioProxyStatus,
  audioProxyProgress,
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
  keyframeTimeGroups,
  onMoveKeyframeGroup,
  timeToPixel,
  formatTime,
  passiveVisualsSuppressed = false,
}: TimelineClipProps) {
  const thumbnailsEnabled = useTimelineStore(s => s.thumbnailsEnabled);
  const waveformsEnabled = useTimelineStore(s => s.waveformsEnabled);
  const audioDisplayMode = useTimelineStore(s => s.audioDisplayMode);
  const audioFocusMode = useTimelineStore(s => s.audioFocusMode);
  const trackFocusMode = useTimelineStore(s => s.trackFocusMode);
  const showAudioRegionEditMarkers = useTimelineStore(s => s.showAudioRegionEditMarkers);
  const activeTimelineToolId = useTimelineStore(s => s.activeTimelineToolId);
  const timelineToolPreview = useTimelineStore(s => s.timelineToolPreview);
  const clipStemSeparationJob = useTimelineStore(s => {
    const directJob = s.clipStemSeparationJobs[clip.id];
    if (directJob && (directJob.clipId === clip.id || directJob.requestedClipId === clip.id)) {
      return directJob;
    }

    const linkedJob = clip.linkedClipId ? s.clipStemSeparationJobs[clip.linkedClipId] : undefined;
    if (linkedJob && (linkedJob.clipId === clip.id || linkedJob.requestedClipId === clip.id || linkedJob.clipId === clip.linkedClipId)) {
      return linkedJob;
    }

    return Object.values(s.clipStemSeparationJobs).find(job =>
      job.clipId === clip.id ||
      job.requestedClipId === clip.id ||
      (clip.linkedClipId ? job.clipId === clip.linkedClipId || job.requestedClipId === clip.linkedClipId : false)
    ) ?? null;
  });
  const setTimelineToolPreview = useTimelineStore(s => s.setTimelineToolPreview);
  const applyTimelineEditOperation = useTimelineStore(s => s.applyTimelineEditOperation);
  const setActiveTimelineTool = useTimelineStore(s => s.setActiveTimelineTool);
  const timelineTrackColorsVisible = useTimelineStore(s => s.audioLayerAdvancedMode !== false);
  const audioRegionSelection = useTimelineStore(s =>
    s.audioRegionSelection?.clipId === clip.id ? s.audioRegionSelection : null
  );
  const audioRegionGainPreview = useTimelineStore(s =>
    s.audioRegionGainPreview?.clipId === clip.id ? s.audioRegionGainPreview : null
  );
  const audioSpectralRegionSelection = useTimelineStore(s =>
    s.audioSpectralRegionSelection?.clipId === clip.id ? s.audioSpectralRegionSelection : null
  );
  const videoBakeRegionSelection = useTimelineStore(s =>
    s.videoBakeRegionSelection?.scope === 'clip' && s.videoBakeRegionSelection.clipId === clip.id
      ? s.videoBakeRegionSelection
      : null
  );
  const setAudioRegionSelection = useTimelineStore(s => s.setAudioRegionSelection);
  const clearAudioRegionSelection = useTimelineStore(s => s.clearAudioRegionSelection);
  const setVideoBakeRegionSelection = useTimelineStore(s => s.setVideoBakeRegionSelection);
  const clearVideoBakeRegionSelection = useTimelineStore(s => s.clearVideoBakeRegionSelection);
  const addClipVideoBakeRegion = useTimelineStore(s => s.addClipVideoBakeRegion);
  const bakeClipVideoBakeRegion = useTimelineStore(s => s.bakeClipVideoBakeRegion);
  const unbakeClipVideoBakeRegion = useTimelineStore(s => s.unbakeClipVideoBakeRegion);
  const removeClipVideoBakeRegion = useTimelineStore(s => s.removeClipVideoBakeRegion);
  const setAudioSpectralRegionSelection = useTimelineStore(s => s.setAudioSpectralRegionSelection);
  const clearAudioSpectralRegionSelection = useTimelineStore(s => s.clearAudioSpectralRegionSelection);
  const hasAudioRegionClipboard = useTimelineStore(s => s.audioRegionClipboard !== null);
  const applyAudioRegionEdit = useTimelineStore(s => s.applyAudioRegionEdit);
  const setAudioRegionGainPreview = useTimelineStore(s => s.setAudioRegionGainPreview);
  const clearAudioRegionGainPreview = useTimelineStore(s => s.clearAudioRegionGainPreview);
  const setAudioRegionGainEdit = useTimelineStore(s => s.setAudioRegionGainEdit);
  const applySpectralRegionEdit = useTimelineStore(s => s.applySpectralRegionEdit);
  const addClipSpectralImageLayer = useTimelineStore(s => s.addClipSpectralImageLayer);
  const copySelectedAudioRegion = useTimelineStore(s => s.copySelectedAudioRegion);
  const pasteAudioRegionToSelection = useTimelineStore(s => s.pasteAudioRegionToSelection);
  const setClipAudioEditOperationEnabled = useTimelineStore(s => s.setClipAudioEditOperationEnabled);
  const setClipAudioEditOperationRange = useTimelineStore(s => s.setClipAudioEditOperationRange);
  const removeClipAudioEditOperation = useTimelineStore(s => s.removeClipAudioEditOperation);
  const clearClipAudioEditStack = useTimelineStore(s => s.clearClipAudioEditStack);
  const bakeClipAudioEditStack = useTimelineStore(s => s.bakeClipAudioEditStack);
  const unbakeClipAudioEditStack = useTimelineStore(s => s.unbakeClipAudioEditStack);
  const setClipSourceToStem = useTimelineStore(s => s.setClipSourceToStem);
  const prewarmStemSourceMediaFiles = useTimelineStore(s => s.prewarmStemSourceMediaFiles);
  const mediaFiles = useMediaStore(s => s.files);
  const selectClip = useTimelineStore(s => s.selectClip);
  const clipAudioKeyframes = useTimelineStore(s => s.clipKeyframes.get(clip.id) ?? EMPTY_CLIP_KEYFRAMES);
  const passiveMediaEnabled = !passiveVisualsSuppressed;
  const passiveDecorationsEnabled = passiveMediaEnabled;
  const processedWaveformPyramidRef = passiveMediaEnabled ? clip.audioState?.processedAnalysisRefs?.processedWaveformPyramidId : undefined;
  const sourceWaveformPyramidRef = passiveMediaEnabled ? clip.audioState?.sourceAnalysisRefs?.waveformPyramidId : undefined;
  const hasLegacyWaveformData = hasLegacyWaveformSamples(clip);
  const processedSpectrogramTileSetRef = passiveMediaEnabled ? clip.audioState?.processedAnalysisRefs?.spectrogramTileSetIds?.[0] : undefined;
  const sourceSpectrogramTileSetRef = passiveMediaEnabled ? clip.audioState?.sourceAnalysisRefs?.spectrogramTileSetIds?.[0] : undefined;
  const processedWaveformState = useTimelineWaveformPyramidState(processedWaveformPyramidRef);
  const sourceWaveformState = useTimelineWaveformPyramidState(sourceWaveformPyramidRef);
  const processedSpectrogramState = useTimelineSpectrogramTileSetState(processedSpectrogramTileSetRef);
  const sourceSpectrogramState = useTimelineSpectrogramTileSetState(sourceSpectrogramTileSetRef);
  const processedWaveformPyramid = processedWaveformState.pyramid;
  const sourceWaveformPyramid = sourceWaveformState.pyramid;
  const audioEditStack = clip.audioState?.editStack ?? EMPTY_AUDIO_EDIT_STACK;
  const activeAudioEditCount = audioEditStack.filter(operation => operation.enabled !== false).length;
  const latestAudioBake = clip.audioState?.bakeHistory?.at(-1);
  const canUnbakeAudioEditStack = Boolean(latestAudioBake?.restore);
  const usePredictiveAudioWaveform = audioRegionGainPreview !== null || (!processedWaveformPyramid && audioEditStack.length > 0);
  const waveformPyramid = usePredictiveAudioWaveform && sourceWaveformPyramid
    ? sourceWaveformPyramid
    : processedWaveformPyramid ?? sourceWaveformPyramid;
  const waveformUsesProcessedPyramid = Boolean(waveformPyramid && processedWaveformPyramid && waveformPyramid === processedWaveformPyramid);
  const waveformUsesSourcePyramid = Boolean(waveformPyramid && sourceWaveformPyramid && waveformPyramid === sourceWaveformPyramid);
  const processedSpectrogramTileSet = processedSpectrogramState.tileSet;
  const sourceSpectrogramTileSet = sourceSpectrogramState.tileSet;
  const spectrogramTileSet = processedSpectrogramTileSet ?? sourceSpectrogramTileSet;
  const spectrogramVariant: 'processed' | 'source' = processedSpectrogramTileSet ? 'processed' : 'source';
  const spectralMaxFrequencyHz = getSpectralMaxFrequencyHz(spectrogramTileSet?.sampleRate);
  const selectedSpectralImageFileId = useMediaStore(s => {
    for (const id of s.selectedIds) {
      const file = s.files.find(candidate => candidate.id === id);
      if (file?.type === 'image') return file.id;
    }
    return null;
  });
  const spectralImageMediaFiles = mediaFiles;
  const spectralImageFilesById = useMemo(() => {
    const entries = spectralImageMediaFiles
      .filter(file => file.type === 'image')
      .map(file => [file.id, file] as const);
    return new Map(entries);
  }, [spectralImageMediaFiles]);
  const selectedSpectralImageFile = selectedSpectralImageFileId
    ? spectralImageFilesById.get(selectedSpectralImageFileId) ?? null
    : null;
  const waveformVariant: 'processed' | 'source' | 'legacy' = waveformUsesProcessedPyramid
    ? 'processed'
    : waveformUsesSourcePyramid
      ? 'source'
      : 'legacy';
  const waveformDisplayGain = useMemo(() => {
    const clipAudioEffectIds = new Set((clip.audioState?.effectStack ?? []).map(effect => effect.id));
    const graphSettings = collectAudioEffectInstanceRouteSettings(clip.audioState?.effectStack);
    const legacySettings = collectLegacyAudioEffectRouteSettings(clip.effects, clipAudioEffectIds);
    return Math.max(0, Math.min(8, graphSettings.volume * legacySettings.volume));
  }, [clip.audioState?.effectStack, clip.effects]);
  const rawWaveformProcessingState = processedWaveformPyramidRef && !processedWaveformState.pyramid
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
  const canDeriveVisibleProcessedWaveform = useMemo(
    () => canDeriveProcessedWaveformPyramid(clip, clipAudioKeyframes),
    [clip, clipAudioKeyframes],
  );
  const hasWaveformDisplayFallback = Boolean(
    sourceWaveformPyramid ||
    hasLegacyWaveformData,
  );
  const shouldSuppressBackgroundProcessedWaveformUi = audioDisplayMode !== 'spectral' &&
    needsProcessedAudioAnalysis &&
    hasWaveformDisplayFallback &&
    (canDeriveVisibleProcessedWaveform || usePredictiveAudioWaveform);
  const waveformProcessingState = shouldSuppressBackgroundProcessedWaveformUi
    ? ''
    : rawWaveformProcessingState;
  const canResolveAudioSourceForAnalysis = Boolean(
    clip.isComposition ||
    clip.file ||
    clip.mediaFileId ||
    clip.source?.mediaFileId,
  );
  const processedWaveformStatus = shouldSuppressBackgroundProcessedWaveformUi
    ? null
    : resolveProcessedAudioAnalysisDisplayStatus({
        artifactLabel: 'waveform',
        needsProcessed: needsProcessedAudioAnalysis,
        processedRef: processedWaveformPyramidRef,
        processedReady: Boolean(processedWaveformPyramid),
        fallbackAvailable: hasWaveformDisplayFallback,
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
  const isBackgroundProcessedWaveformJob = clip.audioAnalysisJob?.processed === true &&
    clip.audioAnalysisJob.artifactKinds.includes('processed-waveform-pyramid');
  const showWaveformGenerationIndicator = clip.waveformGenerating &&
    !(isBackgroundProcessedWaveformJob && shouldSuppressBackgroundProcessedWaveformUi);
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
  const leftTrimHandleDirections = getTrimHandleArrowDirections(clip, 'left');
  const rightTrimHandleDirections = getTrimHandleArrowDirections(clip, 'right');

  // Subscribe to playhead position only when blade tool is active (avoids re-renders during playback)
  const playheadPosition = useTimelineStore((state) =>
    isBladeToolActive ? state.playheadPosition : 0
  );

  // Look up media label color from mediaStore
  const mediaLabelHex = useMediaStore(s => resolveClipLabelHex(clip, s));

  const {
    aiMove,
    aiMovePhase,
    animationClass,
    animationDelay,
  } = useClipAnimationState({ clip, clips, tracks });

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

  const {
    isAudioClip,
    isTextClip,
    isText3DClip,
    isSolidClip,
    isMathSceneClip,
    isVectorAnimationClip,
    vectorAnimationIcon,
    vectorAnimationTitle,
    isSplatEffectorClip,
    staticClipIconKind,
    showsStaticClipArtwork,
    text3DProperties,
    clipTypeClass,
  } = resolveClipMediaClassification(clip);

  const isGeneratingProxy = proxyStatus === 'generating';
  const hasProxy = proxyStatus === 'ready';
  const hasProxyError = proxyStatus === 'error';
  const isGeneratingAudioProxy = audioProxyStatus === 'generating';
  const hasAudioProxy = audioProxyStatus === 'ready';
  const hasAudioProxyError = audioProxyStatus === 'error';
  const {
    showActiveStemSeparation,
    activeStemProgressPercent,
    activeStemStatusTitle,
    isDownloadingStemModel,
    stemSwitcherNode,
  } = useClipStemSwitcher({
    clip,
    clips,
    mediaFiles,
    clipStemSeparationJob,
    setClipSourceToStem,
    prewarmStemSourceMediaFiles,
  });

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
    // Use the resolved (snapped/frame-quantized) delta so the live resize lands
    // exactly where the trim will commit.
    const deltaTime = clipTrim.appliedDelta;
    const sourceType = clip.source?.type;
    const isInfiniteClip = sourceType === 'text' || sourceType === 'image' || sourceType === 'solid' || sourceType === 'camera' || sourceType === 'splat-effector' || sourceType === 'math-scene';
    const canLoopExtendRight = canLoopExtendTimelineVectorClip(clip);
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
  } else if (clipTrim && (isTrimFollower || (isLinkedToTrimming && trimmedClip))) {
    // Resize this clip live too: a linked clip, or a selected clip following a
    // multi-trim. Each clamps the shared (snapped) delta to its own bounds.
    const deltaTime = clipTrim.appliedDelta;
    const canLoopExtendRight = canLoopExtendTimelineVectorClip(clip);
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
  const isClipPositionDragPreview = !clipDrag?.toolGesture && (
    isDragging ||
    isLinkedToDragging ||
    (
      clipDrag?.multiSelectClipIds?.includes(clip.id) &&
      clipDrag.multiSelectTimeDelta !== undefined
    )
  );

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
  const renderTimelineViewportWidth = resolveTimelineViewportWidth({
    timelineViewportWidth,
    fallbackPx: TIMELINE_VIEWPORT_FALLBACK_PX,
    minPx: TIMELINE_VIEWPORT_MIN_PX,
  });
  const staticContentRenderLeft = isClipPositionDragPreview
    ? timeToPixel(displayStartTime)
    : left;
  const waveformRenderWindow = useMemo(() => (
    resolveHorizontalRenderWindow({
      scrollX,
      contentLeft: staticContentRenderLeft,
      contentWidth: width,
      viewportWidth: renderTimelineViewportWidth,
      overscanPx: TIMELINE_RENDER_OVERSCAN_PX,
    })
  ), [renderTimelineViewportWidth, scrollX, staticContentRenderLeft, width]);
  const {
    thumbnailRenderWindow,
    showSegmentThumbnails,
    showRegularThumbnails,
    useSourceCache,
    cachedThumbnails,
    segmentThumbnailPlans,
    legacyThumbnailPlans,
  } = useClipThumbnailFilmstripPlan({
    clip,
    passiveMediaEnabled,
    thumbnailsEnabled,
    isAudioClip,
    showsStaticClipArtwork,
    scrollX,
    contentLeft: staticContentRenderLeft,
    width,
    viewportWidth: renderTimelineViewportWidth,
    displayInPoint,
    displayOutPoint,
  });

  useEffect(() => {
    if (!passiveMediaEnabled || !waveformsEnabled || !isAudioClip || clip.waveformGenerating || isClipDragActive) {
      return;
    }

    const shouldUpgrade =
      audioDisplayMode === 'detailed' ||
      (audioDisplayMode === 'compact' && (zoom >= WAVEFORM_PYRAMID_AUTO_UPGRADE_ZOOM || width > WAVEFORM_PYRAMID_AUTO_UPGRADE_WIDTH));

    if (!shouldUpgrade) return;

    const request = createTimelineSourceWaveformGenerationRequest(clip, audioDisplayMode);
    if (!request) return;

    return scheduleVisibleTimelineSourceWaveformGeneration([request]);
  }, [
    audioDisplayMode,
    clip.audioState,
    clip.file,
    clip.mediaFileId,
    clip.name,
    clip.source?.mediaFileId,
    clip.source?.type,
    clip.id,
    clip.waveform,
    clip.waveformChannels,
    clip.waveformGenerating,
    isClipDragActive,
    isAudioClip,
    passiveMediaEnabled,
    waveformsEnabled,
    width,
    zoom,
  ]);

  const processedWaveformRequestKey = useMemo(
    () => passiveMediaEnabled
      ? `${clip.id}:${createProcessedClipAudioStateHash(clip, { keyframes: clipAudioKeyframes })}`
      : `${clip.id}:passive-media-suppressed`,
    [clip, clipAudioKeyframes, passiveMediaEnabled],
  );

  useEffect(() => {
    if (
      !waveformsEnabled ||
      !passiveMediaEnabled ||
      !isAudioClip ||
      audioDisplayMode === 'spectral' ||
      processedWaveformPyramidRef ||
      clip.waveformGenerating ||
      isClipDragActive
    ) {
      return;
    }

    return scheduleTimelineProcessedWaveformDerivation({
      clipId: clip.id,
      requestKey: processedWaveformRequestKey,
    });
  }, [
    clip.id,
    clip.waveformGenerating,
    audioDisplayMode,
    isClipDragActive,
    isAudioClip,
    passiveMediaEnabled,
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
      !passiveMediaEnabled ||
      !isAudioClip ||
      audioDisplayMode !== 'spectral' ||
      clip.waveformGenerating ||
      isClipDragActive
    ) {
      return;
    }

    return scheduleTimelineSpectrogramTileGeneration({
      clipId: clip.id,
      requestKey: spectrogramRequestKey,
    });
  }, [
    audioDisplayMode,
    clip.id,
    clip.waveformGenerating,
    isClipDragActive,
    isAudioClip,
    passiveMediaEnabled,
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

  const keyframeTickGroups = keyframeTimeGroups;
  const [audioRegionDrag, setAudioRegionDrag] = useState<AudioRegionDragState | null>(null);
  const [videoBakeRegionDrag, setVideoBakeRegionDrag] = useState<VideoBakeRegionDragState | null>(null);
  const [audioRegionMoveDrag, setAudioRegionMoveDrag] = useState<AudioRegionMoveDragState | null>(null);
  const [audioRegionResizeDrag, setAudioRegionResizeDrag] = useState<AudioRegionResizeDragState | null>(null);
  const [spectralRegionDrag, setSpectralRegionDrag] = useState<SpectralRegionDragState | null>(null);
  const [audioBakePending, setAudioBakePending] = useState(false);

  const getMatchingAudioRegionOperationIds = useCallback((selection: TimelineAudioRegionSelection): string[] => {
    const start = Math.min(selection.sourceInPoint, selection.sourceOutPoint);
    const end = Math.max(selection.sourceInPoint, selection.sourceOutPoint);
    return audioEditStack
      .filter(operation => {
        if (!operation.timeRange) return false;
        const operationStart = Math.min(operation.timeRange.start, operation.timeRange.end);
        const operationEnd = Math.max(operation.timeRange.start, operation.timeRange.end);
        return Math.abs(operationStart - start) <= 0.001 &&
          Math.abs(operationEnd - end) <= 0.001;
      })
      .map(operation => operation.id);
  }, [audioEditStack]);

  const activeAudioRegionOperationDrag = audioRegionMoveDrag ?? audioRegionResizeDrag;
  const displayAudioEditStack = useMemo(() => {
    if (!audioRegionSelection || !activeAudioRegionOperationDrag?.operationIds.length) {
      return audioEditStack;
    }

    const operationIds = new Set(activeAudioRegionOperationDrag.operationIds);
    const start = Math.min(audioRegionSelection.sourceInPoint, audioRegionSelection.sourceOutPoint);
    const end = Math.max(audioRegionSelection.sourceInPoint, audioRegionSelection.sourceOutPoint);
    const timelineStart = Math.min(audioRegionSelection.startTime, audioRegionSelection.endTime);
    const timelineEnd = Math.max(audioRegionSelection.startTime, audioRegionSelection.endTime);

    return audioEditStack.map(operation => {
      if (!operationIds.has(operation.id) || !operation.timeRange) return operation;
      return {
        ...operation,
        params: {
          ...operation.params,
          timelineStart,
          timelineEnd,
        },
        timeRange: { start, end },
      };
    });
  }, [activeAudioRegionOperationDrag, audioEditStack, audioRegionSelection]);
  const preferSourceWaveformForAudioRegionDrag = Boolean(activeAudioRegionOperationDrag?.operationIds.length && sourceWaveformPyramid);
  const waveformPyramidForRender = preferSourceWaveformForAudioRegionDrag
    ? sourceWaveformPyramid
    : waveformPyramid;
  const waveformVariantForRender: 'processed' | 'source' | 'legacy' = preferSourceWaveformForAudioRegionDrag
    ? 'source'
    : waveformVariant;
  const waveformUsesProcessedPyramidForRender = Boolean(
    waveformPyramidForRender &&
    processedWaveformPyramid &&
    waveformPyramidForRender === processedWaveformPyramid,
  );
  const processedWaveformPyramidForRender = waveformUsesProcessedPyramidForRender
    ? processedWaveformPyramid
    : null;
  const waveformNaturalDurationForRender = processedWaveformPyramidForRender
    ? Math.max(0.001, processedWaveformPyramidForRender.duration)
    : (clip.source?.naturalDuration || clip.duration);
  const waveformInPointForRender = processedWaveformPyramidForRender ? 0 : displayInPoint;
  const waveformOutPointForRender = processedWaveformPyramidForRender
    ? Math.max(0.001, processedWaveformPyramidForRender.duration)
    : displayOutPoint;
  const waveformLegacyForRender = clip.waveform ?? EMPTY_WAVEFORM;
  const waveformChannelsForRender = clip.waveformChannels;
  const hasWaveformForRender = Boolean(
    waveformPyramidForRender ||
    waveformLegacyForRender.length > 0 ||
    waveformChannelsForRender?.some(channel => channel.length > 0)
  );
  const waveformDisplayGainForRender = waveformDisplayGain;
  const canApplyPredictiveAudioWaveform = waveformVariantForRender !== 'processed';
  const predictiveAudioEditStack = canApplyPredictiveAudioWaveform
    ? displayAudioEditStack
    : EMPTY_AUDIO_EDIT_STACK;
  const predictiveAudioRegionGainPreview = canApplyPredictiveAudioWaveform
    ? audioRegionGainPreview
    : null;
  const originalWaveformTrimInPoint = isTrimming && clipTrim
    ? clipTrim.originalInPoint
    : clip.inPoint;
  const originalWaveformTrimOutPoint = isTrimming && clipTrim
    ? clipTrim.originalOutPoint
    : clip.outPoint;
  const stableWaveformGeometry = resolveStableWaveformRenderGeometry({
    isAudioClip,
    isTrimming,
    isLinkedToTrimming,
    hasClipTrim: Boolean(clipTrim),
    usesProcessedPyramid: Boolean(processedWaveformPyramidForRender),
    clipWidth: width,
    clipLeft: left,
    scrollX,
    viewportWidth: renderTimelineViewportWidth,
    overscanPx: TIMELINE_RENDER_OVERSCAN_PX,
    baseRenderWindow: waveformRenderWindow,
    waveformInPoint: waveformInPointForRender,
    waveformOutPoint: waveformOutPointForRender,
    originalInPoint: originalWaveformTrimInPoint,
    originalOutPoint: originalWaveformTrimOutPoint,
    displayDuration,
  });
  const useStableWaveformTrimWindow = stableWaveformGeometry.useStableTrimWindow;
  const waveformSourceSecondsPerPixel = stableWaveformGeometry.sourceSecondsPerPixel;
  const stableWaveformContentInPoint = stableWaveformGeometry.contentInPoint;
  const stableWaveformContentOutPoint = stableWaveformGeometry.contentOutPoint;
  const stableWaveformContentWidth = stableWaveformGeometry.contentWidth;
  const stableWaveformContentOffsetPx = stableWaveformGeometry.contentOffsetPx;
  const stableWaveformRenderWindow = stableWaveformGeometry.renderWindow;
  const stableWaveformClipDuration = stableWaveformGeometry.clipDuration;
  const {
    audioSpectrogramProps,
    audioWaveformProps,
  } = useClipAudioMediaViewProps({
    clipId: clip.id,
    trackBaseHeight,
    width,
    zoom,
    audioDisplayMode,
    spectrogramTileSet,
    spectrogramInPoint,
    spectrogramOutPoint,
    spectrogramNaturalDuration,
    spectrogramVariant,
    waveformRenderWindow,
    waveformLegacyForRender,
    waveformChannelsForRender,
    waveformNaturalDurationForRender,
    waveformPyramidForRender,
    waveformVariantForRender,
    waveformDisplayGainForRender,
    stableWaveformContentWidth,
    stableWaveformContentInPoint,
    stableWaveformContentOutPoint,
    stableWaveformClipDuration,
    stableWaveformRenderWindow,
    stableWaveformContentOffsetPx,
    audioVolumeAutomationKeyframes,
    predictiveAudioEditStack,
    predictiveAudioRegionGainPreview,
    useStableWaveformTrimWindow,
    originalWaveformTrimInPoint,
    originalWaveformTrimOutPoint,
    waveformSourceSecondsPerPixel,
  });
  const {
    audioRegionOverlay,
    audioRegionGainControl,
    audioRegionContextMenu,
    audioRegionContextMenuRef,
    audioRegionContextMenuRenderPosition,
    audioRegionContextMenuModel,
    runAudioRegionContextMenuCommand,
    closeAudioRegionContextMenu,
    handleAudioRegionGainMouseDown,
    handleAudioRegionContextMenu,
    handleResetAudioRegionGain,
  } = useClipAudioRegionControls({
    clip,
    audioRegionSelection,
    displayAudioEditStack,
    displayStartTime,
    displayDuration,
    width,
    hasAudioRegionClipboard,
    applyTimelineEditOperation,
    applyAudioRegionEdit,
    setAudioRegionGainPreview,
    clearAudioRegionGainPreview,
    setAudioRegionGainEdit,
    setAudioRegionSelection,
    clearAudioRegionSelection,
    copySelectedAudioRegion,
    pasteAudioRegionToSelection,
    selectClip,
  });

  const commitAudioRegionOperationRange = useCallback((
    operationIds: string[],
    selection: TimelineAudioRegionSelection,
    historyLabel: string,
  ) => {
    if (operationIds.length === 0) return;
    setClipAudioEditOperationRange(clip.id, operationIds, selection, {
      captureHistory: true,
      historyLabel,
    });
  }, [clip.id, setClipAudioEditOperationRange]);

  const {
    keyframeGroupDrag,
    handleKeyframeTickMouseDown,
  } = useClipKeyframeTickDrag({
    keyframeTickGroups,
    displayDuration,
    width,
    onMoveKeyframeGroup,
  });

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
  const canSelectVideoBakeRegion = trackFocusMode === 'video' &&
    !isAudioClip &&
    activeTimelineToolId === 'select' &&
    track.locked !== true;

  const {
    timelineTimeFromAudioRegionClientX,
    sourceTimeToVideoBakeTimelineTime,
    handleAudioRegionMouseDown,
    handleAudioRegionDoubleClick,
    handleVideoBakeRegionMouseDown,
    handleVideoBakeRegionDoubleClick,
    handleAudioRegionSelectionMouseDown,
    handleAudioRegionEdgeMouseDown,
    handleSpectralRegionMouseDown,
    handleSpectralRegionDoubleClick,
  } = useClipRegionInteractions({
    clip,
    track,
    displayStartTime,
    displayDuration,
    displayInPoint,
    displayOutPoint,
    width,
    zoom,
    spectralMaxFrequencyHz,
    canSelectAudioRegion,
    canSelectSpectralRegion,
    canSelectVideoBakeRegion,
    audioRegionSelection,
    audioRegionDrag,
    videoBakeRegionDrag,
    audioRegionMoveDrag,
    audioRegionResizeDrag,
    spectralRegionDrag,
    setAudioRegionDrag,
    setVideoBakeRegionDrag,
    setAudioRegionMoveDrag,
    setAudioRegionResizeDrag,
    setSpectralRegionDrag,
    getMatchingAudioRegionOperationIds,
    commitAudioRegionOperationRange,
    closeAudioRegionContextMenu,
    setAudioRegionSelection,
    clearAudioRegionSelection,
    setAudioSpectralRegionSelection,
    clearAudioSpectralRegionSelection,
    setVideoBakeRegionSelection,
    clearVideoBakeRegionSelection,
    addClipVideoBakeRegion,
  });

  // Check if this clip is part of a multi-select drag
  const isInMultiSelectDrag = clipDrag?.multiSelectClipIds?.includes(clip.id) && clipDrag.multiSelectTimeDelta !== undefined;
  const isClipBodyDragging = isDragging || isLinkedToDragging || isInMultiSelectDrag;
  const showFocusCollisionHighlight = trackFocusMode !== 'balanced' && !!clipDrag?.overlapClipIds?.length;
  const isOverlapCollisionTarget = showFocusCollisionHighlight && !!clipDrag?.overlapClipIds?.includes(clip.id);
  const isOverlapCollisionSource = showFocusCollisionHighlight && isClipBodyDragging;
  const isTrackLocked = track.locked === true;
  const canHandleTimelineToolPointer = !isClipDragActive && !isTrackLocked && !isClipBodyDragging;
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
    isOverlapCollisionSource ? 'overlap-collision-source' : '',
    isOverlapCollisionTarget ? 'overlap-collision-target' : '',
    clipTypeClass,
    isAudioClip ? `audio-mode-${audioDisplayMode}` : '',
    isAudioClip && audioFocusMode ? 'audio-focus-active' : '',
    audioRegionSelection ? 'audio-region-selected' : '',
    audioSpectralRegionSelection ? 'spectral-region-selected' : '',
    videoBakeRegionSelection ? 'video-bake-region-selected' : '',
    clip.videoState?.bakeRegions?.length ? 'has-video-bake-regions' : '',
    clip.isLoading ? 'loading' : '',
    clip.needsReload ? 'needs-reload' : '',
    hasProxy ? 'has-proxy' : '',
    isGeneratingProxy ? 'generating-proxy' : '',
    hasProxyError ? 'proxy-error' : '',
    hasAudioProxy ? 'has-audio-proxy' : '',
    isGeneratingAudioProxy ? 'generating-audio-proxy' : '',
    hasAudioProxyError ? 'audio-proxy-error' : '',
    showActiveStemSeparation ? 'separating-stems' : '',
    hasKeyframes(clip.id) ? 'has-keyframes' : '',
    clip.reversed ? 'reversed' : '',
    clip.transcriptStatus === 'ready' ? 'has-transcript' : '',
    showWaveformGenerationIndicator ? 'generating-waveform' : '',
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
    if (!canHandleTimelineToolPointer) return;

    const result = dispatchTimelineClipPointerMove(getClipPointerContext(e));
    if (!result.handled) {
      if (timelineToolPreview?.clipId === clip.id) setTimelineToolPreview(null);
      return;
    }
    setTimelineToolPreview(result.preview ?? null);
  };

  const handleMouseLeave = () => {
    if (!canHandleTimelineToolPointer) return;

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
  const spectralRegionOverlay = useMemo(() => resolveSpectralRegionOverlay({
    selection: audioSpectralRegionSelection,
    displayStartTime,
    displayDuration,
    width,
    trackBaseHeight,
    maxFrequencyHz: spectralMaxFrequencyHz,
  }), [
    audioSpectralRegionSelection,
    displayDuration,
    displayStartTime,
    spectralMaxFrequencyHz,
    trackBaseHeight,
    width,
  ]);
  const sourceTimeToDisplayTimelineTime = useCallback((sourceTime: number): number => {
    const sourceStart = Math.max(0, displayInPoint ?? 0);
    const sourceEnd = Math.max(sourceStart + 0.001, displayOutPoint ?? sourceStart + displayDuration);
    const sourceRatio = Math.max(0, Math.min(1, (sourceTime - sourceStart) / (sourceEnd - sourceStart)));
    const timelineRatio = clip.reversed ? 1 - sourceRatio : sourceRatio;
    return displayStartTime + timelineRatio * displayDuration;
  }, [clip.reversed, displayDuration, displayInPoint, displayOutPoint, displayStartTime]);
  const spectralLayers = clip.audioState?.spectralLayers ?? EMPTY_SPECTRAL_LAYERS;
  const spectralImageLayerOverlays = useMemo(() => resolveSpectralImageLayerOverlays({
    enabled: canSelectSpectralRegion || audioDisplayMode === 'spectral',
    layers: spectralLayers,
    displayStartTime,
    displayDuration,
    width,
    trackBaseHeight,
    maxFrequencyHz: spectralMaxFrequencyHz,
    sourceTimeToDisplayTimelineTime,
    mediaFilesById: spectralImageFilesById,
  }), [
    audioDisplayMode,
    canSelectSpectralRegion,
    displayDuration,
    displayStartTime,
    sourceTimeToDisplayTimelineTime,
    spectralLayers,
    spectralImageFilesById,
    spectralMaxFrequencyHz,
    trackBaseHeight,
    width,
  ]);
  const audioEditOperationOverlays = useMemo<AudioEditOperationOverlay[]>(() => {
    if (!isAudioClip || !audioFocusMode || !showAudioRegionEditMarkers || displayAudioEditStack.length === 0) {
      return [];
    }

    return resolveAudioEditOperationOverlays({
      operations: displayAudioEditStack,
      audioRegionSelection,
      clipId: clip.id,
      trackId: clip.trackId,
      displayStartTime,
      displayDuration,
      width,
      trackBaseHeight,
      sourceTimeToDisplayTimelineTime,
    });
  }, [
    audioRegionSelection,
    clip.id,
    clip.trackId,
    displayAudioEditStack,
    audioFocusMode,
    displayDuration,
    displayStartTime,
    isAudioClip,
    showAudioRegionEditMarkers,
    sourceTimeToDisplayTimelineTime,
    trackBaseHeight,
    width,
  ]);
  const clipVideoBakeRegionOverlays = useMemo<ClipVideoBakeRegionOverlay[]>(() => (
    resolveClipVideoBakeRegionOverlays({
      isAudioClip,
      bakeRegions: clip.videoState?.bakeRegions,
      selection: videoBakeRegionSelection,
      displayStartTime,
      displayDuration,
      width,
      sourceTimeToVideoBakeTimelineTime,
    })
  ), [
    clip.videoState?.bakeRegions,
    displayDuration,
    displayStartTime,
    isAudioClip,
    sourceTimeToVideoBakeTimelineTime,
    videoBakeRegionSelection,
    width,
  ]);
  const handleBakeClipVideoRegion = useCallback((regionId: string) => {
    void bakeClipVideoBakeRegion(clip.id, regionId);
  }, [bakeClipVideoBakeRegion, clip.id]);
  const handleUnbakeClipVideoRegion = useCallback((regionId: string) => {
    unbakeClipVideoBakeRegion(clip.id, regionId);
  }, [clip.id, unbakeClipVideoBakeRegion]);
  const handleRemoveClipVideoRegion = useCallback((regionId: string) => {
    removeClipVideoBakeRegion(clip.id, regionId);
  }, [clip.id, removeClipVideoBakeRegion]);
  const handleAudioEditOperationOverlayActivate = useCallback((overlay: AudioEditOperationOverlay) => {
    closeAudioRegionContextMenu();
    setAudioRegionSelection(overlay.selection);
  }, [closeAudioRegionContextMenu, setAudioRegionSelection]);
  const handleToggleAudioEditOperation = useCallback((operationId: string, disabled: boolean) => {
    setClipAudioEditOperationEnabled(clip.id, operationId, disabled);
  }, [clip.id, setClipAudioEditOperationEnabled]);
  const handleRemoveAudioEditOperation = useCallback((operationId: string) => {
    removeClipAudioEditOperation(clip.id, operationId);
  }, [clip.id, removeClipAudioEditOperation]);
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
  const handleAudioEditStackMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);
  const handleBakeAudioEditStack = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (audioBakePending) return;
    setAudioBakePending(true);
    void bakeClipAudioEditStack(clip.id).finally(() => {
      setAudioBakePending(false);
    });
  }, [audioBakePending, bakeClipAudioEditStack, clip.id]);
  const handleUnbakeAudioEditStack = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (audioBakePending || !canUnbakeAudioEditStack) return;
    unbakeClipAudioEditStack(clip.id);
  }, [audioBakePending, canUnbakeAudioEditStack, clip.id, unbakeClipAudioEditStack]);
  const handleClearAudioEditStack = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    clearClipAudioEditStack(clip.id);
  }, [clearClipAudioEditStack, clip.id]);

  // Track filtering must stay after all hooks so React sees a stable hook order
  // while clips move between tracks during drag and linked edits.
  if (isDragging && clipDrag && clipDrag.currentTrackId !== trackId) {
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
  const sourceExtensionGhosts = useMemo(() => resolveSourceExtensionGhosts({
    enabled: passiveDecorationsEnabled,
    isTrimming,
    isLinkedToTrimming,
    trimEdge: clipTrim?.edge,
    clipWidth: width,
    clipLeft: left,
    clipStartTime: clip.startTime,
    clipDuration: clip.duration,
    displayStartTime,
    displayDuration,
    displayInPoint,
    displayOutPoint,
    sourceDuration: getTimelineClipSourceDuration(clip),
    scrollX,
    viewportWidth: renderTimelineViewportWidth,
    overscanPx: TIMELINE_RENDER_OVERSCAN_PX,
    timeToPixel,
  }), [
    clip.duration,
    clip.inPoint,
    clip.outPoint,
    clip.source?.naturalDuration,
    clip.startTime,
    clipTrim?.edge,
    displayDuration,
    displayInPoint,
    displayOutPoint,
    displayStartTime,
    isLinkedToTrimming,
    isTrimming,
    left,
    passiveDecorationsEnabled,
    renderTimelineViewportWidth,
    scrollX,
    timeToPixel,
    width,
  ]);

  return (
    <div
      className={`${clipClass}${isBladeToolActive ? ' cut-mode' : ''} ${animationClass}`}
      style={clipStyle}
      data-clip-id={clip.id}
      data-dock-layout-child-anim-id={`timeline-clip:${clip.id}`}
      onMouseDown={(e) => {
        if (e.button === 2) {
          onMouseDown(e);
          return;
        }
        if (isTrackLocked || (isPointerToolActive && !canUseBodyToolGesture)) return;
        onMouseDown(e);
      }}
      onDoubleClick={isPointerToolActive ? undefined : onDoubleClick}
      onContextMenu={onContextMenu}
      onMouseMove={canHandleTimelineToolPointer ? handleMouseMove : undefined}
      onMouseLeave={canHandleTimelineToolPointer ? handleMouseLeave : undefined}
      onClick={isTrackLocked ? undefined : handleClick}
    >
      {/* Cut indicator line */}
      {shouldShowCutIndicator && cutIndicatorX !== null && cutIndicatorX >= 0 && cutIndicatorX <= width && (
        <div
          className="cut-indicator"
          style={{ left: cutIndicatorX }}
        />
      )}
      <ClipPassiveBackgroundLayer
        sourceExtensionGhosts={sourceExtensionGhosts}
        passiveDecorationsEnabled={passiveDecorationsEnabled}
        passiveMediaEnabled={passiveMediaEnabled}
        waveformsEnabled={waveformsEnabled}
        clip={clip}
        proxyEnabled={proxyEnabled}
        isGeneratingProxy={isGeneratingProxy}
        proxyProgress={proxyProgress}
        hasProxy={hasProxy}
        hasProxyError={hasProxyError}
        isGeneratingAudioProxy={isGeneratingAudioProxy}
        audioProxyProgress={audioProxyProgress}
        hasAudioProxy={hasAudioProxy}
        hasAudioProxyError={hasAudioProxyError}
        showActiveStemSeparation={showActiveStemSeparation}
        activeStemStatusTitle={activeStemStatusTitle}
        activeStemProgressPercent={activeStemProgressPercent}
        isDownloadingStemModel={isDownloadingStemModel}
        isInLinkedGroup={isInLinkedGroup}
        stemSwitcher={stemSwitcherNode}
        mediaFiles={mediaFiles}
        isAudioClip={isAudioClip}
        showWaveformGenerationIndicator={showWaveformGenerationIndicator}
        audioDisplayMode={audioDisplayMode}
        hasWaveformForRender={hasWaveformForRender}
        audioSpectrogramProps={audioSpectrogramProps}
        audioWaveformProps={audioWaveformProps}
        audioAnalysisDisplayStatus={audioAnalysisDisplayStatus}
        audioWaveformDiagnostics={audioWaveformDiagnostics}
      />
      {audioRegionOverlay && (
        <ClipAudioRegionSelectionOverlay
          overlay={audioRegionOverlay}
          snappedToZeroCrossing={Boolean(audioRegionSelection?.snappedToZeroCrossing)}
          moving={Boolean(audioRegionMoveDrag)}
          resizing={Boolean(audioRegionResizeDrag)}
          gainControl={audioRegionGainControl}
          onSelectionMouseDown={handleAudioRegionSelectionMouseDown}
          onContextMenu={handleAudioRegionContextMenu}
          onEdgeMouseDown={handleAudioRegionEdgeMouseDown}
          onGainMouseDown={handleAudioRegionGainMouseDown}
          onResetGain={handleResetAudioRegionGain}
        />
      )}
      <ClipVideoBakeRegionOverlays
        overlays={clipVideoBakeRegionOverlays}
        onBakeRegion={handleBakeClipVideoRegion}
        onUnbakeRegion={handleUnbakeClipVideoRegion}
        onRemoveRegion={handleRemoveClipVideoRegion}
      />
      <ClipAudioEditOperationOverlays
        overlays={audioEditOperationOverlays}
        onActivateOverlay={handleAudioEditOperationOverlayActivate}
      />
      {audioRegionContextMenu && (
        <ClipAudioRegionContextMenu
          menuRef={audioRegionContextMenuRef}
          position={audioRegionContextMenuRenderPosition ?? audioRegionContextMenu}
          model={audioRegionContextMenuModel}
          selection={audioRegionContextMenu.selection}
          onRunCommand={runAudioRegionContextMenuCommand}
        />
      )}
      <ClipSpectralRegionOverlays
        regionOverlay={spectralRegionOverlay}
        selectionMode={audioSpectralRegionSelection?.selectionMode}
        imageLayerOverlays={spectralImageLayerOverlays}
        canSelectSpectralRegion={canSelectSpectralRegion}
        selectedSpectralImageFile={selectedSpectralImageFile}
        onToolbarMouseDown={handleAudioEditStackMouseDown}
        onApplySpectralRegionEdit={handleApplySpectralRegionEdit}
        onAddSelectedImageSpectralLayer={handleAddSelectedImageSpectralLayer}
      />
      {isAudioClip && audioFocusMode && (audioEditStack.length > 0 || canUnbakeAudioEditStack) && (
        <ClipAudioEditStackControls
          operations={audioEditStack}
          activeCount={activeAudioEditCount}
          audioBakePending={audioBakePending}
          canUnbakeAudioEditStack={canUnbakeAudioEditStack}
          onMouseDown={handleAudioEditStackMouseDown}
          onToggleOperation={handleToggleAudioEditOperation}
          onRemoveOperation={handleRemoveAudioEditOperation}
          onBake={handleBakeAudioEditStack}
          onUnbake={handleUnbakeAudioEditStack}
          onClear={handleClearAudioEditStack}
        />
      )}
      <ClipSelectionHitareas
        canSelectAudioRegion={canSelectAudioRegion}
        canSelectVideoBakeRegion={canSelectVideoBakeRegion}
        canSelectSpectralRegion={canSelectSpectralRegion}
        onAudioRegionMouseDown={handleAudioRegionMouseDown}
        onAudioRegionDoubleClick={handleAudioRegionDoubleClick}
        onVideoBakeRegionMouseDown={handleVideoBakeRegionMouseDown}
        onVideoBakeRegionDoubleClick={handleVideoBakeRegionDoubleClick}
        onSpectralRegionMouseDown={handleSpectralRegionMouseDown}
        onSpectralRegionDragOver={handleSpectralImageLayerDragOver}
        onSpectralRegionDrop={handleSpectralImageLayerDrop}
        onSpectralRegionDoubleClick={handleSpectralRegionDoubleClick}
      />
      <ClipPassiveForegroundLayer
        passiveDecorationsEnabled={passiveDecorationsEnabled}
        clip={clip}
        waveformsEnabled={waveformsEnabled}
        width={width}
        trackBaseHeight={trackBaseHeight}
        displayInPoint={displayInPoint}
        displayOutPoint={displayOutPoint}
        audioDisplayMode={audioDisplayMode}
        pixelsPerSecond={zoom}
        waveformRenderStartPx={waveformRenderWindow.startPx}
        waveformRenderWidth={waveformRenderWindow.width}
        staticClipIconKind={staticClipIconKind}
        showSegmentThumbnails={showSegmentThumbnails}
        showRegularThumbnails={showRegularThumbnails}
        useSourceCache={useSourceCache}
        thumbnailRenderWindow={thumbnailRenderWindow}
        segmentThumbnailPlans={segmentThumbnailPlans}
        cachedThumbnails={cachedThumbnails}
        legacyThumbnailPlans={legacyThumbnailPlans}
        clipMetaOffset={clipMetaOffset}
        displayDuration={displayDuration}
        formatTime={formatTime}
        isSolidClip={isSolidClip}
        isTextClip={isTextClip}
        isText3DClip={isText3DClip}
        isMathSceneClip={isMathSceneClip}
        isVectorAnimationClip={isVectorAnimationClip}
        vectorAnimationIcon={vectorAnimationIcon}
        vectorAnimationTitle={vectorAnimationTitle}
        isSplatEffectorClip={isSplatEffectorClip}
        text3DProperties={text3DProperties}
        showTranscriptMarkers={showTranscriptMarkers}
        displayStartTime={displayStartTime}
        isAudioClip={isAudioClip}
      />
      <ClipKeyframeTicks
        groups={keyframeTickGroups}
        displayDuration={displayDuration}
        draggingKeyframeIds={keyframeGroupDrag?.keyframeIds}
        isTrackLocked={isTrackLocked}
        formatTime={formatTime}
        onTickMouseDown={handleKeyframeTickMouseDown}
      />
      <ClipFadeTrimControls
        fadeCurveKey={visibleFadeCurveKey}
        fadeCurveKeyframes={visibleFadeCurveKeyframes}
        displayDuration={displayDuration}
        width={width}
        trackBaseHeight={trackBaseHeight}
        isAudioClip={isAudioClip}
        isTrackLocked={isTrackLocked}
        canUseFadeHandles={canUseFadeHandles}
        canUseTrimHandles={canUseTrimHandles}
        fadeInDuration={fadeInDuration}
        fadeOutDuration={fadeOutDuration}
        timeToPixel={timeToPixel}
        leftTrimHandleDirections={leftTrimHandleDirections}
        rightTrimHandleDirections={rightTrimHandleDirections}
        onFadeStart={onFadeStart}
        onTrimStart={onTrimStart}
      />
    </div>
  );
}

export const TimelineClip = memo(TimelineClipComponent);
