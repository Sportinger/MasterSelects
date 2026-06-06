import { describe, expect, it } from 'vitest';

import {
  KEYFRAME_EDIT_OPERATION_TYPES,
  MOVE_CLIPS_PARITY_KEYS,
  TIMELINE_EDIT_TRANSACTION_OPERATION_TYPES,
  type KeyframeEditOperation,
  type MoveClipsParityChecklist,
  type TimelineEditContractPlainValue,
  type TimelineEditTransactionOperation,
} from '../../src/stores/timeline/editOperations/transactionTypes';

const parityChecklist = {
  snapping: 'required',
  resistance: 'required',
  fallbackTrackCreation: 'required',
  overlapTrimming: 'required',
  linkedClips: 'required',
  linkedGroups: 'required',
  selectedLinkedPairs: 'required',
} as const satisfies MoveClipsParityChecklist;

const base = {
  id: 'operation-1',
  transactionId: 'transaction-1',
  historyBatchId: 'history-batch-1',
  source: 'ui',
  geometrySnapshotId: 'geometry-1',
} as const;

const fadeKeyframePlan = {
  clipId: 'clip-1',
  property: 'opacity',
  edge: 'left',
  duration: 1.25,
  createdKeyframeIds: ['kf-1', 'kf-2'],
  movedKeyframeIds: [],
  removedKeyframeIds: [],
} as const;

const keyframeGeometry = {
  geometrySnapshotId: 'geometry-1',
  clipId: 'clip-1',
  property: 'opacity',
  rowRect: {
    geometrySnapshotId: 'geometry-1',
    rectId: 'keyframe-row-1',
    kind: 'keyframe-row',
  },
  diamondRect: {
    geometrySnapshotId: 'geometry-1',
    rectId: 'keyframe-diamond-1',
    kind: 'keyframe-diamond',
  },
} as const;

const transitionJunction = {
  geometrySnapshotId: 'geometry-1',
  trackId: 'video-1',
  clipAId: 'clip-a',
  clipBId: 'clip-b',
  junctionTime: 10,
  junctionRect: {
    geometrySnapshotId: 'geometry-1',
    rectId: 'transition-junction-1',
    kind: 'transition-junction',
  },
  dropZoneRect: {
    geometrySnapshotId: 'geometry-1',
    rectId: 'transition-drop-zone-1',
    kind: 'transition-drop-zone',
  },
  transitionBodyRect: {
    geometrySnapshotId: 'geometry-1',
    rectId: 'transition-body-1',
    kind: 'transition-body',
  },
  thresholdSeconds: 0.5,
  thresholdPx: 24,
} as const;

const sampleTransactionOperations = [
  {
    ...base,
    type: 'move-clips-resolved',
    requestedClipIds: ['clip-1'],
    parity: parityChecklist,
    resolvedMoves: [
      {
        clipId: 'clip-1',
        originalStartTime: 1,
        originalTrackId: 'video-1',
        requestedStartTime: 3.1,
        requestedTrackId: 'video-2',
        resolvedStartTime: 3,
        resolvedTrackId: 'video-2',
        timelineDelta: 2,
        isLeadClip: true,
        snapping: {
          enabled: true,
          snapped: true,
          requestedStartTime: 3.1,
          resolvedStartTime: 3,
          source: 'grid',
          snapIndicatorTime: 3,
          thresholdPx: 10,
        },
        resistance: {
          mode: 'overlap-push-through',
          applied: true,
          forcingOverlap: false,
        },
        fallbackTrack: {
          createFallbackTrack: true,
          requestedNewTrackType: 'video',
          fallbackTrackType: 'video',
          provisionalTrackId: 'video-new',
          insertionIndex: 0,
          reason: 'drag-beyond-stack',
        },
        overlap: {
          mode: 'trim-overlapped',
          overlappedClipIds: ['clip-2'],
          trimClipIds: ['clip-2'],
          deleteClipIds: [],
        },
        linked: {
          includeLinked: true,
          linkedClipIds: ['audio-1'],
          skippedLinkedClipIds: [],
        },
        linkedGroup: {
          includeGroups: true,
          linkedGroupIds: ['group-1'],
          groupClipIds: ['clip-1', 'audio-1'],
          skippedGroupClipIds: [],
        },
        selectedLinkedPair: {
          selectedPairClipIds: ['clip-1', 'audio-1'],
          dedupedClipIds: ['clip-1'],
          preservedOffsets: true,
        },
      },
    ],
  },
  {
    ...base,
    type: 'fade-transaction-begin',
    phase: 'begin',
    clipId: 'clip-1',
    edge: 'left',
    originalFadeDuration: 0,
    clipDuration: 6,
    property: 'opacity',
    handleRect: {
      geometrySnapshotId: 'geometry-1',
      rectId: 'fade-left-1',
      kind: 'fade-handle',
    },
  },
  {
    ...base,
    type: 'fade-transaction-update',
    phase: 'update',
    clipId: 'clip-1',
    edge: 'left',
    requestedFadeDuration: 1.4,
    resolvedFadeDuration: 1.25,
    keyframePlan: fadeKeyframePlan,
  },
  {
    ...base,
    type: 'fade-transaction-commit',
    phase: 'commit',
    clipId: 'clip-1',
    edge: 'left',
    finalFadeDuration: 1.25,
    keyframePlan: fadeKeyframePlan,
  },
  {
    ...base,
    type: 'fade-transaction-cancel',
    phase: 'cancel',
    clipId: 'clip-1',
    edge: 'left',
    restoreKeyframeIds: ['kf-original'],
    discardKeyframeIds: ['kf-temp'],
  },
  {
    ...base,
    type: 'keyframe-transaction-begin',
    phase: 'begin',
    clipId: 'clip-1',
    property: 'opacity',
    keyframeIds: ['kf-1'],
    geometry: keyframeGeometry,
    intent: 'drag-diamond',
  },
  {
    ...base,
    type: 'keyframe-transaction-update',
    phase: 'update',
    clipId: 'clip-1',
    property: 'opacity',
    keyframeIds: ['kf-1'],
    geometry: keyframeGeometry,
    operations: [
      {
        type: 'keyframe-move',
        keyframeId: 'kf-1',
        clipId: 'clip-1',
        property: 'opacity',
        originalTime: 1,
        requestedTime: 1.5,
        resolvedTime: 1.5,
        value: { value: 0.75 },
      },
    ],
  },
  {
    ...base,
    type: 'keyframe-transaction-commit',
    phase: 'commit',
    clipId: 'clip-1',
    property: 'opacity',
    keyframeIds: ['kf-1'],
    operations: [
      {
        type: 'keyframe-update-easing',
        keyframeId: 'kf-1',
        clipId: 'clip-1',
        property: 'opacity',
        easing: 'ease-in',
      },
    ],
  },
  {
    ...base,
    type: 'keyframe-transaction-cancel',
    phase: 'cancel',
    clipId: 'clip-1',
    property: 'opacity',
    keyframeIds: ['kf-1'],
    restoreKeyframeIds: ['kf-original'],
    discardKeyframeIds: ['kf-temp'],
  },
  {
    ...base,
    type: 'transition-apply',
    clipAId: 'clip-a',
    clipBId: 'clip-b',
    transitionType: 'cross-dissolve',
    requestedDuration: 1,
    resolvedDuration: 0.75,
    junction: transitionJunction,
  },
  {
    ...base,
    type: 'transition-remove',
    clipId: 'clip-a',
    edge: 'out',
    transitionId: 'transition-1',
  },
  {
    ...base,
    type: 'transition-update-duration',
    clipId: 'clip-a',
    edge: 'out',
    transitionId: 'transition-1',
    requestedDuration: 1.5,
    resolvedDuration: 1,
    junction: transitionJunction,
  },
  {
    ...base,
    type: 'transition-preview-drop',
    transitionType: 'cross-dissolve',
    requestedDuration: 1,
    junction: transitionJunction,
  },
  {
    ...base,
    type: 'transition-clear-preview',
    reason: 'drag-leave',
  },
  {
    ...base,
    type: 'keyboard-delete-command',
    command: 'delete',
    priority: 'keyframes-first',
    keyframeIds: ['kf-1'],
    clipIds: ['clip-1'],
    includeLinked: true,
  },
  {
    ...base,
    type: 'keyboard-cycle-blend-mode-command',
    command: 'cycle-blend-mode',
    clipIds: ['clip-1', 'clip-2'],
    direction: 'next',
    anchorClipId: 'clip-1',
    currentBlendMode: 'normal',
    nextBlendMode: 'multiply',
    blendModeSequence: ['normal', 'multiply'],
  },
] as const satisfies readonly (TimelineEditTransactionOperation & TimelineEditContractPlainValue)[];

function assertNever(value: never): never {
  throw new Error(`Unhandled operation: ${JSON.stringify(value)}`);
}

function getTransactionOperationType(operation: TimelineEditTransactionOperation): TimelineEditTransactionOperation['type'] {
  switch (operation.type) {
    case 'move-clips-resolved':
    case 'fade-transaction-begin':
    case 'fade-transaction-update':
    case 'fade-transaction-commit':
    case 'fade-transaction-cancel':
    case 'keyframe-transaction-begin':
    case 'keyframe-transaction-update':
    case 'keyframe-transaction-commit':
    case 'keyframe-transaction-cancel':
    case 'transition-apply':
    case 'transition-remove':
    case 'transition-update-duration':
    case 'transition-preview-drop':
    case 'transition-clear-preview':
    case 'keyboard-delete-command':
    case 'keyboard-cycle-blend-mode-command':
      return operation.type;
    default:
      return assertNever(operation);
  }
}

describe('timeline edit operation transaction contracts', () => {
  it('publishes all transaction operation discriminants exactly once', () => {
    const exhaustiveMap = {
      'move-clips-resolved': true,
      'fade-transaction-begin': true,
      'fade-transaction-update': true,
      'fade-transaction-commit': true,
      'fade-transaction-cancel': true,
      'keyframe-transaction-begin': true,
      'keyframe-transaction-update': true,
      'keyframe-transaction-commit': true,
      'keyframe-transaction-cancel': true,
      'transition-apply': true,
      'transition-remove': true,
      'transition-update-duration': true,
      'transition-preview-drop': true,
      'transition-clear-preview': true,
      'keyboard-delete-command': true,
      'keyboard-cycle-blend-mode-command': true,
    } satisfies Record<TimelineEditTransactionOperation['type'], true>;

    expect(TIMELINE_EDIT_TRANSACTION_OPERATION_TYPES).toHaveLength(Object.keys(exhaustiveMap).length);
    expect([...TIMELINE_EDIT_TRANSACTION_OPERATION_TYPES].sort()).toEqual(Object.keys(exhaustiveMap).sort());
    expect(sampleTransactionOperations.map(getTransactionOperationType).sort()).toEqual(
      [...TIMELINE_EDIT_TRANSACTION_OPERATION_TYPES].sort()
    );
  });

  it('keeps transaction contracts as structured-clone-safe plain data', () => {
    for (const operation of sampleTransactionOperations) {
      expect(structuredClone(operation)).toEqual(operation);
      expect(JSON.parse(JSON.stringify(operation))).toEqual(operation);
    }
  });

  it('covers typed transition apply, remove, and update-duration operation payloads', () => {
    const transitionOperations = sampleTransactionOperations.filter(operation =>
      operation.type === 'transition-apply' ||
      operation.type === 'transition-remove' ||
      operation.type === 'transition-update-duration'
    );

    expect(transitionOperations.map(operation => operation.type)).toEqual([
      'transition-apply',
      'transition-remove',
      'transition-update-duration',
    ]);
    expect(transitionOperations[0]).toMatchObject({
      clipAId: 'clip-a',
      clipBId: 'clip-b',
      junction: transitionJunction,
    });
    expect(transitionOperations[1]).toMatchObject({
      clipId: 'clip-a',
      edge: 'out',
      transitionId: 'transition-1',
    });
    expect(transitionOperations[2]).toMatchObject({
      clipId: 'clip-a',
      edge: 'out',
      requestedDuration: 1.5,
      junction: transitionJunction,
    });
  });

  it('captures the legacy move parity checklist as required fields', () => {
    const exhaustiveMoveParity = {
      snapping: true,
      resistance: true,
      fallbackTrackCreation: true,
      overlapTrimming: true,
      linkedClips: true,
      linkedGroups: true,
      selectedLinkedPairs: true,
    } satisfies Record<keyof MoveClipsParityChecklist, true>;

    expect(MOVE_CLIPS_PARITY_KEYS).toEqual(Object.keys(exhaustiveMoveParity));
    expect(Object.keys(parityChecklist)).toEqual([...MOVE_CLIPS_PARITY_KEYS]);
  });

  it('publishes all keyframe atomic operation discriminants', () => {
    const exhaustiveKeyframeMap = {
      'keyframe-create': true,
      'keyframe-move': true,
      'keyframe-update-value': true,
      'keyframe-remove': true,
      'keyframe-update-easing': true,
      'keyframe-update-bezier-handle': true,
      'keyframe-update-rotation-interpolation': true,
      'keyframe-select': true,
    } satisfies Record<KeyframeEditOperation['type'], true>;

    expect(KEYFRAME_EDIT_OPERATION_TYPES).toHaveLength(Object.keys(exhaustiveKeyframeMap).length);
    expect([...KEYFRAME_EDIT_OPERATION_TYPES].sort()).toEqual(Object.keys(exhaustiveKeyframeMap).sort());
  });
});
