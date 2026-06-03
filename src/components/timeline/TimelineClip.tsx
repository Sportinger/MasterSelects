// TimelineClip component - Clip rendering within tracks

import './TimelineClip.css';
import { memo, type CSSProperties, useRef, useState, useEffect, useCallback, useMemo } from 'react';
import type { TimelineClipProps } from './types';
import { useTimelineStore } from '../../stores/timeline';
import { useMediaStore } from '../../stores/mediaStore';
import { getTimelineTrackColor, TIMELINE_TRACK_COLOR_HIDDEN } from './trackColor';
import {
  isVectorAnimationSourceType,
  shouldLoopVectorAnimation,
} from '../../types/vectorAnimation';
import { ClipAudioMediaView } from './components/ClipAudioMediaView';
import { ClipAudioEditStackControls } from './components/ClipAudioEditStackControls';
import { ClipAudioRegionSelectionOverlay } from './components/ClipAudioRegionSelectionOverlay';
import { ClipSpectralRegionOverlays } from './components/ClipSpectralRegionOverlays';
import { ClipThumbnailFilmstrip } from './components/ClipThumbnailFilmstrip';
import { ClipAudioRegionContextMenu } from './components/ClipAudioRegionContextMenu';
import { ClipVideoBakeRegionOverlays } from './components/ClipVideoBakeRegionOverlays';
import { ClipAudioEditOperationOverlays } from './components/ClipAudioEditOperationOverlays';
import { ClipContentMeta } from './components/ClipContentMeta';
import { ClipCoverageBadges } from './components/ClipCoverageBadges';
import { ClipStemSwitcher } from './components/ClipStemSwitcher';
import { ClipPassiveStatusBadges } from './components/ClipPassiveStatusBadges';
import { ClipTranscriptAnalysisOverlays } from './components/ClipTranscriptAnalysisOverlays';
import { ClipKeyframeTicks } from './components/ClipKeyframeTicks';
import { ClipFadeTrimControls } from './components/ClipFadeTrimControls';
import { ClipSelectionHitareas } from './components/ClipSelectionHitareas';
import { ClipPreThumbnailDecorations } from './components/ClipPreThumbnailDecorations';
import { ClipPostThumbnailDecorations } from './components/ClipPostThumbnailDecorations';
import {
  ACTIVE_STEM_JOB_PHASES,
  EMPTY_STEM_CHOICES,
  formatStemJobPhase,
} from './components/ClipStemDisplay';
import { useContextMenuPosition } from '../../hooks/useContextMenuPosition';
import { Logger } from '../../services/logger';
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
  moveTimelineAudioRegionSelection,
  resizeTimelineAudioRegionSelection,
  resolveTimelineAudioRegionSelection,
} from './utils/audioEditSelection';
import {
  AUDIO_REGION_TIMELINE_EPSILON,
  audioRegionGainDbFromClientY,
  isAudioRegionModifierPressed,
  isVideoBakeRegionModifierPressed,
  resolveAudioRegionTimelineRangeForClip,
} from './utils/audioRegionDisplay';
import {
  createAudioRegionContextMenuModel,
  type AudioRegionContextMenuCommand,
} from './utils/audioRegionContextMenu';
import {
  resolveAudioEditOperationOverlays,
  resolveAudioRegionGainControl,
  resolveAudioRegionOverlay,
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
import { resolveSourceExtensionGhosts } from './utils/sourceExtensionGhosts';
import {
  frequencyHzFromSpectralY,
  getSpectralMaxFrequencyHz,
  resolveTimelineSpectralBrushSelection,
  resolveTimelineSpectralRegionSelection,
} from './utils/spectralSelection';
import {
  resolveSpectralImageLayerOverlays,
  resolveSpectralRegionOverlay,
} from './utils/spectralRegionOverlays';
import type {
  TimelineAudioRegionSelection,
  TimelineSpectralRegionEditType,
  TimelineVideoBakeRegionSelection,
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

const KEYFRAME_TICK_SNAP_THRESHOLD_PX = 10;
const TIMELINE_VIEWPORT_FALLBACK_PX = 1600;
const TIMELINE_VIEWPORT_MIN_PX = 1600;
const TIMELINE_RENDER_OVERSCAN_PX = 512;
const CLIP_RIGHT_STICKY_PADDING_PX = 8;
const WAVEFORM_PYRAMID_AUTO_UPGRADE_ZOOM = 250;
const WAVEFORM_PYRAMID_AUTO_UPGRADE_WIDTH = 16_384;
const VIDEO_BAKE_REGION_TIMELINE_EPSILON = 0.001;
const log = Logger.create('TimelineClip');

const EMPTY_CLIP_KEYFRAMES = [] as const;
const EMPTY_AUDIO_EDIT_STACK = [] as const;

function canLoopExtendVectorClip(clip: TimelineClipProps['clip']): boolean {
  return isVectorAnimationSourceType(clip.source?.type) &&
    shouldLoopVectorAnimation(clip.source.vectorAnimationSettings);
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
type VideoBakeRegionDragState = {
  anchorTimelineTime: number;
  startClientX: number;
  rectLeft: number;
  rectWidth: number;
};
type AudioRegionMoveDragState = {
  startClientX: number;
  clipWidth: number;
  clipDuration: number;
  initialSelection: TimelineAudioRegionSelection;
  operationIds: string[];
};
type AudioRegionResizeDragState = {
  edge: 'left' | 'right';
  rectLeft: number;
  rectWidth: number;
  initialSelection: TimelineAudioRegionSelection;
  operationIds: string[];
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
type AudioRegionGainDragState = {
  mode: 'gain' | 'fade-in' | 'fade-out';
  regionLeft: number;
  regionWidth: number;
  regionTop: number;
  regionHeight: number;
  regionDuration: number;
  startGainDb: number;
  startFadeInSeconds: number;
  startFadeOutSeconds: number;
  currentGainDb: number;
  currentFadeInSeconds: number;
  currentFadeOutSeconds: number;
};
type AudioRegionContextMenuState = {
  x: number;
  y: number;
  selection: TimelineAudioRegionSelection;
};

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
  allKeyframeTimes,
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
  const spectrogramVariant = processedSpectrogramTileSet ? 'processed' : 'source';
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
  const waveformVariant = waveformUsesProcessedPyramid
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

  // Animation phase for enter/exit transitions
  const clipAnimationPhase = useTimelineStore(s => s.clipAnimationPhase);
  const compositionSwitchDirection = useTimelineStore(s => s.compositionSwitchDirection);
  const clipEntranceKey = useTimelineStore(s => s.clipEntranceAnimationKey);
  const aiMove = useTimelineStore(s => s.aiMovingClips.get(clip.id));
  const [mountEntranceKey] = useState(clipEntranceKey);
  const [stemMenuOpen, setStemMenuOpen] = useState(false);
  const stemMenuCloseTimerRef = useRef<number | null>(null);

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
  const activeStemSeparationJob = clipStemSeparationJob && ACTIVE_STEM_JOB_PHASES.has(clipStemSeparationJob.phase)
    ? clipStemSeparationJob
    : null;
  const activeStemProgressPercent = activeStemSeparationJob
    ? Math.round(Math.max(0, Math.min(1, activeStemSeparationJob.progress)) * 100)
    : 0;
  const activeStemStatusLabel = activeStemSeparationJob
    ? activeStemSeparationJob.message ?? formatStemJobPhase(activeStemSeparationJob.phase)
    : '';
  const activeStemStatusTitle = activeStemSeparationJob
    ? `${activeStemStatusLabel}: ${activeStemProgressPercent}%`
    : undefined;
  const isDownloadingStemModel = activeStemSeparationJob?.phase === 'downloading-model';
  const completedStemChoices = !activeStemSeparationJob && clipStemSeparationJob?.phase === 'complete'
    ? clipStemSeparationJob.stems ?? EMPTY_STEM_CHOICES
    : EMPTY_STEM_CHOICES;
  const hasCompletedStemChoices = completedStemChoices.length > 0;
  let stemSourceMediaFileId = clipStemSeparationJob?.sourceMediaFileId ?? null;
  if (!stemSourceMediaFileId) {
    for (const stem of completedStemChoices) {
      const sourceMediaFileId = mediaFiles.find(file => file.id === stem.mediaFileId)?.stemInfo?.sourceMediaFileId;
      if (sourceMediaFileId) {
        stemSourceMediaFileId = sourceMediaFileId;
        break;
      }
    }
  }
  const hasStemSourceChoice = Boolean(
    stemSourceMediaFileId &&
    mediaFiles.some(file => file.id === stemSourceMediaFileId && file.type === 'audio')
  );
  const stemSourceClip = clipStemSeparationJob
    ? clips.find(candidate => candidate.id === clipStemSeparationJob.clipId)
    : clip;
  const activeStemMediaFileId = stemSourceClip?.source?.mediaFileId ?? stemSourceClip?.mediaFileId;

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
  } else if (clipTrim && (isTrimFollower || (isLinkedToTrimming && trimmedClip))) {
    // Resize this clip live too: a linked clip, or a selected clip following a
    // multi-trim. Each clamps the shared (snapped) delta to its own bounds.
    const deltaTime = clipTrim.appliedDelta;
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

  const keyframeTickGroups: ClipKeyframeTickGroup[] = useMemo(() => (
    keyframeTimeGroups ?? allKeyframeTimes.map(time => ({
      time,
      keyframeIds: [],
    }))
  ), [allKeyframeTimes, keyframeTimeGroups]);
  const [keyframeGroupDrag, setKeyframeGroupDrag] = useState<KeyframeGroupDragState | null>(null);
  const [audioRegionDrag, setAudioRegionDrag] = useState<AudioRegionDragState | null>(null);
  const [videoBakeRegionDrag, setVideoBakeRegionDrag] = useState<VideoBakeRegionDragState | null>(null);
  const [audioRegionMoveDrag, setAudioRegionMoveDrag] = useState<AudioRegionMoveDragState | null>(null);
  const [audioRegionResizeDrag, setAudioRegionResizeDrag] = useState<AudioRegionResizeDragState | null>(null);
  const [spectralRegionDrag, setSpectralRegionDrag] = useState<SpectralRegionDragState | null>(null);
  const [audioRegionGainDrag, setAudioRegionGainDrag] = useState<AudioRegionGainDragState | null>(null);
  const [audioRegionContextMenu, setAudioRegionContextMenu] = useState<AudioRegionContextMenuState | null>(null);
  const audioRegionCommandHandledRef = useRef(false);
  const { menuRef: audioRegionContextMenuRef, adjustedPosition: audioRegionContextMenuPosition } =
    useContextMenuPosition(audioRegionContextMenu);
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
  const waveformVariantForRender = preferSourceWaveformForAudioRegionDrag
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
  const waveformLegacyForRender = clip.waveform ?? [];
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

  const handleKeyframeTickMouseDown = useCallback((
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
  }, [displayDuration, onMoveKeyframeGroup, width]);

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
  const canSelectVideoBakeRegion = trackFocusMode === 'video' &&
    !isAudioClip &&
    activeTimelineToolId === 'select' &&
    track.locked !== true;

  const timelineTimeFromAudioRegionClientX = useCallback((
    clientX: number,
    drag: Pick<AudioRegionDragState, 'rectLeft' | 'rectWidth'>,
  ): number => {
    const x = Math.max(0, Math.min(drag.rectWidth, clientX - drag.rectLeft));
    return displayStartTime + (x / Math.max(1, drag.rectWidth)) * Math.max(0.001, displayDuration);
  }, [displayDuration, displayStartTime]);

  const timelineTimeFromVideoBakeClientX = useCallback((
    clientX: number,
    drag: Pick<VideoBakeRegionDragState, 'rectLeft' | 'rectWidth'>,
  ): number => {
    const x = Math.max(0, Math.min(drag.rectWidth, clientX - drag.rectLeft));
    return displayStartTime + (x / Math.max(1, drag.rectWidth)) * Math.max(VIDEO_BAKE_REGION_TIMELINE_EPSILON, displayDuration);
  }, [displayDuration, displayStartTime]);

  const sourceTimeFromVideoBakeTimelineTime = useCallback((timelineTime: number): number => {
    const clipDuration = Math.max(VIDEO_BAKE_REGION_TIMELINE_EPSILON, displayDuration);
    const sourceStart = Math.max(0, displayInPoint ?? 0);
    const sourceEnd = Math.max(sourceStart + VIDEO_BAKE_REGION_TIMELINE_EPSILON, displayOutPoint ?? sourceStart + clipDuration);
    const timelineRatio = Math.max(0, Math.min(1, (timelineTime - displayStartTime) / clipDuration));
    const sourceRatio = clip.reversed ? 1 - timelineRatio : timelineRatio;
    return sourceStart + sourceRatio * (sourceEnd - sourceStart);
  }, [clip.reversed, displayDuration, displayInPoint, displayOutPoint, displayStartTime]);

  const sourceTimeToVideoBakeTimelineTime = useCallback((sourceTime: number): number => {
    const clipDuration = Math.max(VIDEO_BAKE_REGION_TIMELINE_EPSILON, displayDuration);
    const sourceStart = Math.max(0, displayInPoint ?? 0);
    const sourceEnd = Math.max(sourceStart + VIDEO_BAKE_REGION_TIMELINE_EPSILON, displayOutPoint ?? sourceStart + clipDuration);
    const sourceRatio = Math.max(0, Math.min(1, (sourceTime - sourceStart) / (sourceEnd - sourceStart)));
    const timelineRatio = clip.reversed ? 1 - sourceRatio : sourceRatio;
    return displayStartTime + timelineRatio * clipDuration;
  }, [clip.reversed, displayDuration, displayInPoint, displayOutPoint, displayStartTime]);

  const resolveVideoBakeRegionDragSelection = useCallback((
    drag: VideoBakeRegionDragState,
    clientX: number,
  ): TimelineVideoBakeRegionSelection => {
    const focusTimelineTime = timelineTimeFromVideoBakeClientX(clientX, drag);
    return {
      scope: 'clip',
      clipId: clip.id,
      trackId: track.id,
      startTime: drag.anchorTimelineTime,
      endTime: focusTimelineTime,
      sourceInPoint: sourceTimeFromVideoBakeTimelineTime(drag.anchorTimelineTime),
      sourceOutPoint: sourceTimeFromVideoBakeTimelineTime(focusTimelineTime),
    };
  }, [
    clip.id,
    sourceTimeFromVideoBakeTimelineTime,
    timelineTimeFromVideoBakeClientX,
    track.id,
  ]);

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

  const resolveAudioRegionMoveSelection = useCallback((
    drag: AudioRegionMoveDragState,
    clientX: number,
  ) => {
    const deltaX = clientX - drag.startClientX;
    const deltaTimelineSeconds = (deltaX / Math.max(1, drag.clipWidth)) * Math.max(0.001, drag.clipDuration);
    return moveTimelineAudioRegionSelection({
      clip: {
        ...clip,
        startTime: displayStartTime,
        duration: displayDuration,
        inPoint: displayInPoint,
        outPoint: displayOutPoint,
        waveform: clip.waveform,
      },
      selection: drag.initialSelection,
      deltaTimelineSeconds,
    });
  }, [
    clip,
    displayDuration,
    displayInPoint,
    displayOutPoint,
    displayStartTime,
  ]);

  const resolveAudioRegionResizeSelection = useCallback((
    drag: AudioRegionResizeDragState,
    clientX: number,
  ) => resizeTimelineAudioRegionSelection({
    clip: {
      ...clip,
      startTime: displayStartTime,
      duration: displayDuration,
      inPoint: displayInPoint,
      outPoint: displayOutPoint,
      waveform: clip.waveform,
    },
    selection: drag.initialSelection,
    edge: drag.edge,
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
    if (!canSelectAudioRegion || e.button !== 0 || !isAudioRegionModifierPressed(e)) return;
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
  const handleAudioRegionDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canSelectAudioRegion || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setAudioRegionContextMenu(null);
    setAudioRegionSelection(resolveTimelineAudioRegionSelection({
      clip: {
        ...clip,
        startTime: displayStartTime,
        duration: displayDuration,
        inPoint: displayInPoint,
        outPoint: displayOutPoint,
        waveform: clip.waveform,
      },
      anchorTimelineTime: displayStartTime,
      focusTimelineTime: displayStartTime + Math.max(0.001, displayDuration),
      snapThresholdSeconds: 0,
    }));
  };

  const handleVideoBakeRegionMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canSelectVideoBakeRegion || e.button !== 0 || !isVideoBakeRegionModifierPressed(e)) return;
    e.preventDefault();
    e.stopPropagation();

    const rect = e.currentTarget.getBoundingClientRect();
    const drag: VideoBakeRegionDragState = {
      anchorTimelineTime: timelineTimeFromVideoBakeClientX(e.clientX, {
        rectLeft: rect.left,
        rectWidth: rect.width,
      }),
      startClientX: e.clientX,
      rectLeft: rect.left,
      rectWidth: rect.width,
    };

    setVideoBakeRegionDrag(drag);
    setVideoBakeRegionSelection(resolveVideoBakeRegionDragSelection(drag, e.clientX));
  };

  const handleVideoBakeRegionDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canSelectVideoBakeRegion || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    addClipVideoBakeRegion(clip.id, {
      trackId: track.id,
      startTime: displayStartTime,
      endTime: displayStartTime + Math.max(VIDEO_BAKE_REGION_TIMELINE_EPSILON, displayDuration),
      sourceInPoint: displayInPoint,
      sourceOutPoint: displayOutPoint,
    });
  };

  const handleAudioRegionSelectionMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canSelectAudioRegion || !audioRegionSelection || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setAudioRegionContextMenu(null);
    setAudioRegionMoveDrag({
      startClientX: e.clientX,
      clipWidth: Math.max(1, width),
      clipDuration: Math.max(0.001, displayDuration),
      initialSelection: audioRegionSelection,
      operationIds: getMatchingAudioRegionOperationIds(audioRegionSelection),
    });
  };

  const handleAudioRegionEdgeMouseDown = useCallback((
    edge: AudioRegionResizeDragState['edge'],
  ) => (e: React.MouseEvent<HTMLSpanElement>) => {
    if (!canSelectAudioRegion || !audioRegionSelection || e.button !== 0) return;
    const clipElement = e.currentTarget.closest('.timeline-clip');
    if (!clipElement) return;

    e.preventDefault();
    e.stopPropagation();
    setAudioRegionContextMenu(null);
    const rect = clipElement.getBoundingClientRect();
    setAudioRegionResizeDrag({
      edge,
      rectLeft: rect.left,
      rectWidth: Math.max(1, rect.width),
      initialSelection: audioRegionSelection,
      operationIds: getMatchingAudioRegionOperationIds(audioRegionSelection),
    });
  }, [
    audioRegionSelection,
    canSelectAudioRegion,
    getMatchingAudioRegionOperationIds,
    setAudioRegionContextMenu,
  ]);

  const handleSpectralRegionMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canSelectSpectralRegion || e.button !== 0 || !isAudioRegionModifierPressed(e)) return;
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
      if (!isAudioRegionModifierPressed(e)) {
        setAudioRegionDrag(null);
        return;
      }
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
    if (!videoBakeRegionDrag || !canSelectVideoBakeRegion) return;

    const handleDocumentMouseMove = (e: MouseEvent) => {
      if (!isVideoBakeRegionModifierPressed(e)) {
        setVideoBakeRegionDrag(null);
        clearVideoBakeRegionSelection();
        return;
      }
      e.preventDefault();
      setVideoBakeRegionSelection(resolveVideoBakeRegionDragSelection(videoBakeRegionDrag, e.clientX));
    };

    const handleDocumentMouseUp = (e: MouseEvent) => {
      const draggedFarEnough = Math.abs(e.clientX - videoBakeRegionDrag.startClientX) >= 3;
      if (draggedFarEnough) {
        const selection = resolveVideoBakeRegionDragSelection(videoBakeRegionDrag, e.clientX);
        addClipVideoBakeRegion(clip.id, selection);
      } else {
        clearVideoBakeRegionSelection();
      }
      setVideoBakeRegionDrag(null);
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [
    addClipVideoBakeRegion,
    canSelectVideoBakeRegion,
    clearVideoBakeRegionSelection,
    clip.id,
    resolveVideoBakeRegionDragSelection,
    setVideoBakeRegionSelection,
    videoBakeRegionDrag,
  ]);

  useEffect(() => {
    if (!audioRegionMoveDrag || !canSelectAudioRegion) return;

    const handleDocumentMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      setAudioRegionSelection(resolveAudioRegionMoveSelection(audioRegionMoveDrag, e.clientX));
    };

    const handleDocumentMouseUp = (e: MouseEvent) => {
      const nextSelection = resolveAudioRegionMoveSelection(audioRegionMoveDrag, e.clientX);
      setAudioRegionSelection(nextSelection);
      commitAudioRegionOperationRange(
        audioRegionMoveDrag.operationIds,
        nextSelection,
        'Move audio region edit',
      );
      setAudioRegionMoveDrag(null);
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [
    audioRegionMoveDrag,
    canSelectAudioRegion,
    commitAudioRegionOperationRange,
    resolveAudioRegionMoveSelection,
    setAudioRegionSelection,
  ]);

  useEffect(() => {
    if (!audioRegionResizeDrag || !canSelectAudioRegion) return;

    const handleDocumentMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      setAudioRegionSelection(resolveAudioRegionResizeSelection(audioRegionResizeDrag, e.clientX));
    };

    const handleDocumentMouseUp = (e: MouseEvent) => {
      const nextSelection = resolveAudioRegionResizeSelection(audioRegionResizeDrag, e.clientX);
      setAudioRegionSelection(nextSelection);
      commitAudioRegionOperationRange(
        audioRegionResizeDrag.operationIds,
        nextSelection,
        'Resize audio region edit',
      );
      setAudioRegionResizeDrag(null);
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [
    audioRegionResizeDrag,
    canSelectAudioRegion,
    commitAudioRegionOperationRange,
    resolveAudioRegionResizeSelection,
    setAudioRegionSelection,
  ]);

  useEffect(() => {
    if (!audioRegionSelection) return;

    const handleDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.clip-audio-region-selection')) return;
      if (target.closest('.clip-audio-region-context-menu')) return;
      if (target.closest('.clip-audio-edit-operation-overlay')) return;

      setAudioRegionContextMenu(null);
      clearAudioRegionSelection();
    };

    document.addEventListener('mousedown', handleDocumentMouseDown, true);

    return () => {
      document.removeEventListener('mousedown', handleDocumentMouseDown, true);
    };
  }, [audioRegionSelection, clearAudioRegionSelection]);

  useEffect(() => {
    if (!spectralRegionDrag || !canSelectSpectralRegion) return;

    const handleDocumentMouseMove = (e: MouseEvent) => {
      if (!isAudioRegionModifierPressed(e)) {
        setSpectralRegionDrag(null);
        return;
      }
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
    activeStemSeparationJob ? 'separating-stems' : '',
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

  const clearStemMenuCloseTimer = useCallback(() => {
    if (stemMenuCloseTimerRef.current === null) return;
    window.clearTimeout(stemMenuCloseTimerRef.current);
    stemMenuCloseTimerRef.current = null;
  }, []);

  const prewarmCompletedStemSources = useCallback(() => {
    if (!hasCompletedStemChoices) return;
    const mediaFileIds = completedStemChoices.map(stem => stem.mediaFileId);
    if (stemSourceMediaFileId) {
      mediaFileIds.unshift(stemSourceMediaFileId);
    }
    prewarmStemSourceMediaFiles(mediaFileIds);
  }, [completedStemChoices, hasCompletedStemChoices, prewarmStemSourceMediaFiles, stemSourceMediaFileId]);

  useEffect(() => clearStemMenuCloseTimer, [clearStemMenuCloseTimer]);

  const handleStemControlMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleStemBadgeClick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    clearStemMenuCloseTimer();
    if (!hasCompletedStemChoices) return;
    setStemMenuOpen(open => {
      const nextOpen = !open;
      if (nextOpen) {
        prewarmCompletedStemSources();
      }
      return nextOpen;
    });
  }, [clearStemMenuCloseTimer, hasCompletedStemChoices, prewarmCompletedStemSources]);

  const handleStemChoiceClick = useCallback((stemMediaFileId: string) => (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setClipSourceToStem(clip.id, stemMediaFileId);
  }, [clip.id, setClipSourceToStem]);

  const handleStemSwitcherMouseEnter = useCallback(() => {
    clearStemMenuCloseTimer();
    prewarmCompletedStemSources();
  }, [clearStemMenuCloseTimer, prewarmCompletedStemSources]);

  const handleStemSwitcherMouseLeave = useCallback(() => {
    if (!stemMenuOpen) return;
    clearStemMenuCloseTimer();
    stemMenuCloseTimerRef.current = window.setTimeout(() => {
      setStemMenuOpen(false);
      stemMenuCloseTimerRef.current = null;
    }, 320);
  }, [clearStemMenuCloseTimer, stemMenuOpen]);

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
  const audioRegionOverlay = resolveAudioRegionOverlay({
    selection: audioRegionSelection,
    displayStartTime,
    displayDuration,
    width,
  });
  const selectedAudioRegionGainOperation = useMemo(() => {
    if (!audioRegionSelection) return null;
    const start = Math.min(audioRegionSelection.sourceInPoint, audioRegionSelection.sourceOutPoint);
    const end = Math.max(audioRegionSelection.sourceInPoint, audioRegionSelection.sourceOutPoint);

    for (let index = displayAudioEditStack.length - 1; index >= 0; index -= 1) {
      const operation = displayAudioEditStack[index];
      if (
        operation?.type === 'gain' &&
        operation.enabled !== false &&
        operation.timeRange &&
        Math.abs(Math.min(operation.timeRange.start, operation.timeRange.end) - start) <= 0.001 &&
        Math.abs(Math.max(operation.timeRange.start, operation.timeRange.end) - end) <= 0.001
      ) {
        return operation;
      }
    }

    return null;
  }, [displayAudioEditStack, audioRegionSelection]);
  const audioRegionGainControl = audioRegionOverlay
    ? resolveAudioRegionGainControl({
        selection: audioRegionSelection,
        overlayWidth: audioRegionOverlay.width,
        selectedOperation: selectedAudioRegionGainOperation,
        dragState: audioRegionGainDrag,
      })
    : null;
  const commitAudioRegionGainEdit = useCallback((input: {
    gainDb: number;
    fadeInSeconds: number;
    fadeOutSeconds: number;
  }) => {
    setAudioRegionGainEdit({
      gainDb: input.gainDb,
      fadeInSeconds: input.fadeInSeconds,
      fadeOutSeconds: input.fadeOutSeconds,
      keepSelection: true,
    });
  }, [setAudioRegionGainEdit]);
  const handleResetAudioRegionGain = useCallback(() => {
    commitAudioRegionGainEdit({
      gainDb: 0,
      fadeInSeconds: 0,
      fadeOutSeconds: 0,
    });
  }, [commitAudioRegionGainEdit]);
  const publishAudioRegionGainPreview = useCallback((input: {
    gainDb: number;
    fadeInSeconds: number;
    fadeOutSeconds: number;
  }) => {
    if (!audioRegionSelection) return;
    setAudioRegionGainPreview({
      clipId: clip.id,
      trackId: audioRegionSelection.trackId,
      startTime: audioRegionSelection.startTime,
      endTime: audioRegionSelection.endTime,
      sourceInPoint: audioRegionSelection.sourceInPoint,
      sourceOutPoint: audioRegionSelection.sourceOutPoint,
      gainDb: input.gainDb,
      fadeInSeconds: input.fadeInSeconds,
      fadeOutSeconds: input.fadeOutSeconds,
    });
  }, [audioRegionSelection, clip.id, setAudioRegionGainPreview]);
  const handleAudioRegionGainMouseDown = useCallback((
    mode: AudioRegionGainDragState['mode'],
  ) => (e: React.MouseEvent<HTMLButtonElement | HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (!audioRegionGainControl) return;
    const regionElement = e.currentTarget.closest('.clip-audio-region-selection');
    if (!regionElement) return;

    e.preventDefault();
    e.stopPropagation();
    const rect = regionElement.getBoundingClientRect();
    const startGainDb = mode === 'gain'
      ? Number(audioRegionGainDbFromClientY(e.clientY, rect).toFixed(1))
      : audioRegionGainControl.gainDb;
    publishAudioRegionGainPreview({
      gainDb: startGainDb,
      fadeInSeconds: audioRegionGainControl.fadeInSeconds,
      fadeOutSeconds: audioRegionGainControl.fadeOutSeconds,
    });

    setAudioRegionGainDrag({
      mode,
      regionLeft: rect.left,
      regionWidth: rect.width,
      regionTop: rect.top,
      regionHeight: rect.height,
      regionDuration: audioRegionGainControl.regionDuration,
      startGainDb,
      startFadeInSeconds: audioRegionGainControl.fadeInSeconds,
      startFadeOutSeconds: audioRegionGainControl.fadeOutSeconds,
      currentGainDb: startGainDb,
      currentFadeInSeconds: audioRegionGainControl.fadeInSeconds,
      currentFadeOutSeconds: audioRegionGainControl.fadeOutSeconds,
    });
  }, [audioRegionGainControl, publishAudioRegionGainPreview]);
  const handleAudioRegionContextMenu = useCallback((e: React.MouseEvent) => {
    if (!audioRegionSelection) return;
    e.preventDefault();
    e.stopPropagation();
    const expectedExpandedHeight = 340;
    const y = typeof window === 'undefined'
      ? e.clientY
      : Math.min(
          e.clientY,
          Math.max(8, window.innerHeight - expectedExpandedHeight - 8),
        );
    audioRegionCommandHandledRef.current = false;
    setAudioRegionContextMenu({ x: e.clientX, y, selection: audioRegionSelection });
  }, [audioRegionSelection, setAudioRegionContextMenu]);
  const closeAudioRegionContextMenu = useCallback(() => {
    setAudioRegionContextMenu(null);
  }, [setAudioRegionContextMenu]);
  useEffect(() => {
    if (!audioRegionGainDrag) return;

    const getNextDragState = (e: MouseEvent): AudioRegionGainDragState => {
      if (audioRegionGainDrag.mode === 'gain') {
        return {
          ...audioRegionGainDrag,
          currentGainDb: Number(audioRegionGainDbFromClientY(e.clientY, {
            top: audioRegionGainDrag.regionTop,
            height: audioRegionGainDrag.regionHeight,
          }).toFixed(1)),
        };
      }

      const localX = Math.max(0, Math.min(audioRegionGainDrag.regionWidth, e.clientX - audioRegionGainDrag.regionLeft));
      const secondsAtPointer = (localX / Math.max(1, audioRegionGainDrag.regionWidth)) * audioRegionGainDrag.regionDuration;
      const maxFadeSeconds = audioRegionGainDrag.regionDuration / 2;

      return {
        ...audioRegionGainDrag,
        currentFadeInSeconds: audioRegionGainDrag.mode === 'fade-in'
          ? Number(Math.max(0, Math.min(maxFadeSeconds, secondsAtPointer)).toFixed(4))
          : audioRegionGainDrag.currentFadeInSeconds,
        currentFadeOutSeconds: audioRegionGainDrag.mode === 'fade-out'
          ? Number(Math.max(0, Math.min(maxFadeSeconds, audioRegionGainDrag.regionDuration - secondsAtPointer)).toFixed(4))
          : audioRegionGainDrag.currentFadeOutSeconds,
      };
    };

    const handleDocumentMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      const next = getNextDragState(e);
      publishAudioRegionGainPreview({
        gainDb: next.currentGainDb,
        fadeInSeconds: next.currentFadeInSeconds,
        fadeOutSeconds: next.currentFadeOutSeconds,
      });
      setAudioRegionGainDrag(next);
    };

    const handleDocumentMouseUp = (e: MouseEvent) => {
      const next = getNextDragState(e);
      commitAudioRegionGainEdit({
        gainDb: next.currentGainDb,
        fadeInSeconds: next.currentFadeInSeconds,
        fadeOutSeconds: next.currentFadeOutSeconds,
      });
      clearAudioRegionGainPreview();
      setAudioRegionGainDrag(null);
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [audioRegionGainDrag, clearAudioRegionGainPreview, commitAudioRegionGainEdit, publishAudioRegionGainPreview]);

  useEffect(() => () => {
    const preview = useTimelineStore.getState().audioRegionGainPreview;
    if (preview?.clipId === clip.id) {
      useTimelineStore.getState().clearAudioRegionGainPreview();
    }
  }, [clip.id]);

  useEffect(() => {
    if (!audioRegionContextMenu) return;

    const handlePointerDown = () => closeAudioRegionContextMenu();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeAudioRegionContextMenu();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [audioRegionContextMenu, closeAudioRegionContextMenu]);
  const spectralRegionOverlay = resolveSpectralRegionOverlay({
    selection: audioSpectralRegionSelection,
    displayStartTime,
    displayDuration,
    width,
    trackBaseHeight,
    maxFrequencyHz: spectralMaxFrequencyHz,
  });
  const sourceTimeToDisplayTimelineTime = useCallback((sourceTime: number): number => {
    const sourceStart = Math.max(0, displayInPoint ?? 0);
    const sourceEnd = Math.max(sourceStart + 0.001, displayOutPoint ?? sourceStart + displayDuration);
    const sourceRatio = Math.max(0, Math.min(1, (sourceTime - sourceStart) / (sourceEnd - sourceStart)));
    const timelineRatio = clip.reversed ? 1 - sourceRatio : sourceRatio;
    return displayStartTime + timelineRatio * displayDuration;
  }, [clip.reversed, displayDuration, displayInPoint, displayOutPoint, displayStartTime]);
  const spectralImageLayerOverlays = useMemo(() => resolveSpectralImageLayerOverlays({
    enabled: canSelectSpectralRegion || audioDisplayMode === 'spectral',
    layers: clip.audioState?.spectralLayers ?? [],
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
    clip.audioState?.spectralLayers,
    displayDuration,
    displayStartTime,
    sourceTimeToDisplayTimelineTime,
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
    setAudioRegionContextMenu(null);
    setAudioRegionSelection(overlay.selection);
  }, [setAudioRegionContextMenu, setAudioRegionSelection]);
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
  const handleSpectralRegionDoubleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!isAudioRegionModifierPressed(e)) return;
    e.preventDefault();
    e.stopPropagation();
    clearAudioSpectralRegionSelection();
  }, [clearAudioSpectralRegionSelection]);
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
  const handleUnbakeAudioEditStack = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (audioBakePending || !canUnbakeAudioEditStack) return;
    unbakeClipAudioEditStack(clip.id);
  };
  const handleClearAudioEditStack = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    clearClipAudioEditStack(clip.id);
  };
  const handleSplitAudioRegionAtSelection = (selectionSnapshot?: TimelineAudioRegionSelection | null) => {
    const store = useTimelineStore.getState();
    const selection = selectionSnapshot?.clipId === clip.id
      ? selectionSnapshot
      : store.audioRegionSelection?.clipId === clip.id
      ? store.audioRegionSelection
      : audioRegionSelection;
    const currentClip = store.clips.find(candidate => candidate.id === clip.id) ?? clip;
    if (!selection) {
      log.warn('Cannot split audio region without an active selection', { clipId: clip.id });
      return;
    }

    const range = resolveAudioRegionTimelineRangeForClip(currentClip, selection);
    if (!range) {
      log.warn('Cannot split audio region outside clip bounds', { clipId: clip.id, selection });
      return;
    }

    const clipStart = currentClip.startTime;
    const clipEnd = currentClip.startTime + Math.max(AUDIO_REGION_TIMELINE_EPSILON, currentClip.duration);
    const splitTimes = [range.start, range.end].filter(time =>
      time > clipStart + AUDIO_REGION_TIMELINE_EPSILON &&
      time < clipEnd - AUDIO_REGION_TIMELINE_EPSILON
    );
    const result = splitTimes.length > 0
      ? applyTimelineEditOperation({
        id: `split-audio-region:${clip.id}:${range.start}:${range.end}`,
        type: 'split-at-times',
        clipId: currentClip.id,
        times: splitTimes,
        includeLinked: false,
      }, {
        source: 'context-menu',
        historyLabel: 'Split audio region',
      })
      : { success: true };

    if (result.success) {
      const middleClip = useTimelineStore.getState().clips.find(candidate =>
        candidate.trackId === currentClip.trackId &&
        Math.abs(candidate.startTime - range.start) <= AUDIO_REGION_TIMELINE_EPSILON &&
        Math.abs(candidate.duration - range.duration) <= AUDIO_REGION_TIMELINE_EPSILON
      );
      if (middleClip) {
        selectClip(middleClip.id);
      }
    } else {
      log.warn('Split audio region operation failed', { clipId: currentClip.id, range, result });
    }
    clearAudioRegionSelection();
  };
  const handleCutAudioRegion = (selectionSnapshot?: TimelineAudioRegionSelection | null) => {
    const store = useTimelineStore.getState();
    const selection = selectionSnapshot?.clipId === clip.id
      ? selectionSnapshot
      : store.audioRegionSelection?.clipId === clip.id
      ? store.audioRegionSelection
      : audioRegionSelection;
    const currentClip = store.clips.find(candidate => candidate.id === clip.id) ?? clip;
    if (!selection) {
      log.warn('Cannot cut audio region without an active selection', { clipId: clip.id });
      return;
    }

    const range = resolveAudioRegionTimelineRangeForClip(currentClip, selection);
    if (!range) {
      log.warn('Cannot cut audio region outside clip bounds', { clipId: clip.id, selection });
      return;
    }

    if (store.audioRegionSelection?.clipId !== currentClip.id) {
      setAudioRegionSelection(selection);
    }
    copySelectedAudioRegion();
    const result = applyTimelineEditOperation({
      id: `cut-audio-region:${clip.id}:${range.start}:${range.end}`,
      type: 'lift-range',
      range: {
        startTime: range.start,
        endTime: range.end,
        trackIds: [currentClip.trackId],
      },
      includeLinked: false,
    }, {
      source: 'context-menu',
      historyLabel: 'Cut audio region',
    });
    if (result.success) {
      clearAudioRegionSelection();
    } else {
      log.warn('Cut audio region operation failed', { clipId: currentClip.id, range, result });
    }
  };
  const contextMenuAudioRegionSelection = audioRegionContextMenu?.selection ?? audioRegionSelection;
  const audioRegionContextMenuModel = createAudioRegionContextMenuModel({
    hasAudioRegionClipboard,
    onSplit: () => handleSplitAudioRegionAtSelection(contextMenuAudioRegionSelection),
    onCut: () => handleCutAudioRegion(contextMenuAudioRegionSelection),
    onCopy: copySelectedAudioRegion,
    onPaste: pasteAudioRegionToSelection,
    applyAudioRegionEdit,
  });
  const runAudioRegionContextMenuCommand = (
    command: AudioRegionContextMenuCommand,
    selection: TimelineAudioRegionSelection,
  ) => {
    if (audioRegionCommandHandledRef.current) return;
    if (command.disabled) return;
    audioRegionCommandHandledRef.current = true;
    log.info('Audio region context command', {
      command: command.key,
      clipId: clip.id,
      selection,
    });
    setAudioRegionSelection(selection);
    command.action();
    closeAudioRegionContextMenu();
  };

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
  const sourceExtensionGhosts = resolveSourceExtensionGhosts({
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
    sourceDuration: getClipSourceDuration(clip),
    scrollX,
    viewportWidth: renderTimelineViewportWidth,
    overscanPx: TIMELINE_RENDER_OVERSCAN_PX,
    timeToPixel,
  });

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
      {passiveDecorationsEnabled && sourceExtensionGhosts.map((ghost) => (
        <div
          key={ghost.edge}
          className={`clip-source-extension-ghost ${ghost.edge}`}
          style={{ left: ghost.left, width: ghost.width }}
        />
      ))}
      <ClipPassiveStatusBadges
        enabled={passiveDecorationsEnabled}
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
        showActiveStemSeparation={Boolean(activeStemSeparationJob)}
        activeStemStatusTitle={activeStemStatusTitle}
        activeStemProgressPercent={activeStemProgressPercent}
        isDownloadingStemModel={isDownloadingStemModel}
        isInLinkedGroup={isInLinkedGroup}
        stemSwitcher={hasCompletedStemChoices ? (
          <ClipStemSwitcher
            stemMenuOpen={stemMenuOpen}
            completedStemChoices={completedStemChoices}
            hasStemSourceChoice={hasStemSourceChoice}
            stemSourceMediaFileId={stemSourceMediaFileId}
            activeStemMediaFileId={activeStemMediaFileId}
            onMouseEnter={handleStemSwitcherMouseEnter}
            onMouseLeave={handleStemSwitcherMouseLeave}
            onControlMouseDown={handleStemControlMouseDown}
            onBadgeClick={handleStemBadgeClick}
            onChoiceClick={handleStemChoiceClick}
          />
        ) : null}
      />
      <ClipCoverageBadges
        enabled={passiveDecorationsEnabled}
        clip={clip}
        mediaFiles={mediaFiles}
        isAudioClip={isAudioClip}
      />
      {/* Waveform generation progress indicator */}
      {passiveDecorationsEnabled && showWaveformGenerationIndicator && (
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
      {passiveMediaEnabled && waveformsEnabled && isAudioClip && (
        audioDisplayMode === 'spectral'
        || hasWaveformForRender
      ) && (
        <ClipAudioMediaView
          audioDisplayMode={audioDisplayMode}
          hasWaveformForRender={hasWaveformForRender}
          spectrogramProps={{
            tileSet: spectrogramTileSet,
            width,
            height: Math.max(20, trackBaseHeight - 12),
            inPoint: spectrogramInPoint,
            outPoint: spectrogramOutPoint,
            naturalDuration: spectrogramNaturalDuration,
            renderStartPx: waveformRenderWindow.startPx,
            renderWidth: waveformRenderWindow.width,
            variant: spectrogramVariant,
          }}
          waveformProps={{
            clipId: clip.id,
            waveform: waveformLegacyForRender,
            waveformChannels: waveformChannelsForRender,
            width: stableWaveformContentWidth,
            height: Math.max(20, trackBaseHeight - 12),
            inPoint: stableWaveformContentInPoint,
            outPoint: stableWaveformContentOutPoint,
            naturalDuration: waveformNaturalDurationForRender,
            clipDuration: stableWaveformClipDuration,
            displayMode: audioDisplayMode,
            pixelsPerSecond: zoom,
            pyramid: waveformPyramidForRender,
            waveformVariant: waveformVariantForRender,
            displayGain: waveformDisplayGainForRender,
            volumeAutomationKeyframes: audioVolumeAutomationKeyframes,
            audioEditStack: predictiveAudioEditStack,
            audioRegionGainPreview: predictiveAudioRegionGainPreview,
            renderStartPx: stableWaveformRenderWindow.startPx,
            renderWidth: stableWaveformRenderWindow.width,
            contentOffsetPx: stableWaveformContentOffsetPx,
            normalizationInPoint: useStableWaveformTrimWindow ? originalWaveformTrimInPoint : undefined,
            normalizationOutPoint: useStableWaveformTrimWindow ? originalWaveformTrimOutPoint : undefined,
            normalizationWidth: useStableWaveformTrimWindow ? Math.max(1, (originalWaveformTrimOutPoint - originalWaveformTrimInPoint) / waveformSourceSecondsPerPixel) : undefined,
          }}
          audioAnalysisDisplayStatus={audioAnalysisDisplayStatus}
          audioWaveformDiagnostics={audioWaveformDiagnostics}
        />
      )}
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
          position={{
            x: audioRegionContextMenuPosition?.x ?? audioRegionContextMenu.x,
            y: audioRegionContextMenuPosition?.y ?? audioRegionContextMenu.y,
          }}
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
      <ClipPreThumbnailDecorations
        enabled={passiveDecorationsEnabled}
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
      />
      {/* Segment-based thumbnails for nested compositions */}
      {showSegmentThumbnails && (
        <ClipThumbnailFilmstrip
          mode="segments"
          renderWindow={thumbnailRenderWindow}
          segmentPlans={segmentThumbnailPlans}
        />
      )}
      {/* Regular thumbnail filmstrip - source-based cache or legacy fallback */}
      {showRegularThumbnails && useSourceCache && (
        <ClipThumbnailFilmstrip
          mode="regular"
          renderWindow={thumbnailRenderWindow}
          useSourceCache={true}
          cachedThumbnails={cachedThumbnails}
        />
      )}
      {showRegularThumbnails && !useSourceCache && (
        <ClipThumbnailFilmstrip
          mode="regular"
          renderWindow={thumbnailRenderWindow}
          useSourceCache={false}
          legacyPlans={legacyThumbnailPlans}
        />
      )}
      <ClipPostThumbnailDecorations
        enabled={passiveDecorationsEnabled}
        clip={clip}
      />
      {passiveDecorationsEnabled && (
        <ClipContentMeta
          clip={clip}
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
          staticClipIconKind={staticClipIconKind}
          text3DProperties={text3DProperties}
        />
      )}
      <ClipTranscriptAnalysisOverlays
        enabled={passiveDecorationsEnabled}
        showTranscriptMarkers={showTranscriptMarkers}
        clip={clip}
        displayDuration={displayDuration}
        displayStartTime={displayStartTime}
        width={width}
        trackBaseHeight={trackBaseHeight}
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
