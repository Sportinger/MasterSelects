import type {
  AnimatableProperty,
  BezierHandle,
  BlendMode,
  EasingType,
  MaskPathKeyframeValue,
  RotationInterpolationMode,
} from '../../../types';
import type { TransitionParamValue } from '../../../transitions';
import type { TimelineEditOperationSource } from './types';

export type TimelineEditContractPlainValue =
  | null
  | string
  | number
  | boolean
  | readonly TimelineEditContractPlainValue[]
  | { readonly [key: string]: TimelineEditContractPlainValue | undefined };

export type TimelineEditTransactionPhase = 'begin' | 'update' | 'commit' | 'cancel';

export type TimelinePointerModifier = 'alt' | 'ctrl' | 'meta' | 'shift';

export interface TimelineEditPointerSnapshot {
  clientX: number;
  clientY: number;
  timelineTime: number;
  trackId?: string;
  modifiers?: readonly TimelinePointerModifier[];
}

export interface TimelineGeometryRectReference {
  geometrySnapshotId: string;
  rectId: string;
  kind:
    | 'track-lane'
    | 'clip-body'
    | 'trim-handle'
    | 'fade-handle'
    | 'keyframe-row'
    | 'keyframe-diamond'
    | 'transition-junction'
    | 'transition-drop-zone'
    | 'transition-body'
    | 'marquee-exclusion'
    | 'drop-target';
}

export interface TimelineEditTransactionBase {
  id: string;
  type: string;
  transactionId: string;
  historyBatchId: string;
  source: TimelineEditOperationSource;
  geometrySnapshotId?: string;
  pointer?: TimelineEditPointerSnapshot;
}

export type MoveClipsParityField =
  | 'snapping'
  | 'resistance'
  | 'fallbackTrackCreation'
  | 'overlapTrimming'
  | 'linkedClips'
  | 'linkedGroups'
  | 'selectedLinkedPairs';

export const MOVE_CLIPS_PARITY_KEYS = [
  'snapping',
  'resistance',
  'fallbackTrackCreation',
  'overlapTrimming',
  'linkedClips',
  'linkedGroups',
  'selectedLinkedPairs',
] as const satisfies readonly MoveClipsParityField[];

export type MoveClipsParityStatus = 'required' | 'not-applicable' | 'implemented' | 'verified';

export type MoveClipsParityChecklist = {
  readonly [K in MoveClipsParityField]: MoveClipsParityStatus;
};

export interface ClipMoveSnapResolution {
  enabled: boolean;
  snapped: boolean;
  requestedStartTime: number;
  resolvedStartTime: number;
  source?: 'none' | 'grid' | 'clip-edge' | 'playhead' | 'marker' | 'frame' | 'manual';
  snapIndicatorTime?: number | null;
  thresholdPx?: number;
}

export interface ClipMoveResistanceResolution {
  mode: 'none' | 'track-change-delay' | 'overlap-push-through' | 'edge-clamp' | 'new-track-zone';
  applied: boolean;
  forcingOverlap?: boolean;
  blockedReason?: 'locked-track' | 'incompatible-track' | 'pending-track-delay' | 'export-locked';
}

export interface ClipMoveFallbackTrackResolution {
  createFallbackTrack: boolean;
  requestedNewTrackType?: 'video' | 'audio' | null;
  fallbackTrackType?: 'video' | 'audio';
  provisionalTrackId?: string;
  insertionIndex?: number;
  reason?: 'drag-beyond-stack' | 'missing-compatible-track' | 'explicit-new-track-zone';
}

export interface ClipMoveOverlapTrimResolution {
  mode: 'none' | 'prevent' | 'trim-overlapped' | 'delete-covered' | 'split-and-trim';
  overlappedClipIds: readonly string[];
  trimClipIds: readonly string[];
  deleteClipIds: readonly string[];
}

export interface ClipMoveLinkedResolution {
  includeLinked: boolean;
  linkedClipIds: readonly string[];
  skippedLinkedClipIds: readonly string[];
  reason?: 'alt-unlink' | 'missing-linked-clip' | 'already-selected' | 'policy-disabled';
}

export interface ClipMoveGroupResolution {
  includeGroups: boolean;
  linkedGroupIds: readonly string[];
  groupClipIds: readonly string[];
  skippedGroupClipIds: readonly string[];
}

export interface ClipMoveSelectedLinkedPairResolution {
  selectedPairClipIds: readonly string[];
  dedupedClipIds: readonly string[];
  preservedOffsets: boolean;
}

export interface ResolvedClipMove {
  clipId: string;
  originalStartTime: number;
  originalTrackId: string;
  requestedStartTime: number;
  requestedTrackId?: string;
  resolvedStartTime: number;
  resolvedTrackId: string;
  timelineDelta: number;
  sourceDelta?: number;
  isLeadClip: boolean;
  snapping: ClipMoveSnapResolution;
  resistance: ClipMoveResistanceResolution;
  fallbackTrack: ClipMoveFallbackTrackResolution;
  overlap: ClipMoveOverlapTrimResolution;
  linked: ClipMoveLinkedResolution;
  linkedGroup: ClipMoveGroupResolution;
  selectedLinkedPair: ClipMoveSelectedLinkedPairResolution;
}

export interface MoveClipsResolvedOperation extends TimelineEditTransactionBase {
  type: 'move-clips-resolved';
  requestedClipIds: readonly string[];
  resolvedMoves: readonly ResolvedClipMove[];
  parity: MoveClipsParityChecklist;
}

export type FadeEdge = 'left' | 'right';

export interface FadeKeyframePlan {
  clipId: string;
  property: AnimatableProperty;
  edge: FadeEdge;
  duration: number;
  zeroKeyframeId?: string;
  oneKeyframeId?: string;
  createdKeyframeIds: readonly string[];
  movedKeyframeIds: readonly string[];
  removedKeyframeIds: readonly string[];
  audioVolumeEffectId?: string;
}

export interface FadeTransactionBeginOperation extends TimelineEditTransactionBase {
  type: 'fade-transaction-begin';
  phase: 'begin';
  clipId: string;
  edge: FadeEdge;
  originalFadeDuration: number;
  clipDuration: number;
  property: AnimatableProperty;
  handleRect?: TimelineGeometryRectReference;
}

export interface FadeTransactionUpdateOperation extends TimelineEditTransactionBase {
  type: 'fade-transaction-update';
  phase: 'update';
  clipId: string;
  edge: FadeEdge;
  requestedFadeDuration: number;
  resolvedFadeDuration: number;
  keyframePlan: FadeKeyframePlan;
}

export interface FadeTransactionCommitOperation extends TimelineEditTransactionBase {
  type: 'fade-transaction-commit';
  phase: 'commit';
  clipId: string;
  edge: FadeEdge;
  finalFadeDuration: number;
  keyframePlan: FadeKeyframePlan;
}

export interface FadeTransactionCancelOperation extends TimelineEditTransactionBase {
  type: 'fade-transaction-cancel';
  phase: 'cancel';
  clipId: string;
  edge: FadeEdge;
  restoreKeyframeIds: readonly string[];
  discardKeyframeIds: readonly string[];
}

export type FadeTransactionOperation =
  | FadeTransactionBeginOperation
  | FadeTransactionUpdateOperation
  | FadeTransactionCommitOperation
  | FadeTransactionCancelOperation;

export interface KeyframeGeometryReference {
  geometrySnapshotId: string;
  clipId: string;
  property: AnimatableProperty;
  rowRect?: TimelineGeometryRectReference;
  diamondRect?: TimelineGeometryRectReference;
}

export interface KeyframeValuePayload {
  value?: number;
  pathValue?: MaskPathKeyframeValue;
}

export interface KeyframeCreateOperation {
  type: 'keyframe-create';
  clipId: string;
  property: AnimatableProperty;
  time: number;
  value: KeyframeValuePayload;
  easing: EasingType;
}

export interface KeyframeMoveOperation {
  type: 'keyframe-move';
  keyframeId: string;
  clipId: string;
  property: AnimatableProperty;
  originalTime: number;
  requestedTime: number;
  resolvedTime: number;
  value?: KeyframeValuePayload;
}

export interface KeyframeUpdateValueOperation {
  type: 'keyframe-update-value';
  keyframeId: string;
  clipId: string;
  property: AnimatableProperty;
  value: KeyframeValuePayload;
}

export interface KeyframeRemoveOperation {
  type: 'keyframe-remove';
  keyframeId: string;
  clipId: string;
  property: AnimatableProperty;
}

export interface KeyframeUpdateEasingOperation {
  type: 'keyframe-update-easing';
  keyframeId: string;
  clipId: string;
  property: AnimatableProperty;
  easing: EasingType;
}

export interface KeyframeUpdateBezierHandleOperation {
  type: 'keyframe-update-bezier-handle';
  keyframeId: string;
  clipId: string;
  property: AnimatableProperty;
  handle: 'in' | 'out';
  position: BezierHandle;
}

export interface KeyframeUpdateRotationInterpolationOperation {
  type: 'keyframe-update-rotation-interpolation';
  keyframeId: string;
  clipId: string;
  property: AnimatableProperty;
  rotationInterpolation: RotationInterpolationMode;
}

export interface KeyframeSelectionOperation {
  type: 'keyframe-select';
  selectedKeyframeIds: readonly string[];
  mode: 'replace' | 'add' | 'remove' | 'toggle' | 'clear';
}

export type KeyframeEditOperation =
  | KeyframeCreateOperation
  | KeyframeMoveOperation
  | KeyframeUpdateValueOperation
  | KeyframeRemoveOperation
  | KeyframeUpdateEasingOperation
  | KeyframeUpdateBezierHandleOperation
  | KeyframeUpdateRotationInterpolationOperation
  | KeyframeSelectionOperation;

export const KEYFRAME_EDIT_OPERATION_TYPES = [
  'keyframe-create',
  'keyframe-move',
  'keyframe-update-value',
  'keyframe-remove',
  'keyframe-update-easing',
  'keyframe-update-bezier-handle',
  'keyframe-update-rotation-interpolation',
  'keyframe-select',
] as const satisfies readonly KeyframeEditOperation['type'][];

export interface KeyframeTransactionBaseOperation extends TimelineEditTransactionBase {
  clipId: string;
  property?: AnimatableProperty;
  keyframeIds: readonly string[];
  geometry?: KeyframeGeometryReference;
}

export interface KeyframeTransactionBeginOperation extends KeyframeTransactionBaseOperation {
  type: 'keyframe-transaction-begin';
  phase: 'begin';
  intent: 'drag-diamond' | 'curve-editor' | 'marquee' | 'property-row' | 'keyboard' | 'timeline-tool';
}

export interface KeyframeTransactionUpdateOperation extends KeyframeTransactionBaseOperation {
  type: 'keyframe-transaction-update';
  phase: 'update';
  operations: readonly KeyframeEditOperation[];
}

export interface KeyframeTransactionCommitOperation extends KeyframeTransactionBaseOperation {
  type: 'keyframe-transaction-commit';
  phase: 'commit';
  operations: readonly KeyframeEditOperation[];
}

export interface KeyframeTransactionCancelOperation extends KeyframeTransactionBaseOperation {
  type: 'keyframe-transaction-cancel';
  phase: 'cancel';
  restoreKeyframeIds: readonly string[];
  discardKeyframeIds: readonly string[];
}

export type KeyframeTransactionOperation =
  | KeyframeTransactionBeginOperation
  | KeyframeTransactionUpdateOperation
  | KeyframeTransactionCommitOperation
  | KeyframeTransactionCancelOperation;

export interface TransitionJunctionGeometryReference {
  geometrySnapshotId: string;
  trackId: string;
  clipAId: string;
  clipBId: string;
  junctionTime: number;
  junctionRect: TimelineGeometryRectReference;
  dropZoneRect: TimelineGeometryRectReference;
  transitionBodyRect?: TimelineGeometryRectReference;
  thresholdSeconds: number;
  thresholdPx?: number;
}

export interface TransitionApplyOperation extends TimelineEditTransactionBase {
  type: 'transition-apply';
  clipAId: string;
  clipBId: string;
  transitionType: string;
  requestedDuration: number;
  resolvedDuration?: number;
  params?: Record<string, TransitionParamValue>;
  junction: TransitionJunctionGeometryReference;
}

export interface TransitionRemoveOperation extends TimelineEditTransactionBase {
  type: 'transition-remove';
  clipId: string;
  edge: 'in' | 'out';
  transitionId?: string;
}

export interface TransitionUpdateDurationOperation extends TimelineEditTransactionBase {
  type: 'transition-update-duration';
  clipId: string;
  edge: 'in' | 'out';
  transitionId?: string;
  requestedDuration: number;
  resolvedDuration?: number;
  junction?: TransitionJunctionGeometryReference;
}

export interface TransitionUpdateOffsetOperation extends TimelineEditTransactionBase {
  type: 'transition-update-offset';
  clipId: string;
  edge: 'in' | 'out';
  transitionId?: string;
  requestedOffset: number;
  resolvedOffset?: number;
  junction?: TransitionJunctionGeometryReference;
}

export interface TransitionUpdateTypeOperation extends TimelineEditTransactionBase {
  type: 'transition-update-type';
  clipId: string;
  edge: 'in' | 'out';
  transitionId?: string;
  transitionType: string;
  params?: Record<string, TransitionParamValue>;
}

export interface TransitionUpdateParamsOperation extends TimelineEditTransactionBase {
  type: 'transition-update-params';
  clipId: string;
  edge: 'in' | 'out';
  transitionId?: string;
  params: Record<string, TransitionParamValue>;
}

export interface TransitionPreviewDropOperation extends TimelineEditTransactionBase {
  type: 'transition-preview-drop';
  transitionType: string;
  requestedDuration: number;
  junction: TransitionJunctionGeometryReference | null;
}

export interface TransitionClearPreviewOperation extends TimelineEditTransactionBase {
  type: 'transition-clear-preview';
  reason: 'drop-complete' | 'drag-leave' | 'invalid-drop' | 'cancel';
}

export type TransitionEditOperation =
  | TransitionApplyOperation
  | TransitionRemoveOperation
  | TransitionUpdateDurationOperation
  | TransitionUpdateOffsetOperation
  | TransitionUpdateTypeOperation
  | TransitionUpdateParamsOperation
  | TransitionPreviewDropOperation
  | TransitionClearPreviewOperation;

export interface KeyboardDeleteCommandOperation extends TimelineEditTransactionBase {
  type: 'keyboard-delete-command';
  command: 'delete';
  priority: 'keyframes-first' | 'clips-only' | 'keyframes-only';
  keyframeIds: readonly string[];
  clipIds: readonly string[];
  includeLinked?: boolean;
}

export interface KeyboardCycleBlendModeCommandOperation extends TimelineEditTransactionBase {
  type: 'keyboard-cycle-blend-mode-command';
  command: 'cycle-blend-mode';
  clipIds: readonly string[];
  direction: 'next' | 'previous';
  anchorClipId: string;
  currentBlendMode: BlendMode;
  nextBlendMode: BlendMode;
  blendModeSequence: readonly BlendMode[];
}

export type KeyboardEditCommandOperation =
  | KeyboardDeleteCommandOperation
  | KeyboardCycleBlendModeCommandOperation;

export type TimelineEditTransactionOperation =
  | MoveClipsResolvedOperation
  | FadeTransactionOperation
  | KeyframeTransactionOperation
  | TransitionEditOperation
  | KeyboardEditCommandOperation;

export type TimelineEditTransactionOperationType = TimelineEditTransactionOperation['type'];

export const TIMELINE_EDIT_TRANSACTION_OPERATION_TYPES = [
  'move-clips-resolved',
  'fade-transaction-begin',
  'fade-transaction-update',
  'fade-transaction-commit',
  'fade-transaction-cancel',
  'keyframe-transaction-begin',
  'keyframe-transaction-update',
  'keyframe-transaction-commit',
  'keyframe-transaction-cancel',
  'transition-apply',
  'transition-remove',
  'transition-update-duration',
  'transition-update-offset',
  'transition-update-type',
  'transition-update-params',
  'transition-preview-drop',
  'transition-clear-preview',
  'keyboard-delete-command',
  'keyboard-cycle-blend-mode-command',
] as const satisfies readonly TimelineEditTransactionOperationType[];
