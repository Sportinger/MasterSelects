import type {
  AnimatableProperty,
  BezierHandle,
  ClipCustomNodeParamDefinition,
  ClipCustomNodeParamValue,
  ClipMask,
  ClipTransform,
  CompositionTimelineData,
  Effect,
  Keyframe,
  Layer,
  NodeGraphConnectionRequest,
  NodeGraphLayout,
  RulerLaneFormat,
  RuntimeColorGrade,
  TextBoundsPath,
  TimelineClip,
} from '../../../types';
import type { VectorAnimationClipSettings } from '../../../types/vectorAnimation';
import type { SceneCameraSettings } from '../../mediaStore/types';
import type {
  TimelineEditOperationSource,
  TimelineEditResult,
} from '../editOperations/types';
import type { AIActionOverlay, TimelineMarker } from './feedbackTypes';
import type { TimelineVideoBakeRegionSelection } from './regionTypes';

export interface RamPreviewActions {
  toggleRamPreviewEnabled: () => void;
  startRamPreview: () => Promise<void>;
  startRamPreviewForRange: (
    start: number,
    end: number,
    options?: { centerTime?: number; label?: string },
  ) => Promise<boolean>;
  cancelRamPreview: () => void;
  clearRamPreview: () => void;
  addCachedFrame: (time: number) => void;
  getCachedRanges: () => Array<{ start: number; end: number }>;
}

export interface VideoBakeActions {
  setVideoBakeRegionSelection: (selection: TimelineVideoBakeRegionSelection | null) => void;
  clearVideoBakeRegionSelection: () => void;
  addCompositionVideoBakeRegion: (startTime: number, endTime: number) => string | null;
  bakeCompositionVideoBakeRegion: (regionId: string) => Promise<boolean>;
  unbakeCompositionVideoBakeRegion: (regionId: string) => boolean;
  removeCompositionVideoBakeRegion: (regionId: string) => boolean;
  addClipVideoBakeRegion: (
    clipId: string,
    selection: Omit<TimelineVideoBakeRegionSelection, 'scope' | 'clipId'>,
  ) => string | null;
  bakeClipVideoBakeRegion: (clipId: string, regionId: string) => Promise<boolean>;
  unbakeClipVideoBakeRegion: (clipId: string, regionId: string) => boolean;
  removeClipVideoBakeRegion: (clipId: string, regionId: string) => boolean;
}

export interface ProxyCacheActions {
  getProxyCachedRanges: () => Array<{ start: number; end: number }>;
  getScrubCachedRanges: () => Array<{ start: number; end: number }>;
  invalidateCache: () => void;
  startProxyCachePreload: () => Promise<void>;
  cancelProxyCachePreload: () => void;
}

export interface ExportActions {
  setExportProgress: (progress: number | null, currentTime: number | null) => void;
  setExportPreviewFrame: (frame: ImageBitmap | null, currentTime: number | null) => void;
  startExport: (start: number, end: number) => void;
  endExport: () => void;
}

export interface SelectionActions {
  selectClip: (id: string | null, addToSelection?: boolean, setPrimaryOnly?: boolean) => void;
  selectClips: (ids: string[]) => void;
  addClipToSelection: (id: string) => void;
  removeClipFromSelection: (id: string) => void;
  clearClipSelection: () => void;
  selectTransitionProperties: (clipId: string, edge: 'in' | 'out', transitionId: string) => void;
  selectTrackProperties: (trackId: string) => void;
  selectMasterProperties: () => void;
  clearPropertiesSelection: () => void;
  selectKeyframe: (keyframeId: string, addToSelection?: boolean) => void;
  deselectAllKeyframes: () => void;
  deleteSelectedKeyframes: () => void;
}

export interface KeyframeActions {
  addKeyframe: (clipId: string, property: AnimatableProperty, value: number, time?: number, easing?: string | null) => void;
  removeKeyframe: (keyframeId: string) => void;
  updateKeyframe: (keyframeId: string, updates: Partial<Omit<Keyframe, 'id' | 'clipId' | 'easing'>> & { easing?: string | null }) => void;
  moveKeyframe: (keyframeId: string, newTime: number) => void;
  moveKeyframes: (keyframeIds: string[], newTime: number) => void;
  getClipKeyframes: (clipId: string) => Keyframe[];
  getInterpolatedTransform: (clipId: string, clipLocalTime: number) => ClipTransform;
  getInterpolatedCameraSettings: (clipId: string, clipLocalTime: number) => SceneCameraSettings;
  getInterpolatedEffects: (clipId: string, clipLocalTime: number) => Effect[];
  getInterpolatedNodeGraphParams: (clipId: string, nodeId: string, clipLocalTime: number) => Record<string, ClipCustomNodeParamValue>;
  getInterpolatedColorCorrection: (clipId: string, clipLocalTime: number) => RuntimeColorGrade | undefined;
  getInterpolatedVectorAnimationSettings: (clipId: string, clipLocalTime: number) => VectorAnimationClipSettings;
  getInterpolatedMasks: (clipId: string, clipLocalTime: number) => ClipMask[] | undefined;
  getInterpolatedTextBounds: (clipId: string, clipLocalTime: number) => TextBoundsPath | undefined;
  getInterpolatedSpeed: (clipId: string, clipLocalTime: number) => number;
  getSourceTimeForClip: (clipId: string, clipLocalTime: number) => number;
  hasKeyframes: (clipId: string, property?: AnimatableProperty) => boolean;
  toggleKeyframeRecording: (clipId: string, property: AnimatableProperty) => void;
  isRecording: (clipId: string, property: AnimatableProperty) => boolean;
  setPropertyValue: (clipId: string, property: AnimatableProperty, value: number) => void;
  addMaskPathKeyframe: (
    clipId: string,
    maskId: string,
    pathValue?: Keyframe['pathValue'],
    time?: number,
    easing?: string | null,
    options?: { phase?: 'update' | 'commit'; source?: TimelineEditOperationSource; historyLabel?: string },
  ) => void;
  recordMaskPathKeyframe: (clipId: string, maskId: string) => void;
  disableMaskPathKeyframes: (clipId: string, maskId: string, pathValue?: Keyframe['pathValue']) => void;
  addTextBoundsPathKeyframe: (
    clipId: string,
    pathValue?: Keyframe['pathValue'],
    time?: number,
    easing?: string | null,
    options?: { phase?: 'update' | 'commit'; source?: TimelineEditOperationSource; historyLabel?: string },
  ) => void;
  recordTextBoundsPathKeyframe: (clipId: string) => void;
  disableTextBoundsPathKeyframes: (clipId: string, pathValue?: Keyframe['pathValue']) => void;
  toggleTrackExpanded: (trackId: string) => void;
  isTrackExpanded: (trackId: string) => boolean;
  toggleTrackPropertyGroupExpanded: (trackId: string, groupName: string) => void;
  isTrackPropertyGroupExpanded: (trackId: string, groupName: string) => boolean;
  getExpandedTrackHeight: (trackId: string, baseHeight: number) => number;
  trackHasKeyframes: (trackId: string) => boolean;
  toggleCurveExpanded: (trackId: string, property: AnimatableProperty) => void;
  isCurveExpanded: (trackId: string, property: AnimatableProperty) => boolean;
  setCurveEditorHeight: (height: number) => void;
  updateBezierHandle: (keyframeId: string, handle: 'in' | 'out', position: BezierHandle) => void;
  disablePropertyKeyframes: (clipId: string, property: AnimatableProperty, currentValue: number) => void;
}

export interface LayerActions {
  setLayers: (layers: Layer[]) => void;
  updateLayer: (id: string, updates: Partial<Layer>) => void;
  selectLayer: (id: string | null) => void;
}

export interface MarkerActions {
  addMarker: (time: number, label?: string, color?: string) => string;
  removeMarker: (markerId: string) => void;
  updateMarker: (markerId: string, updates: Partial<Omit<TimelineMarker, 'id'>>) => void;
  moveMarker: (markerId: string, newTime: number) => void;
  clearMarkers: () => void;
}

// Multi-ruler infrastructure (issue #257, Packet 3). Lane toggles + the active
// lane are VIEW state and are intentionally excluded from history snapshots.
export interface RulerLaneActions {
  // Enable a format's lane; no-op if already present. Returns the lane id.
  addRulerLane: (format: RulerLaneFormat) => string;
  removeRulerLane: (laneId: string) => void;
  setActiveRulerLane: (laneId: string | null) => void;
  // Replace the lane stacking order (no UI yet — seam for future drag-reorder).
  reorderRulerLanes: (orderedLaneIds: string[]) => void;
}

export interface TransitionActions {
  applyTransition: (
    clipAId: string,
    clipBId: string,
    type: string,
    duration: number,
    options?: { source?: TimelineEditOperationSource; historyLabel?: string },
  ) => TimelineEditResult;
  removeTransition: (
    clipId: string,
    edge: 'in' | 'out',
    options?: { source?: TimelineEditOperationSource; historyLabel?: string },
  ) => TimelineEditResult;
  updateTransitionDuration: (
    clipId: string,
    edge: 'in' | 'out',
    duration: number,
    options?: { source?: TimelineEditOperationSource; historyLabel?: string },
  ) => TimelineEditResult;
  findClipJunction: (trackId: string, time: number, threshold?: number) => { clipA: TimelineClip; clipB: TimelineClip; junctionTime: number } | null;
}

export interface NodeGraphActions {
  ensureClipNodeGraph: (clipId: string) => void;
  addClipAICustomNode: (clipId: string) => string | null;
  addClipAICustomNodeFromPort: (clipId: string, source: {
    fromNodeId: string;
    fromPortId: string;
    label?: string;
  }) => string | null;
  updateClipAICustomNode: (clipId: string, nodeId: string, updates: {
    label?: string;
    description?: string;
    bypassed?: boolean;
    params?: Record<string, ClipCustomNodeParamValue>;
    parameterSchema?: ClipCustomNodeParamDefinition[];
    status?: import('../../../types').ClipCustomNodeAuthoringStatus;
    ai?: Partial<import('../../../types').ClipCustomNodeAIAuthoring>;
  }) => void;
  removeClipNodeGraphNode: (clipId: string, nodeId: string) => void;
  showClipNodeGraphBuiltIn: (clipId: string, node: import('../../../types').ClipNodeGraphForcedBuiltIn) => void;
  connectClipNodeGraphPorts: (clipId: string, connection: NodeGraphConnectionRequest) => void;
  disconnectClipNodeGraphEdge: (clipId: string, edgeId: string) => void;
  moveClipNodeGraphNode: (clipId: string, nodeId: string, layout: NodeGraphLayout) => void;
}

export interface TimelineUtils {
  getClipsAtTime: (time: number) => TimelineClip[];
  updateDuration: () => void;
  findAvailableAudioTrack: (startTime: number, duration: number) => string;
  getSnappedPosition: (clipId: string, desiredStartTime: number, trackId: string) => { startTime: number; snapped: boolean; snapEdgeTime: number };
  findNonOverlappingPosition: (clipId: string, desiredStartTime: number, trackId: string, duration: number) => number;
  getPositionWithResistance: (clipId: string, desiredStartTime: number, trackId: string, duration: number, zoom?: number, excludeClipIds?: string[]) => { startTime: number; forcingOverlap: boolean; noFreeSpace?: boolean };
  trimOverlappingClips: (clipId: string, startTime: number, trackId: string, duration: number, excludeClipIds?: string[]) => void;
  getSerializableState: () => CompositionTimelineData;
  loadState: (data: CompositionTimelineData | undefined) => Promise<void>;
  clearTimeline: () => void;
}

export interface AIActionFeedbackActions {
  addAIOverlay: (overlay: Omit<AIActionOverlay, 'id' | 'createdAt'>) => string;
  addAIOverlaysBatch: (overlays: Omit<AIActionOverlay, 'id' | 'createdAt'>[]) => void;
  removeAIOverlay: (id: string) => void;
  setAIMovingClip: (clipId: string, fromStartTime: number, animationDuration?: number) => void;
  clearAIMovingClip: (clipId: string) => void;
}
