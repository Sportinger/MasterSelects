import type { TimelineTrack } from '../../../types';
import type {
  ApplyTimelineEditOperationOptions,
  TimelineEditOperation,
  TimelineEditOperationSource,
  TimelineEditResult,
  TimelinePlacementMode,
} from '../editOperations/types';
import type {
  TimelineAudioDisplayMode,
  TimelineClipDragPreview,
  TimelineRangeSelection,
  TimelineToolGroupId,
  TimelineToolId,
  TimelineToolMode,
  TimelineToolPreview,
  TimelineTransitionEditPreview,
  TimelineTrackFocusMode,
} from './toolTypes';
import type {
  TimelineAudioRegionSelection,
  TimelineSpectralRegionSelection,
} from './regionTypes';

export interface PlaybackActions {
  setPlayheadPosition: (position: number) => void;
  setDraggingPlayhead: (dragging: boolean) => void;
  play: () => Promise<void>;
  pause: () => void;
  stop: () => void;
  setZoom: (zoom: number) => void;
  toggleSnapping: () => void;
  setScrollX: (scrollX: number) => void;
  setInPoint: (time: number | null) => void;
  setOutPoint: (time: number | null) => void;
  clearInOut: () => void;
  setInPointAtPlayhead: () => void;
  setOutPointAtPlayhead: () => void;
  setLoopPlayback: (loop: boolean) => void;
  toggleLoopPlayback: () => void;
  setPlaybackSpeed: (speed: number) => void;
  playForward: () => void;
  playReverse: () => void;
  setDuration: (duration: number) => void;
  setTrackHeaderWidth: (width: number) => void;
  setTimelineSplitRatio: (ratio: number | null) => void;
  setToolMode: (mode: TimelineToolMode) => void;
  toggleCutTool: () => void;
  setClipAnimationPhase: (phase: 'idle' | 'exiting' | 'entering') => void;
  setCompositionSwitchDirection: (direction: 'forward' | 'backward') => void;
  setCompositionSwitchSourceTracks: (tracks: TimelineTrack[] | null) => void;
  setCompositionSwitchTargetTracks: (tracks: TimelineTrack[] | null) => void;
  setSlotGridProgress: (progress: number) => void;
  toggleThumbnailsEnabled: () => void;
  toggleWaveformsEnabled: () => void;
  setThumbnailsEnabled: (enabled: boolean) => void;
  setWaveformsEnabled: (enabled: boolean) => void;
  setAudioDisplayMode: (mode: TimelineAudioDisplayMode) => void;
  setAudioLayerAdvancedMode: (enabled: boolean) => void;
  toggleAudioLayerAdvancedMode: () => void;
  setAudioFocusMode: (enabled: boolean) => void;
  toggleAudioFocusMode: () => void;
  setTrackFocusMode: (mode: TimelineTrackFocusMode) => void;
  setAudioRegionSelection: (selection: TimelineAudioRegionSelection | null) => void;
  clearAudioRegionSelection: () => void;
  setAudioSpectralRegionSelection: (selection: TimelineSpectralRegionSelection | null) => void;
  clearAudioSpectralRegionSelection: () => void;
  toggleAudioRegionEditMarkers: () => void;
  setShowAudioRegionEditMarkers: (enabled: boolean) => void;
  toggleTranscriptMarkers: () => void;
  setShowTranscriptMarkers: (enabled: boolean) => void;
}

export interface TimelineToolActions {
  setActiveTimelineTool: (toolId: TimelineToolId) => void;
  activateTimelineToolGroup: (groupId: TimelineToolGroupId) => void;
  cycleTimelineToolGroup: (groupId: TimelineToolGroupId, direction?: 1 | -1) => void;
  setOpenTimelineToolGroup: (groupId: TimelineToolGroupId | null) => void;
  setMomentaryTimelineTool: (toolId: TimelineToolId) => void;
  clearMomentaryTimelineTool: () => void;
  setTimelineRangeSelection: (selection: TimelineRangeSelection | null) => void;
  clearTimelineRangeSelection: () => void;
  setTimelineToolPreview: (preview: TimelineToolPreview | null) => void;
  setTransitionEditPreview: (preview: TimelineTransitionEditPreview | null) => void;
}

export interface TimelineEditOperationActions {
  applyTimelineEditOperation: (
    operation: TimelineEditOperation,
    options: ApplyTimelineEditOperationOptions,
  ) => TimelineEditResult;
  splitAllClipsAtTime: (time: number, trackIds?: string[]) => TimelineEditResult;
  selectClipsFromTime: (
    time: number,
    options?: {
      direction?: 'forward' | 'backward';
      trackIds?: string[];
      includeLinked?: boolean;
    },
  ) => TimelineEditResult;
  rippleDeleteSelection: (clipIds?: string[]) => TimelineEditResult;
  deleteClipSelection: (clipIds?: string[]) => TimelineEditResult;
  deleteGapAtTime: (time: number, trackIds?: string[]) => TimelineEditResult;
  deleteAllGaps: (trackIds?: string[], startTime?: number) => TimelineEditResult;
  trimSelectedClipEdgeToPlayhead: (edge: 'start' | 'end') => TimelineEditResult;
  rippleTrimSelectedClipEdgeToPlayhead: (edge: 'start' | 'end') => TimelineEditResult;
  prepareTimelinePlacementRange: (
    mode: TimelinePlacementMode,
    options: {
      trackIds?: string[];
      startTime?: number;
      duration?: number;
      targetClipId?: string;
      includeLinked?: boolean;
      rippleDelta?: number;
      source?: TimelineEditOperationSource;
      historyLabel?: string;
    },
  ) => TimelineEditResult;
  liftTimelineRange: () => TimelineEditResult;
  extractTimelineRange: () => TimelineEditResult;
}

export interface ClipDragPreviewActions {
  setClipDragPreview?: (preview: TimelineClipDragPreview | null) => void;
}
