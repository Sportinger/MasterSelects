import type { ComponentProps } from 'react';

import { TimelineToolbarChrome } from '../components/TimelineToolbarChrome';
import { useTimelineControlsProps } from './useTimelineControlsProps';
import { useTimelineDurationEditor } from './useTimelineDurationEditor';
import type { TimelineCurveMode } from '../../../stores/timeline/viewPreferences';

type TimelineToolbarProps = ComponentProps<typeof TimelineToolbarChrome>;
type TimelineControlsParams = Parameters<typeof useTimelineControlsProps>[0];

interface UseTimelineToolbarChromeControllerParams extends TimelineControlsParams {
  frameRate: number;
  onToggleTimelineCurveMode: () => void;
  parseTime: (value: string) => number | null;
  setDuration: (duration: number) => void;
  timelineCurveMode: TimelineCurveMode;
}

export function useTimelineToolbarChromeController({
  audioDisplayMode,
  audioFocusMode,
  currentlyGeneratingProxyId,
  duration,
  formatTime,
  frameRate,
  inPoint,
  isPlaying,
  loopPlayback,
  mediaFiles,
  onToggleTimelineCurveMode,
  onFitToWindow,
  onPause,
  onPlay,
  onSetAudioDisplayMode,
  onSetTrackFocusMode,
  onSetZoom,
  onStop,
  onToggleAudioFocusMode,
  onToggleAudioRegionEditMarkers,
  onToggleCutTool,
  onToggleLoop,
  onToggleSlotGrid,
  onToggleSnapping,
  onToggleThumbnails,
  onToggleWaveforms,
  outPoint,
  parseTime,
  playheadPosition,
  proxyEnabled,
  setDuration,
  showAudioRegionEditMarkers,
  slotGridProgress,
  snappingEnabled,
  thumbnailsEnabled,
  toolMode,
  trackFocusMode,
  timelineCurveMode,
  waveformsEnabled,
  zoom,
}: UseTimelineToolbarChromeControllerParams) {
  const {
    isEditingTimelineDuration,
    timelineDurationInputValue,
    timelineTimeDisplayMode,
    timelineDurationInputRef,
    hasInOutDisplayRange,
    inOutDisplayDuration,
    timelineRulerCurrentTime,
    timelineTotalFrames,
    timelineCurrentFrame,
    timelineFpsValue,
    handleTimelineDurationClick,
    handleTimelineDurationInputChange,
    handleTimelineTimeDoubleClick,
    handleTimelineDurationSubmit,
    handleTimelineDurationKeyDown,
  } = useTimelineDurationEditor({
    duration,
    inPoint,
    outPoint,
    playheadPosition,
    frameRate,
    formatTime,
    parseTime,
    setDuration,
  });

  const timelineControlsProps = useTimelineControlsProps({
    isPlaying,
    loopPlayback,
    playheadPosition,
    duration,
    zoom,
    snappingEnabled,
    inPoint,
    outPoint,
    proxyEnabled,
    currentlyGeneratingProxyId,
    mediaFiles,
    thumbnailsEnabled,
    waveformsEnabled,
    audioDisplayMode,
    audioFocusMode,
    showAudioRegionEditMarkers,
    trackFocusMode,
    toolMode,
    onPlay,
    onPause,
    onStop,
    onToggleLoop,
    onSetZoom,
    onToggleSnapping,
    onToggleThumbnails,
    onToggleWaveforms,
    onSetAudioDisplayMode,
    onToggleAudioFocusMode,
    onToggleAudioRegionEditMarkers,
    onSetTrackFocusMode,
    onToggleCutTool,
    onFitToWindow,
    onToggleSlotGrid,
    slotGridProgress,
    formatTime,
  });

  const timelineToolbarProps: TimelineToolbarProps = {
    duration,
    formatTime,
    hasInOutDisplayRange,
    inOutDisplayDuration,
    isEditingTimelineDuration,
    onTimelineDurationClick: handleTimelineDurationClick,
    onTimelineDurationInputChange: handleTimelineDurationInputChange,
    onTimelineDurationKeyDown: handleTimelineDurationKeyDown,
    onTimelineDurationSubmit: handleTimelineDurationSubmit,
    onTimelineTimeDoubleClick: handleTimelineTimeDoubleClick,
    onToggleTimelineCurveMode,
    slotGridProgress,
    timelineControlsProps,
    timelineCurrentFrame,
    timelineDurationInputRef,
    timelineDurationInputValue,
    timelineFpsValue,
    timelineRulerCurrentTime,
    timelineTimeDisplayMode,
    timelineTotalFrames,
    timelineCurveMode,
  };

  return {
    timelineControlsProps,
    timelineTimeDisplayMode,
    timelineToolbarProps,
  };
}
