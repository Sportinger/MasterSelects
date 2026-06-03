// TimelineClip component - Clip rendering within tracks

import './TimelineClip.css';
import { memo, useState, useCallback, useMemo } from 'react';
import type { TimelineClipProps } from './types';
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
  collectAudioEffectInstanceRouteSettings,
  collectLegacyAudioEffectRouteSettings,
} from '../../services/audio/audioGraphRouteSettings';
import { resolveClipMediaClassification } from './utils/clipMediaClassification';
import {
  getSpectralMaxFrequencyHz,
} from './utils/spectralSelection';
import type { TimelineAudioRegionSelection } from '../../stores/timeline/types';
import {
  getTimelineToolCursor,
  isTimelinePointerTool,
} from './tools/pointer/timelineToolPointerDispatcher';
import { getTrimHandleArrowDirections } from './utils/trimHandleDirections';
import {
  hasLegacyWaveformSamples,
} from '../../utils/audioWaveformPresence';
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
import { useClipSpectralImageLayers } from './hooks/useClipSpectralImageLayers';
import { useClipOverlayActions } from './hooks/useClipOverlayActions';
import { useClipAudioArtifactWarmups } from './hooks/useClipAudioArtifactWarmups';
import { useClipAudioRenderState } from './hooks/useClipAudioRenderState';
import { useClipAudioAnalysisDisplayState } from './hooks/useClipAudioAnalysisDisplayState';
import { useClipTimelineRenderGeometry } from './hooks/useClipTimelineRenderGeometry';
import { useClipTimelineToolPointer } from './hooks/useClipTimelineToolPointer';
import { useClipVisualChrome } from './hooks/useClipVisualChrome';
import { useClipRegionOverlayState } from './hooks/useClipRegionOverlayState';
import { useClipStoreBindings } from './hooks/useClipStoreBindings';
import { useClipAudioDisplayDerivedState } from './hooks/useClipAudioDisplayDerivedState';

const EMPTY_AUDIO_EDIT_STACK = [] as const;

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
  isTrimFollower = false,
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
}: TimelineClipProps) {
  const {
    thumbnailsEnabled,
    waveformsEnabled,
    audioDisplayMode,
    audioFocusMode,
    trackFocusMode,
    showAudioRegionEditMarkers,
    activeTimelineToolId,
    timelineToolPreview,
    isBladeToolActive,
    playheadPosition,
    clipStemSeparationJob,
    setTimelineToolPreview,
    applyTimelineEditOperation,
    setActiveTimelineTool,
    timelineTrackColorsVisible,
    audioRegionSelection,
    audioRegionGainPreview,
    audioSpectralRegionSelection,
    videoBakeRegionSelection,
    setAudioRegionSelection,
    clearAudioRegionSelection,
    setVideoBakeRegionSelection,
    clearVideoBakeRegionSelection,
    addClipVideoBakeRegion,
    bakeClipVideoBakeRegion,
    unbakeClipVideoBakeRegion,
    removeClipVideoBakeRegion,
    setAudioSpectralRegionSelection,
    clearAudioSpectralRegionSelection,
    hasAudioRegionClipboard,
    applyAudioRegionEdit,
    setAudioRegionGainPreview,
    clearAudioRegionGainPreview,
    setAudioRegionGainEdit,
    applySpectralRegionEdit,
    addClipSpectralImageLayer,
    copySelectedAudioRegion,
    pasteAudioRegionToSelection,
    setClipAudioEditOperationEnabled,
    setClipAudioEditOperationRange,
    removeClipAudioEditOperation,
    clearClipAudioEditStack,
    bakeClipAudioEditStack,
    unbakeClipAudioEditStack,
    setClipSourceToStem,
    prewarmStemSourceMediaFiles,
    mediaFiles,
    mediaLabelHex,
    selectClip,
    clipAudioKeyframes,
  } = useClipStoreBindings(clip);
  const passiveMediaEnabled = true;
  const passiveDecorationsEnabled = true;
  const processedWaveformPyramidRef = clip.audioState?.processedAnalysisRefs?.processedWaveformPyramidId;
  const sourceWaveformPyramidRef = clip.audioState?.sourceAnalysisRefs?.waveformPyramidId;
  const hasLegacyWaveformData = hasLegacyWaveformSamples(clip);
  const processedSpectrogramTileSetRef = clip.audioState?.processedAnalysisRefs?.spectrogramTileSetIds?.[0];
  const sourceSpectrogramTileSetRef = clip.audioState?.sourceAnalysisRefs?.spectrogramTileSetIds?.[0];
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
  const {
    waveformProcessingState,
    spectrogramProcessingState,
    processedWaveformStatus,
    processedSpectrogramStatus,
    audioAnalysisDisplayStatus,
    showWaveformGenerationIndicator,
  } = useClipAudioAnalysisDisplayState({
    clip,
    clipAudioKeyframes,
    audioDisplayMode,
    processedWaveformPyramidRef,
    processedWaveformReady: Boolean(processedWaveformPyramid),
    processedWaveformLoadStatus: processedWaveformState.status,
    sourceWaveformReady: Boolean(sourceWaveformPyramid),
    hasLegacyWaveformData,
    usePredictiveAudioWaveform,
    processedSpectrogramTileSetRef,
    processedSpectrogramReady: Boolean(processedSpectrogramTileSet),
    processedSpectrogramLoadStatus: processedSpectrogramState.status,
    sourceSpectrogramReady: Boolean(sourceSpectrogramTileSet),
  });
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

  const {
    aiMove,
    aiMovePhase,
    animationClass,
    animationDelay,
  } = useClipAnimationState({ clip, clips, tracks });

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

  const {
    displayStartTime,
    displayDuration,
    displayInPoint,
    displayOutPoint,
    width,
    left,
    visibleTimelineViewportWidth,
    renderTimelineViewportWidth,
    waveformRenderWindow,
    thumbnailRenderWindow,
    showSegmentThumbnails,
    showRegularThumbnails,
    useSourceCache,
    cachedThumbnails,
    segmentThumbnailPlans,
    legacyThumbnailPlans,
  } = useClipTimelineRenderGeometry({
    clip,
    clips,
    isDragging,
    isTrimming,
    isLinkedToDragging,
    isLinkedToTrimming,
    isTrimFollower,
    clipDrag,
    clipTrim,
    timelineViewportWidth,
    scrollX,
    thumbnailsEnabled,
    passiveMediaEnabled,
    isAudioClip,
    showsStaticClipArtwork,
    timeToPixel,
  });

  useClipAudioArtifactWarmups({
    clip,
    clipAudioKeyframes,
    audioDisplayMode,
    passiveMediaEnabled,
    waveformsEnabled,
    isAudioClip,
    isClipDragActive,
    processedWaveformPyramidRef,
    sourceSpectrogramTileSetRef,
    processedSpectrogramTileSetRef,
    width,
    zoom,
  });

  const {
    spectrogramNaturalDuration,
    spectrogramInPoint,
    spectrogramOutPoint,
    audioWaveformDiagnostics,
    audioVolumeAutomationKeyframes,
    visibleFadeCurveKeyframes,
    visibleFadeCurveKey,
  } = useClipAudioDisplayDerivedState({
    clip,
    clipAudioKeyframes,
    isAudioClip,
    waveformsEnabled,
    processedWaveformPyramid,
    waveformPyramid,
    waveformVariant,
    waveformDisplayGain,
    processedSpectrogramTileSet,
    displayInPoint,
    displayOutPoint,
    displayDuration,
    opacityKeyframes,
  });

  const keyframeTickGroups = keyframeTimeGroups;
  const [audioRegionDrag, setAudioRegionDrag] = useState<AudioRegionDragState | null>(null);
  const [videoBakeRegionDrag, setVideoBakeRegionDrag] = useState<VideoBakeRegionDragState | null>(null);
  const [audioRegionMoveDrag, setAudioRegionMoveDrag] = useState<AudioRegionMoveDragState | null>(null);
  const [audioRegionResizeDrag, setAudioRegionResizeDrag] = useState<AudioRegionResizeDragState | null>(null);
  const [spectralRegionDrag, setSpectralRegionDrag] = useState<SpectralRegionDragState | null>(null);

  const {
    displayAudioEditStack,
    getMatchingAudioRegionOperationIds,
    hasWaveformForRender,
    audioSpectrogramProps,
    audioWaveformProps,
  } = useClipAudioRenderState({
    clip,
    clipTrim,
    audioEditStack,
    audioRegionSelection,
    audioRegionGainPreview,
    audioRegionMoveDrag,
    audioRegionResizeDrag,
    sourceWaveformPyramid,
    processedWaveformPyramid,
    waveformPyramid,
    waveformVariant,
    waveformDisplayGain,
    spectrogramTileSet,
    spectrogramInPoint,
    spectrogramOutPoint,
    spectrogramNaturalDuration,
    spectrogramVariant,
    waveformRenderWindow,
    audioVolumeAutomationKeyframes,
    isAudioClip,
    isTrimming,
    isLinkedToTrimming,
    displayInPoint,
    displayOutPoint,
    displayDuration,
    width,
    left,
    scrollX,
    renderTimelineViewportWidth,
    trackBaseHeight,
    zoom,
    audioDisplayMode,
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

  const {
    spectralImageFilesById,
    selectedSpectralImageFile,
    handleAddSelectedImageSpectralLayer,
    handleSpectralImageLayerDragOver,
    handleSpectralImageLayerDrop,
  } = useClipSpectralImageLayers({
    clip,
    mediaFiles,
    audioSpectralRegionSelection,
    displayStartTime,
    displayDuration,
    displayInPoint,
    displayOutPoint,
    zoom,
    spectralMaxFrequencyHz,
    canSelectSpectralRegion,
    timelineTimeFromAudioRegionClientX,
    addClipSpectralImageLayer,
    setAudioSpectralRegionSelection,
  });

  const {
    clipClass,
    clipStyle,
    clipMetaOffset,
    sourceExtensionGhosts,
    isTrackLocked,
    canHandleTimelineToolPointer,
  } = useClipVisualChrome({
    clip,
    track,
    tracks,
    clipDrag,
    clipTrim,
    isSelected,
    isInLinkedGroup,
    isDragging,
    isClipDragActive,
    isTrimming,
    isFading,
    isLinkedToDragging,
    isLinkedToTrimming,
    isAudioClip,
    audioFocusMode,
    audioDisplayMode,
    audioRegionSelected: Boolean(audioRegionSelection),
    spectralRegionSelected: Boolean(audioSpectralRegionSelection),
    videoBakeRegionSelected: Boolean(videoBakeRegionSelection),
    clipTypeClass,
    hasProxy,
    isGeneratingProxy,
    hasProxyError,
    hasAudioProxy,
    isGeneratingAudioProxy,
    hasAudioProxyError,
    showActiveStemSeparation,
    hasKeyframes,
    showWaveformGenerationIndicator,
    waveformProcessingState,
    spectrogramProcessingState,
    processedWaveformStatusClassName: processedWaveformStatus?.className ?? '',
    processedSpectrogramStatusClassName: processedSpectrogramStatus?.className ?? '',
    audioWaveformDiagnosticClassNames: audioWaveformDiagnostics?.classNames ?? [],
    aiMovePhase,
    aiMove,
    animationDelay,
    timelineToolCursor,
    trackFocusMode,
    timelineTrackColorsVisible,
    isSolidClip,
    mediaLabelHex,
    passiveDecorationsEnabled,
    left,
    width,
    scrollX,
    visibleTimelineViewportWidth,
    displayStartTime,
    displayDuration,
    displayInPoint,
    displayOutPoint,
    renderTimelineViewportWidth,
    timeToPixel,
  });

  const {
    shouldShowCutIndicator,
    cutIndicatorX,
    handleMouseMove,
    handleMouseLeave,
    handleClick,
  } = useClipTimelineToolPointer({
    clip,
    track,
    clips,
    activeTimelineToolId,
    timelineToolPreview,
    canHandleTimelineToolPointer,
    playheadPosition,
    snappingEnabled,
    displayStartTime,
    displayDuration,
    width,
    isBladeToolActive,
    setTimelineToolPreview,
    applyTimelineEditOperation,
    setActiveTimelineTool,
  });

  const {
    spectralRegionOverlay,
    spectralImageLayerOverlays,
    audioEditOperationOverlays,
    clipVideoBakeRegionOverlays,
  } = useClipRegionOverlayState({
    clip,
    isAudioClip,
    audioFocusMode,
    showAudioRegionEditMarkers,
    audioDisplayMode,
    canSelectSpectralRegion,
    audioRegionSelection,
    audioSpectralRegionSelection,
    videoBakeRegionSelection,
    displayAudioEditStack,
    displayStartTime,
    displayDuration,
    displayInPoint,
    displayOutPoint,
    width,
    trackBaseHeight,
    spectralMaxFrequencyHz,
    spectralImageFilesById,
    sourceTimeToVideoBakeTimelineTime,
  });
  const {
    audioBakePending,
    handleBakeClipVideoRegion,
    handleUnbakeClipVideoRegion,
    handleRemoveClipVideoRegion,
    handleAudioEditOperationOverlayActivate,
    handleToggleAudioEditOperation,
    handleRemoveAudioEditOperation,
    handleApplySpectralRegionEdit,
    handleAudioEditStackMouseDown,
    handleBakeAudioEditStack,
    handleUnbakeAudioEditStack,
    handleClearAudioEditStack,
  } = useClipOverlayActions({
    clipId: clip.id,
    canUnbakeAudioEditStack,
    bakeClipVideoBakeRegion,
    unbakeClipVideoBakeRegion,
    removeClipVideoBakeRegion,
    closeAudioRegionContextMenu,
    setAudioRegionSelection,
    setClipAudioEditOperationEnabled,
    removeClipAudioEditOperation,
    applySpectralRegionEdit,
    clearClipAudioEditStack,
    bakeClipAudioEditStack,
    unbakeClipAudioEditStack,
  });

  // Track filtering must stay after all hooks so React sees a stable hook order
  // while clips move between tracks during drag and linked edits.
  if (isDragging && clipDrag && clipDrag.currentTrackId !== trackId) {
    return null;
  }
  if (clip.trackId !== trackId && !isDragging) {
    return null;
  }
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
