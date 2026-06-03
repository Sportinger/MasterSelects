// Timeline-specific types for component props

import type {
  TimelineClip,
  TimelineTrack,
  VideoBakeRegion,
  AnimatableProperty,
  ClipTransform,
  BezierHandle,
  EasingType,
  RotationInterpolationMode,
  ClipAudioRegionGainPreview,
} from '../../types';
import type {
  ClipStemSeparationJobState,
  TimelineAudioRegionSelection,
  TimelineAudioDisplayMode,
  TimelineClipDragPreview,
  TimelineSpectralRegionSelection,
  TimelineToolId,
  TimelineTrackFocusMode,
  TimelineVideoBakeRegionSelection,
} from '../../stores/timeline/types';

// Clip drag state (Premiere-style)
export interface ClipDragState {
  clipId: string;
  toolGesture?: 'slip' | 'slide';
  originalStartTime: number;
  originalTrackId: string;
  grabOffsetX: number;      // Where on the clip we grabbed (in pixels)
  grabY: number;            // Mouse Y relative to track lanes at grab start (for track-change resistance)
  gestureStartX?: number;   // Mouse X at gesture start for body tools like Slip/Slide
  currentX: number;         // Current mouse X position
  currentTrackId: string;
  snappedTime: number | null;  // Preview/commit position with snapping and resistance applied
  snapIndicatorTime: number | null; // The actual edge time where snap occurs - used for snap line indicator
  isSnapping: boolean;         // Whether currently snapping to an edge
  trackChangeGuideTime: number | null; // Guide line at original position when dragging across tracks
  newTrackType?: 'video' | 'audio' | null; // Ghost target when dragging beyond video/audio track stacks
  altKeyPressed: boolean;      // If true, skip linked group movement (independent drag)
  forcingOverlap: boolean;     // If true, user has pushed through resistance and is forcing overlap
  overlapClipIds?: string[];    // Clips currently overlapping the drag preview
  dragStartTime: number;       // Timestamp when drag started (for track-change delay)
  // Multi-select drag support
  multiSelectTimeDelta?: number;  // Time delta to apply to all selected clips during preview
  multiSelectClipIds?: string[];  // IDs of clips being moved together (excluding the main dragged clip)
  sourceTimeDelta?: number;       // Source in/out delta for Slip preview and commit
}

// Clip trim state
export interface ClipTrimState {
  clipId: string;
  edge: 'left' | 'right';
  originalStartTime: number;
  originalDuration: number;
  originalInPoint: number;
  originalOutPoint: number;
  startX: number;
  currentX: number;
  altKey: boolean;  // If true, don't trim linked clip
  // Snap feedback: the timeline time the edge snapped to (clip/playhead/marker),
  // or null when frame-snapped or not snapped. Drives the green snap line.
  snapIndicatorTime: number | null;
  isSnapping: boolean;
  // The resolved (snapped/frame-quantized) trim delta in seconds. Shared so the
  // live clip resize matches where the trim commits, and so multi-selected
  // followers can apply the same delta clamped to their own bounds.
  appliedDelta: number;
}

// Clip fade state (for fade-in/out handles)
export interface ClipFadeState {
  clipId: string;
  edge: 'left' | 'right';  // left = fade-in, right = fade-out
  startX: number;
  currentX: number;
  clipDuration: number;
  originalFadeDuration: number;  // Original fade duration when drag started
}

// In/Out marker drag state
export interface MarkerDragState {
  type: 'in' | 'out';
  startX: number;
  originalTime: number;
}

// External file drag preview state
export interface ExternalDragState {
  trackId: string;
  startTime: number;
  x: number;
  y: number;
  audioTrackId?: string;  // Preview for linked audio clip (when hovering video track)
  videoTrackId?: string;  // Preview for linked video clip (when hovering audio track)
  isVideo?: boolean;      // Is the dragged file a video?
  isAudio?: boolean;      // Is the dragged file audio-only?
  hasAudio?: boolean;     // Does the video file have audio tracks?
  duration?: number;      // Actual duration of dragged file
  label?: string;
  mediaType?: string;
  thumbnailUrl?: string;
  newTrackType?: 'video' | 'audio' | null;  // If hovering over "new track" drop zone
  showVideoNewTrackZone?: boolean; // True after dragging upward against the timeline top edge
}

// Context menu state for clip right-click
export interface ContextMenuState {
  x: number;
  y: number;
  clipId: string;
}

export interface TimelineEmptyContextMenuState {
  x: number;
  y: number;
  time: number;
  trackId: string;
}

// Marquee selection state for rectangle selection
export interface MarqueeState {
  mode?: 'marquee' | 'range';
  startX: number;      // Start X position relative to track-lanes
  startY: number;      // Start Y position relative to track-lanes
  currentX: number;    // Current X position
  currentY: number;    // Current Y position
  startScrollX: number; // ScrollX at the time of starting selection
  initialSelection: Set<string>; // Clips that were selected before marquee started (for shift+drag)
  initialKeyframeSelection: Set<string>; // Keyframes that were selected before marquee started
}

// Props for TimelineRuler component
export interface TimelineRulerCacheRange {
  start: number;
  end: number;
  type: 'proxy' | 'cache';
}

export interface TimelineRulerProps {
  duration: number;
  zoom: number;
  frameRate?: number | null;
  displayMode?: 'time' | 'frames';
  scrollX: number;
  onRulerMouseDown: (e: React.MouseEvent) => void;
  formatTime: (seconds: number) => string;
  cacheRanges?: TimelineRulerCacheRange[];
  videoBakeRegions?: VideoBakeRegion[];
  videoBakeRegionSelection?: TimelineVideoBakeRegionSelection | null;
}

// Props for TimelineControls component
export interface TimelineControlsProps {
  variant?: 'full' | 'main' | 'utility' | 'transport' | 'zoom';
  isPlaying: boolean;
  loopPlayback: boolean;
  playheadPosition: number;
  duration: number;
  zoom: number;
  snappingEnabled: boolean;
  inPoint: number | null;
  outPoint: number | null;
  proxyEnabled: boolean;
  currentlyGeneratingProxyId: string | null;
  mediaFilesWithProxy: number;
  mediaFilesProxyTotal: number;
  generatingProxyIndex: number;
  showTranscriptMarkers: boolean;
  thumbnailsEnabled: boolean;
  waveformsEnabled: boolean;
  audioDisplayMode: TimelineAudioDisplayMode;
  audioFocusMode: boolean;
  showAudioRegionEditMarkers: boolean;
  trackFocusMode: TimelineTrackFocusMode;
  toolMode: 'select' | 'cut';
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onToggleLoop: () => void;
  onSetZoom: (zoom: number) => void;
  onToggleSnapping: () => void;
  onToggleProxy: () => void;
  onToggleTranscriptMarkers: () => void;
  onToggleThumbnails: () => void;
  onToggleWaveforms: () => void;
  onSetAudioDisplayMode: (mode: TimelineAudioDisplayMode) => void;
  onToggleAudioFocusMode: () => void;
  onToggleAudioRegionEditMarkers: () => void;
  onSetTrackFocusMode: (mode: TimelineTrackFocusMode) => void;
  onToggleCutTool: () => void;
  onFitToWindow: () => void;
  onToggleSlotGrid: () => void;
  slotGridActive: boolean;
  formatTime: (seconds: number) => string;
}

// Props for TimelineHeader component
export interface TimelineHeaderProps {
  track: TimelineTrack;
  tracks: TimelineTrack[];  // All tracks for parenting target selection
  isDimmed: boolean;
  isExpanded: boolean;
  baseHeight: number;
  dynamicHeight: number;
  hasKeyframes: boolean;
  selectedClipIds: Set<string>;
  clips: TimelineClip[];
  playheadPosition: number;
  onToggleExpand: () => void;
  onToggleSolo: () => void;
  onToggleLocked?: () => void;
  onToggleMuted: () => void;
  onToggleVisible: () => void;
  onRenameTrack: (name: string) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onWheel: (e: React.WheelEvent) => void;
  onResizeStart?: (e: React.PointerEvent, trackId: string) => void;
  isResizeActive?: boolean;
  // For property labels - clipKeyframes map triggers re-render when keyframes change
  clipKeyframes: Map<string, Array<{ id: string; clipId: string; time: number; property: AnimatableProperty; value: number; easing: string }>>;
  getClipKeyframes: (clipId: string) => Array<{
    id: string;
    clipId: string;
    time: number;
    property: AnimatableProperty;
    value: number;
    easing: string;
  }>;
  // Keyframe controls
  getInterpolatedTransform: (clipId: string, clipLocalTime: number) => ClipTransform;
  getInterpolatedEffects: (clipId: string, clipLocalTime: number) => Array<{ id: string; type: string; name: string; params: Record<string, unknown> }>;
  addKeyframe: (clipId: string, property: AnimatableProperty, value: number) => void;
  setPlayheadPosition: (time: number) => void;
  setPropertyValue: (clipId: string, property: AnimatableProperty, value: number) => void;
  // Curve editor
  expandedCurveProperties: Map<string, Set<AnimatableProperty>>;
  onToggleCurveExpanded: (trackId: string, property: AnimatableProperty) => void;
  hoveredKeyframeRow?: { trackId: string; property: AnimatableProperty } | null;
  onKeyframeRowHover?: (trackId: string, property: AnimatableProperty, hovered: boolean) => void;
  audioLayerAdvancedMode?: boolean;
  showCollapsedAudioSummaryMeter?: boolean;
  // Track parenting (layer linking)
  onSetTrackParent: (trackId: string, parentTrackId: string | null) => void;
  onTrackPickWhipDragStart: (trackId: string, startX: number, startY: number) => void;
  onTrackPickWhipDragEnd: () => void;
}

// Props for TimelineTrack component
export interface TimelineTrackProps {
  track: TimelineTrack;
  trackColor?: string;
  clips: TimelineClip[];
  isDimmed: boolean;
  isExpanded: boolean;
  baseHeight: number;
  dynamicHeight: number;
  isDragTarget: boolean;
  isExternalDragTarget: boolean;
  selectedClipIds: Set<string>;
  selectedKeyframeIds: Set<string>;
  activeTimelineToolId: TimelineToolId;
  waveformsEnabled: boolean;
  audioDisplayMode: TimelineAudioDisplayMode;
  isClipDragActive: boolean;
  clipDrag: ClipDragState | null;
  clipDragPreview: TimelineClipDragPreview | null;
  clipTrim: ClipTrimState | null;
  clipFade: ClipFadeState | null;
  clipContextMenu: ContextMenuState | null;
  audioRegionSelection: TimelineAudioRegionSelection | null;
  audioRegionGainPreview: ClipAudioRegionGainPreview | null;
  audioSpectralRegionSelection: TimelineSpectralRegionSelection | null;
  videoBakeRegionSelection: TimelineVideoBakeRegionSelection | null;
  clipStemSeparationJobs: Record<string, ClipStemSeparationJobState>;
  externalDrag: ExternalDragState | null;
  zoom: number;
  scrollX: number;
  timelineRef: React.RefObject<HTMLDivElement | null>;
  onClipMouseDown: (e: React.MouseEvent, clipId: string) => void;
  onClipContextMenu: (e: React.MouseEvent, clipId: string) => void;
  onEmptyMouseDown: (e: React.MouseEvent, trackId: string, time: number) => void;
  onEmptyContextMenu: (e: React.MouseEvent, trackId: string, time: number) => void;
  onTrimStart: (e: React.MouseEvent, clipId: string, edge: 'left' | 'right') => void;
  onDrop: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnter: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onResizeStart?: (e: React.PointerEvent, trackId: string) => void;
  isResizeActive?: boolean;
  renderClip: (
    clip: TimelineClip,
    trackId: string,
    trackBaseHeightOverride?: number,
    options?: { passiveVisualsSuppressed?: boolean },
  ) => React.ReactNode;
  // For keyframe tracks - clipKeyframes map triggers re-render when keyframes change
  clipKeyframes: Map<string, Array<{ id: string; clipId: string; time: number; property: AnimatableProperty; value: number; easing: string }>>;
  renderKeyframeDiamonds: (trackId: string, property: AnimatableProperty) => React.ReactNode;
  timeToPixel: (time: number) => number;
  pixelToTime: (pixel: number) => number;
  // Curve editor
  expandedCurveProperties: Map<string, Set<AnimatableProperty>>;
  onSelectKeyframe: (keyframeId: string, addToSelection: boolean) => void;
  onMoveKeyframe: (keyframeId: string, newTime: number) => void;
  onUpdateBezierHandle: (keyframeId: string, handle: 'in' | 'out', position: BezierHandle) => void;
  addKeyframe: (clipId: string, property: AnimatableProperty, value: number, time?: number, easing?: string | null) => void;
}

// Pick whip drag state for layer parenting
export interface PickWhipDragState {
  sourceClipId: string;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

export interface ClipKeyframeTimeGroup {
  time: number;
  keyframeIds: string[];
  properties?: AnimatableProperty[];
  hasStateChange?: boolean;
}

// Props for TimelineClip component
export interface TimelineClipProps {
  clip: TimelineClip;
  trackId: string;
  track: TimelineTrack;
  trackBaseHeight: number;
  tracks: TimelineTrack[];
  clips: TimelineClip[];
  isSelected: boolean;
  isInLinkedGroup: boolean;  // True if clip has linkedGroupId (multicam)
  isDragging: boolean;
  isTrimming: boolean;
  isFading: boolean;  // True if this clip is being fade-adjusted
  isLinkedToDragging: boolean;
  isLinkedToTrimming: boolean;
  isTrimFollower?: boolean;  // Selected clip resizing live alongside a multi-trim
  isClipDragActive: boolean;
  clipDrag: ClipDragState | null;
  clipTrim: ClipTrimState | null;
  zoom: number;
  scrollX: number;
  timelineViewportWidth: number;
  proxyEnabled: boolean;
  proxyStatus: 'none' | 'generating' | 'ready' | 'error' | undefined;
  proxyProgress: number;
  audioProxyStatus: 'none' | 'generating' | 'ready' | 'error' | undefined;
  audioProxyProgress: number;
  showTranscriptMarkers: boolean;
  snappingEnabled: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onDoubleClick: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onTrimStart: (e: React.MouseEvent, edge: 'left' | 'right') => void;
  onFadeStart: (e: React.MouseEvent, edge: 'left' | 'right') => void;
  hasKeyframes: (clipId: string, property?: AnimatableProperty) => boolean;
  fadeInDuration: number;  // Current fade-in duration in seconds
  fadeOutDuration: number;  // Current fade-out duration in seconds
  opacityKeyframes: Array<{
    id: string;
    time: number;
    value: number;
    easing: string;
    handleIn?: { x: number; y: number };
    handleOut?: { x: number; y: number };
  }>;  // Opacity keyframes for fade curve visualization
  allKeyframeTimes: number[];  // Unique keyframe times for tick marks on clip bar
  keyframeTimeGroups?: ClipKeyframeTimeGroup[];  // Keyframe IDs grouped by clip-local time for global clip-bar handles
  onMoveKeyframeGroup?: (keyframeIds: string[], newTime: number) => void;
  timeToPixel: (time: number) => number;
  formatTime: (seconds: number) => string;
  passiveVisualsSuppressed?: boolean;
}

// Props for TimelineKeyframes component
export interface TimelineKeyframesProps {
  trackId: string;
  property: AnimatableProperty;
  clips: TimelineClip[];
  selectedKeyframeIds: Set<string>;
  clipKeyframes: Map<string, Array<{
    id: string;
    clipId: string;
    time: number;
    property: AnimatableProperty;
    value: number;
    easing: string;
    rotationInterpolation?: RotationInterpolationMode;
  }>>;
  clipDrag: ClipDragState | null;
  scrollX: number;
  timelineRef: React.RefObject<HTMLDivElement | null>;
  onSelectKeyframe: (keyframeId: string, addToSelection: boolean) => void;
  onMoveKeyframe: (keyframeId: string, newTime: number) => void;
  onUpdateKeyframe: (
    keyframeId: string,
    updates: { easing?: EasingType; rotationInterpolation?: RotationInterpolationMode },
  ) => void;
  onToggleCurveExpanded: (trackId: string, property: AnimatableProperty) => void;
  timeToPixel: (time: number) => number;
  pixelToTime: (pixel: number) => number;
  isRowHovered?: boolean;
  onKeyframeRowHover?: (trackId: string, property: AnimatableProperty, hovered: boolean) => void;
}

// Waveform props
export interface WaveformProps {
  waveform: number[];
  width: number;
  height: number;
}
