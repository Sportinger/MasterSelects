import type { AudioEditActions, StemSeparationActions } from './audioActionTypes';
import type { ClipboardActions, ClipboardState } from './clipboardTypes';
import type { ClipActions } from './clipActionTypes';
import type { MaskActions } from './maskActionTypes';
import type {
  PlaybackActions,
  TimelineEditOperationActions,
  TimelineToolActions,
} from './playbackActionTypes';
import type { TimelineState } from './timelineStateTypes';
import type { TrackActions } from './trackActionTypes';
import type {
  AIActionFeedbackActions,
  ExportActions,
  KeyframeActions,
  LayerActions,
  MarkerActions,
  NodeGraphActions,
  ProxyCacheActions,
  RamPreviewActions,
  RulerLaneActions,
  SelectionActions,
  TimelineUtils,
  TransitionActions,
  VideoBakeActions,
} from './utilityActionTypes';

export interface TimelineStore extends
  TimelineState,
  ClipboardState,
  TrackActions,
  ClipActions,
  PlaybackActions,
  TimelineToolActions,
  TimelineEditOperationActions,
  AudioEditActions,
  StemSeparationActions,
  VideoBakeActions,
  RamPreviewActions,
  ProxyCacheActions,
  ExportActions,
  SelectionActions,
  KeyframeActions,
  LayerActions,
  MaskActions,
  MarkerActions,
  RulerLaneActions,
  TransitionActions,
  NodeGraphActions,
  ClipboardActions,
  AIActionFeedbackActions,
  TimelineUtils {}

export type SliceCreator<T> = (
  set: (partial: Partial<TimelineStore> | ((state: TimelineStore) => Partial<TimelineStore>)) => void,
  get: () => TimelineStore
) => T;
