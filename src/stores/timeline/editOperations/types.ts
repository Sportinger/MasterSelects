import type { TimelineClip, TimelineTrack } from '../../../types';

export type TimelineEditOperationSource =
  | 'ui'
  | 'shortcut'
  | 'context-menu'
  | 'ai-tool'
  | 'guided-replay'
  | 'external-drop';

export type TimelineEditWarningCode =
  | 'export-locked'
  | 'clip-not-found'
  | 'clip-locked'
  | 'track-locked'
  | 'invalid-time'
  | 'invalid-range'
  | 'no-op'
  | 'unsupported';

export interface TimelineEditWarning {
  code: TimelineEditWarningCode;
  message: string;
  clipId?: string;
  trackId?: string;
}

export interface ApplyTimelineEditOperationOptions {
  source: TimelineEditOperationSource;
  historyLabel?: string;
  previewOnly?: boolean;
  signal?: AbortSignal;
}

export interface TimelineEditResult {
  success: boolean;
  operationId: string;
  changedClipIds: string[];
  selectedClipIds?: string[];
  warnings: TimelineEditWarning[];
}

export interface TimelineEditScope {
  trackIds?: string[];
  linkedPairPolicy?: 'ignore' | 'include' | 'preserve-sync' | 'selection-dependent';
  linkedGroupPolicy?: 'ignore' | 'include' | 'preserve-offsets' | 'selection-dependent';
  lockedTrackPolicy?: 'skip' | 'block-operation';
  hiddenTrackPolicy?: 'skip' | 'include';
  mutedAudioPolicy?: 'include' | 'skip';
  rippleMode?: 'none' | 'track' | 'all-unlocked' | 'linked-groups';
  collisionMode?:
    | 'avoid'
    | 'overwrite-by-trim-delete'
    | 'transition-overlap'
    | 'ripple-insert'
    | 'ripple-delete'
    | 'gap-only'
    | 'preview-only';
  selectionAfterOperation?: 'preserve' | 'select-created' | 'select-affected' | 'clear';
}

export interface TimelineEditOperationBase {
  id: string;
  scope?: TimelineEditScope;
}

export interface SplitAtTimeOperation extends TimelineEditOperationBase {
  type: 'split-at-time';
  clipIds: string[];
  time: number;
  includeLinked?: boolean;
}

export interface SplitAllAtTimeOperation extends TimelineEditOperationBase {
  type: 'split-all-at-time';
  time: number;
  trackIds?: string[];
  includeLinked?: boolean;
}

export interface SplitAtTimesOperation extends TimelineEditOperationBase {
  type: 'split-at-times';
  clipId: string;
  times: number[];
  includeLinked?: boolean;
}

export interface MergeMidiClipsOperation extends TimelineEditOperationBase {
  type: 'merge-midi-clips';
  /** The clicked (anchor) MIDI clip; merges with the next clip on its track. */
  clipId: string;
  /** Alt-click: glue the anchor with EVERY following MIDI clip on the track. */
  allFollowing?: boolean;
}

export interface SelectClipsFromTimeOperation extends TimelineEditOperationBase {
  type: 'select-clips-from-time';
  time: number;
  trackIds?: string[];
  direction: 'forward' | 'backward';
  includeLinked?: boolean;
}

export interface RippleDeleteSelectionOperation extends TimelineEditOperationBase {
  type: 'ripple-delete-selection';
  clipIds?: string[];
  includeLinked?: boolean;
}

export interface DeleteClipsOperation extends TimelineEditOperationBase {
  type: 'delete-clips';
  clipIds: string[];
  includeLinked?: boolean;
}

export interface DeleteGapAtTimeOperation extends TimelineEditOperationBase {
  type: 'delete-gap-at-time';
  time: number;
  trackIds?: string[];
}

export interface DeleteAllGapsOperation extends TimelineEditOperationBase {
  type: 'delete-all-gaps';
  trackIds?: string[];
  startTime?: number;
}

export interface TimelineClipMove {
  clipId: string;
  startTime: number;
  trackId?: string;
}

export interface MoveClipsOperation extends TimelineEditOperationBase {
  type: 'move-clips';
  moves: TimelineClipMove[];
  includeLinked?: boolean;
}

export interface TrimClipOperation extends TimelineEditOperationBase {
  type: 'trim-clip';
  clipId: string;
  inPoint: number;
  outPoint: number;
  startTime?: number;
  includeLinked?: boolean;
  // Additional clips trimmed in the same gesture (multi-select trim). Each is
  // clamped to its own bounds by the caller; applied in the same history batch.
  extraClips?: Array<{
    clipId: string;
    inPoint: number;
    outPoint: number;
    startTime?: number;
  }>;
}

export interface TrimEdgeToTimeOperation extends TimelineEditOperationBase {
  type: 'trim-edge-to-time';
  edge: 'start' | 'end';
  time: number;
  clipIds?: string[];
  includeLinked?: boolean;
}

export interface RippleTrimEdgeToTimeOperation extends TimelineEditOperationBase {
  type: 'ripple-trim-edge-to-time';
  edge: 'start' | 'end';
  time: number;
  clipIds?: string[];
  includeLinked?: boolean;
}

export interface RollingEditOperation extends TimelineEditOperationBase {
  type: 'rolling-edit';
  clipId: string;
  edge: 'start' | 'end';
  time: number;
  includeLinked?: boolean;
}

export interface SlipClipOperation extends TimelineEditOperationBase {
  type: 'slip-clip';
  clipId: string;
  sourceDelta: number;
  includeLinked?: boolean;
}

export interface SlideClipOperation extends TimelineEditOperationBase {
  type: 'slide-clip';
  clipId: string;
  timelineDelta: number;
  includeLinked?: boolean;
}

export interface RateStretchClipOperation extends TimelineEditOperationBase {
  type: 'rate-stretch-clip';
  clipId: string;
  edge: 'start' | 'end';
  time: number;
  includeLinked?: boolean;
  preservesPitch?: boolean;
}

export type TimelinePlacementMode =
  | 'position-overwrite'
  | 'insert'
  | 'overwrite'
  | 'replace'
  | 'fit-to-fill'
  | 'append-at-end'
  | 'place-on-top'
  | 'ripple-overwrite';

export interface PlaceTimelineRangeOperation extends TimelineEditOperationBase {
  type: 'place-timeline-range';
  mode: TimelinePlacementMode;
  trackIds?: string[];
  startTime?: number;
  duration?: number;
  targetClipId?: string;
  includeLinked?: boolean;
  rippleDelta?: number;
}

export interface TimelineRangeOperationRange {
  startTime: number;
  endTime: number;
  trackIds: string[];
}

export interface LiftRangeOperation extends TimelineEditOperationBase {
  type: 'lift-range';
  range?: TimelineRangeOperationRange;
  includeLinked?: boolean;
}

export interface ExtractRangeOperation extends TimelineEditOperationBase {
  type: 'extract-range';
  range?: TimelineRangeOperationRange;
  includeLinked?: boolean;
}

export type TimelineEditOperation =
  | SplitAtTimeOperation
  | SplitAllAtTimeOperation
  | SplitAtTimesOperation
  | MergeMidiClipsOperation
  | SelectClipsFromTimeOperation
  | RippleDeleteSelectionOperation
  | DeleteClipsOperation
  | DeleteGapAtTimeOperation
  | DeleteAllGapsOperation
  | MoveClipsOperation
  | TrimClipOperation
  | TrimEdgeToTimeOperation
  | RippleTrimEdgeToTimeOperation
  | RollingEditOperation
  | SlipClipOperation
  | SlideClipOperation
  | RateStretchClipOperation
  | PlaceTimelineRangeOperation
  | LiftRangeOperation
  | ExtractRangeOperation;

export interface TimelineEditOperationContext {
  clips: TimelineClip[];
  tracks: TimelineTrack[];
  selectedClipIds: Set<string>;
  playheadPosition: number;
}
