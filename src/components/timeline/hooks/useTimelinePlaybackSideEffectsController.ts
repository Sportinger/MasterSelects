import { useAutoFeatures } from './useAutoFeatures';
import { useLayerSync } from './useLayerSync';
import { usePlaybackLoop } from './usePlaybackLoop';
import { usePlayheadSnap } from './usePlayheadSnap';
import { useTimelineKeyboard } from './useTimelineKeyboard';

type KeyboardParams = Parameters<typeof useTimelineKeyboard>[0];
type AutoFeaturesParams = Parameters<typeof useAutoFeatures>[0];
type LayerSyncParams = Parameters<typeof useLayerSync>[0];
type PlaybackLoopParams = Parameters<typeof usePlaybackLoop>[0];
type PlayheadSnapParams = Parameters<typeof usePlayheadSnap>[0];

type UseTimelinePlaybackSideEffectsControllerParams =
  KeyboardParams &
  AutoFeaturesParams &
  LayerSyncParams &
  PlaybackLoopParams &
  PlayheadSnapParams;

export function useTimelinePlaybackSideEffectsController({
  activeComposition,
  addMarker,
  applyTimelineEditOperation,
  audioTracks,
  cancelRamPreview,
  clearInOut,
  clipDrag,
  clipKeyframes,
  clipMap,
  clips,
  copyClips,
  copyKeyframes,
  currentlyGeneratingProxyId,
  duration,
  getClipsAtTime,
  getInterpolatedEffects,
  getInterpolatedSpeed,
  getInterpolatedTransform,
  getInterpolatedVectorAnimationSettings,
  getSnapTargetTimes,
  getSourceTimeForClip,
  inPoint,
  isAudioTrackMuted,
  isDraggingPlayhead,
  isPlaying,
  isRamPreviewing,
  isVideoTrackVisible,
  outPoint,
  pasteClips,
  pasteKeyframes,
  pause,
  pixelToTime,
  play,
  playForward,
  playReverse,
  playheadPosition,
  proxyEnabled,
  ramPreviewEnabled,
  ramPreviewRange,
  scrollX,
  selectedClipIds,
  selectedKeyframeIds,
  setDraggingPlayhead,
  setInPointAtPlayhead,
  setOutPointAtPlayhead,
  setPlayheadPosition,
  setScrollX,
  snappingEnabled,
  splitClipAtPlayhead,
  startRamPreview,
  timelineRef,
  toggleCutTool,
  toggleLoopPlayback,
  toolMode,
  tracks,
  videoTracks,
  zoom,
}: UseTimelinePlaybackSideEffectsControllerParams): void {
  useTimelineKeyboard({
    isPlaying,
    play,
    pause,
    playForward,
    playReverse,
    setInPointAtPlayhead,
    setOutPointAtPlayhead,
    clearInOut,
    toggleLoopPlayback,
    selectedClipIds,
    selectedKeyframeIds,
    applyTimelineEditOperation,
    splitClipAtPlayhead,
    copyClips,
    pasteClips,
    copyKeyframes,
    pasteKeyframes,
    toolMode,
    toggleCutTool,
    clipMap,
    activeComposition,
    playheadPosition,
    duration,
    setPlayheadPosition,
    addMarker,
  });

  useAutoFeatures({
    ramPreviewEnabled,
    proxyEnabled,
    isPlaying,
    isDraggingPlayhead,
    isRamPreviewing,
    currentlyGeneratingProxyId,
    inPoint,
    outPoint,
    ramPreviewRange,
    clips,
    startRamPreview,
    cancelRamPreview,
  });

  useLayerSync({
    playheadPosition,
    clips,
    tracks,
    isPlaying,
    isDraggingPlayhead,
    ramPreviewRange,
    isRamPreviewing,
    clipKeyframes,
    clipDrag,
    clipMap,
    videoTracks,
    audioTracks,
    getClipsAtTime,
    getInterpolatedTransform,
    getInterpolatedEffects,
    getInterpolatedVectorAnimationSettings,
    getInterpolatedSpeed,
    getSourceTimeForClip,
    isVideoTrackVisible,
    isAudioTrackMuted,
  });

  usePlaybackLoop({ isPlaying });

  usePlayheadSnap({
    isDraggingPlayhead,
    timelineRef,
    scrollX,
    duration,
    snappingEnabled,
    pixelToTime,
    getSnapTargetTimes,
    setPlayheadPosition,
    setScrollX,
    setDraggingPlayhead,
    zoom,
  });
}
