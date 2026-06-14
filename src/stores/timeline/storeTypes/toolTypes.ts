export type MaskEditMode =
  | 'none'
  | 'drawing'
  | 'editing'
  | 'drawingRect'
  | 'drawingEllipse'
  | 'drawingPen';

export type TimelineToolMode = 'select' | 'cut';

export type TimelineToolGroupId =
  | 'selection'
  | 'cut'
  | 'trim'
  | 'placement'
  | 'navigation';

export type TimelineToolKind = 'mode' | 'command';

export type TimelineToolId =
  | 'select'
  | 'track-select-forward'
  | 'track-select-backward'
  | 'track-select-forward-all'
  | 'range-select'
  | 'blade'
  | 'blade-all-tracks'
  | 'glue'
  | 'split-at-playhead'
  | 'split-all-at-playhead'
  | 'trim-start-to-playhead'
  | 'trim-end-to-playhead'
  | 'ripple-trim-start-to-playhead'
  | 'ripple-trim-end-to-playhead'
  | 'ripple-delete'
  | 'delete-gap'
  | 'lift-range'
  | 'extract-range'
  | 'edge-trim'
  | 'ripple-trim'
  | 'rolling-edit'
  | 'slip'
  | 'slide'
  | 'rate-stretch'
  | 'position-overwrite'
  | 'insert'
  | 'overwrite'
  | 'replace'
  | 'fit-to-fill'
  | 'append-at-end'
  | 'place-on-top'
  | 'ripple-overwrite'
  | 'hand'
  | 'zoom'
  | 'marker'
  | 'in-point'
  | 'out-point'
  | 'pen-keyframe'
  | 'midi-draw';

export type TimelineToolPreviewPlane = 'clip-local' | 'section-scrolled' | 'global-fixed';

export interface TimelineRangeSelection {
  startTime: number;
  endTime: number;
  trackIds: string[];
  anchorTrackId?: string;
}

export type TimelineToolPreviewGhostVariant =
  | 'trim-target'
  | 'ripple-shift'
  | 'rolling-neighbor'
  | 'rate-stretch'
  | 'transition-drop'
  | 'transition-source-handle'
  | 'transition-real-handle'
  | 'transition-hold-fallback';

export interface TimelineToolPreviewGhostRange {
  id: string;
  trackId: string;
  startTime: number;
  endTime: number;
  label?: string;
  variant?: TimelineToolPreviewGhostVariant;
}

export interface TimelineToolPreview {
  toolId: TimelineToolId;
  plane: TimelineToolPreviewPlane;
  trackId?: string;
  trackIds?: string[];
  clipId?: string;
  time?: number;
  startTime?: number;
  endTime?: number;
  sourceInPoint?: number;
  sourceOutPoint?: number;
  label?: string;
  blocked?: boolean;
  message?: string;
  ghostRanges?: TimelineToolPreviewGhostRange[];
  zIndex?: number;
}

export interface TimelineTransitionEditPreview {
  clipId: string;
  edge: 'in' | 'out';
  transitionId: string;
  duration: number;
  offset: number;
}

export type LastTimelineToolByGroup = Record<TimelineToolGroupId, TimelineToolId>;

export interface TimelineClipDragPreviewPatch {
  startTime: number;
  trackId?: string;
}

export interface TimelineClipDragPreview {
  patches: Record<string, TimelineClipDragPreviewPatch>;
}

export type TimelineAudioDisplayMode = 'compact' | 'detailed' | 'spectral';
export type TimelineTrackFocusMode = 'balanced' | 'audio' | 'video';

export type TimelinePropertiesSelection =
  | { kind: 'clip'; clipId: string }
  | { kind: 'transition'; clipId: string; edge: 'in' | 'out'; transitionId: string }
  | { kind: 'track'; trackId: string }
  | { kind: 'master' }
  | null;
