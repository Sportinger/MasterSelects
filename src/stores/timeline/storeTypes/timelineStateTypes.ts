import type {
  AnimatableProperty,
  ClipAudioRegionGainPreview,
  Keyframe,
  Layer,
  MasterAudioState,
  RuntimeAudioMeterState,
  TimelineClip,
  TimelineTrack,
  VideoBakeRegion,
} from '../../../types';
import type {
  LastTimelineToolByGroup,
  MaskEditMode,
  TimelineAudioDisplayMode,
  TimelineClipDragPreview,
  TimelinePropertiesSelection,
  TimelineRangeSelection,
  TimelineToolGroupId,
  TimelineToolId,
  TimelineToolMode,
  TimelineToolPreview,
  TimelineTransitionEditPreview,
  TimelineTrackFocusMode,
} from './toolTypes';
import type {
  TimelineAudioRegionClipboard,
  TimelineAudioRegionSelection,
  TimelineSpectralRegionSelection,
  TimelineVideoBakeRegionSelection,
} from './regionTypes';
import type {
  AIActionOverlay,
  AIMovingClip,
  PlaybackWarmupState,
} from './feedbackTypes';
import type { ClipStemSeparationJobState } from './stemJobTypes';

export interface TimelineState {
  tracks: TimelineTrack[];
  clips: TimelineClip[];
  playheadPosition: number;
  duration: number;
  zoom: number;
  scrollX: number;
  trackHeaderWidth: number;
  timelineSplitRatio: number | null;
  snappingEnabled: boolean;
  isPlaying: boolean;
  isDraggingPlayhead: boolean;
  playbackWarmup: PlaybackWarmupState | null;
  selectedClipIds: Set<string>;
  primarySelectedClipId: string | null;
  propertiesSelection: TimelinePropertiesSelection;
  targetTrackIdByType: Partial<Record<'video' | 'audio' | 'midi', string>>;
  layers: Layer[];
  selectedLayerId: string | null;
  inPoint: number | null;
  outPoint: number | null;
  loopPlayback: boolean;
  playbackSpeed: number;
  durationLocked: boolean;
  ramPreviewEnabled: boolean;
  ramPreviewProgress: number | null;
  ramPreviewRange: { start: number; end: number } | null;
  isRamPreviewing: boolean;
  cachedFrameTimes: Set<number>;
  isProxyCaching: boolean;
  proxyCacheProgress: number | null;
  isExporting: boolean;
  exportProgress: number | null;
  exportCurrentTime: number | null;
  exportRange: { start: number; end: number } | null;
  exportPreviewFrame: ImageBitmap | null;
  exportPreviewFrameTime: number | null;
  thumbnailsEnabled: boolean;
  waveformsEnabled: boolean;
  audioDisplayMode: TimelineAudioDisplayMode;
  audioLayerAdvancedMode: boolean;
  audioFocusMode: boolean;
  trackFocusMode: TimelineTrackFocusMode;
  audioRegionSelection: TimelineAudioRegionSelection | null;
  videoBakeRegionSelection: TimelineVideoBakeRegionSelection | null;
  videoBakeRegions: VideoBakeRegion[];
  audioRegionGainPreview: ClipAudioRegionGainPreview | null;
  audioSpectralRegionSelection: TimelineSpectralRegionSelection | null;
  audioRegionClipboard: TimelineAudioRegionClipboard | null;
  showAudioRegionEditMarkers: boolean;
  showTranscriptMarkers: boolean;
  clipStemSeparationJobs: Record<string, ClipStemSeparationJobState>;
  clipKeyframes: Map<string, Keyframe[]>;
  keyframeRecordingEnabled: Set<string>;
  expandedTracks: Set<string>;
  expandedTrackPropertyGroups: Map<string, Set<string>>;
  selectedKeyframeIds: Set<string>;
  expandedCurveProperties: Map<string, Set<AnimatableProperty>>;
  curveEditorHeight: number;
  maskEditMode: MaskEditMode;
  maskPanelActive: boolean;
  activeMaskId: string | null;
  selectedVertexIds: Set<string>;
  maskDrawStart: { x: number; y: number } | null;
  maskDragging: boolean;
  toolMode: TimelineToolMode;
  activeTimelineToolId: TimelineToolId;
  previousTimelineToolId: TimelineToolId | null;
  lastTimelineToolByGroup: LastTimelineToolByGroup;
  openTimelineToolGroupId: TimelineToolGroupId | null;
  momentaryTimelineToolId: TimelineToolId | null;
  timelineRangeSelection: TimelineRangeSelection | null;
  timelineToolPreview: TimelineToolPreview | null;
  transitionEditPreview: TimelineTransitionEditPreview | null;
  clipDragPreview: TimelineClipDragPreview | null;
  markers: import('./feedbackTypes').TimelineMarker[];
  // Multi-ruler infrastructure (issue #257). View state — always defaulted at
  // init/load, so required (not optional) in the runtime store.
  tempoMap: import('../../../types').TempoMap;
  rulerLanes: import('../../../types').RulerLane[];
  activeRulerLaneId: string | null;
  masterAudioState?: MasterAudioState;
  runtimeAudioMeters: RuntimeAudioMeterState;
  clipEntranceAnimationKey: number;
  clipAnimationPhase: 'idle' | 'exiting' | 'entering';
  compositionSwitchDirection: 'forward' | 'backward';
  compositionSwitchSourceTracks: TimelineTrack[] | null;
  compositionSwitchTargetTracks: TimelineTrack[] | null;
  slotGridProgress: number;
  aiActionOverlays: AIActionOverlay[];
  aiMovingClips: Map<string, AIMovingClip>;
  timelineSessionId: number;
}
