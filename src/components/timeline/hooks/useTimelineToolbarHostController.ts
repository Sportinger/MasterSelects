import type { TimelineActionBindings } from './useTimelineActionController';
import type { useTimelineRootStoreState } from './useTimelineRootStoreState';
import { useTimelineToolbarChromeController } from './useTimelineToolbarChromeController';

type ToolbarControllerInput = Parameters<typeof useTimelineToolbarChromeController>[0];

interface TimelineToolbarHostControllerInput {
  formatTime: ToolbarControllerInput['formatTime'];
  frameRate: number;
  handleFitToWindow: ToolbarControllerInput['onFitToWindow'];
  handleSetZoom: ToolbarControllerInput['onSetZoom'];
  handleToggleSlotGrid: ToolbarControllerInput['onToggleSlotGrid'];
  parseTime: ToolbarControllerInput['parseTime'];
  rootState: ReturnType<typeof useTimelineRootStoreState>;
  timelineActions: TimelineActionBindings;
  timelineCurveMode: ToolbarControllerInput['timelineCurveMode'];
  toggleTimelineCurveMode: ToolbarControllerInput['onToggleTimelineCurveMode'];
}

/** Maps root state and stable actions onto the Timeline toolbar contract. */
export function useTimelineToolbarHostController({
  formatTime,
  frameRate,
  handleFitToWindow,
  handleSetZoom,
  handleToggleSlotGrid,
  parseTime,
  rootState,
  timelineActions,
  timelineCurveMode,
  toggleTimelineCurveMode,
}: TimelineToolbarHostControllerInput) {
  return useTimelineToolbarChromeController({
    isPlaying: rootState.isPlaying,
    loopPlayback: rootState.loopPlayback,
    playheadPosition: rootState.playheadPosition,
    duration: rootState.duration,
    zoom: rootState.zoom,
    snappingEnabled: rootState.snappingEnabled,
    inPoint: rootState.inPoint,
    outPoint: rootState.outPoint,
    proxyEnabled: rootState.proxyEnabled,
    currentlyGeneratingProxyId: rootState.currentlyGeneratingProxyId,
    mediaFiles: rootState.mediaFiles,
    thumbnailsEnabled: rootState.thumbnailsEnabled,
    waveformsEnabled: rootState.waveformsEnabled,
    audioDisplayMode: rootState.audioDisplayMode,
    audioFocusMode: rootState.audioFocusMode,
    showAudioRegionEditMarkers: rootState.showAudioRegionEditMarkers,
    trackFocusMode: rootState.trackFocusMode,
    toolMode: rootState.toolMode,
    onPlay: timelineActions.play,
    onPause: timelineActions.pause,
    onStop: timelineActions.stop,
    onToggleLoop: timelineActions.toggleLoopPlayback,
    onSetZoom: handleSetZoom,
    onToggleSnapping: timelineActions.toggleSnapping,
    onToggleThumbnails: timelineActions.toggleThumbnailsEnabled,
    onToggleWaveforms: timelineActions.toggleWaveformsEnabled,
    onSetAudioDisplayMode: timelineActions.setAudioDisplayMode,
    onToggleAudioFocusMode: timelineActions.toggleAudioFocusMode,
    onToggleAudioRegionEditMarkers: timelineActions.toggleAudioRegionEditMarkers,
    onSetTrackFocusMode: timelineActions.setTrackFocusMode,
    onToggleCutTool: timelineActions.toggleCutTool,
    onFitToWindow: handleFitToWindow,
    onToggleSlotGrid: handleToggleSlotGrid,
    slotGridProgress: rootState.slotGridProgress,
    formatTime,
    frameRate,
    parseTime,
    setDuration: timelineActions.setDuration,
    timelineCurveMode,
    onToggleTimelineCurveMode: toggleTimelineCurveMode,
  });
}
