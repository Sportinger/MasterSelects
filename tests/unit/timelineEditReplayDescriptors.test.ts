import { describe, expect, it } from 'vitest';
import {
  compileTimelineEditReplayDescriptor,
  createTimelineEditReplayDescriptor,
  getTimelineReplayToolId,
} from '../../src/services/guidedActions';
import type { TimelineEditOperation } from '../../src/stores/timeline/editOperations/types';

describe('timeline edit replay descriptors', () => {
  it('maps split operations to blade replay targets', () => {
    const operation: TimelineEditOperation = {
      id: 'split:clip-1:4',
      type: 'split-at-time',
      clipIds: ['clip-1'],
      time: 4,
    };

    const descriptor = createTimelineEditReplayDescriptor(operation);

    expect(descriptor.toolId).toBe('blade');
    expect(descriptor.targets).toEqual([
      expect.objectContaining({ target: { kind: 'timelineClip', clipId: 'clip-1' } }),
      expect.objectContaining({ target: { kind: 'timelineTime', time: 4 } }),
    ]);
    expect(descriptor.pointerPath).toHaveLength(2);
  });

  it('maps multi-split operations to one pointer point per cut time', () => {
    const operation: TimelineEditOperation = {
      id: 'split-times:clip-1',
      type: 'split-at-times',
      clipId: 'clip-1',
      times: [2, 4, 6, 8],
      scope: { trackIds: ['video-1'] },
    };

    const descriptor = createTimelineEditReplayDescriptor(operation);

    expect(descriptor.toolId).toBe('blade');
    expect(descriptor.targets).toEqual([
      expect.objectContaining({ target: { kind: 'timelineClip', clipId: 'clip-1' } }),
      expect.objectContaining({ target: { kind: 'timelineTime', trackId: 'video-1', time: 2 } }),
      expect.objectContaining({ target: { kind: 'timelineTime', trackId: 'video-1', time: 4 } }),
      expect.objectContaining({ target: { kind: 'timelineTime', trackId: 'video-1', time: 6 } }),
      expect.objectContaining({ target: { kind: 'timelineTime', trackId: 'video-1', time: 8 } }),
    ]);
    expect(descriptor.pointerPath?.map((point) => point.target)).toEqual([
      { kind: 'timelineClip', clipId: 'clip-1' },
      { kind: 'timelineTime', trackId: 'video-1', time: 2 },
      { kind: 'timelineTime', trackId: 'video-1', time: 4 },
      { kind: 'timelineTime', trackId: 'video-1', time: 6 },
      { kind: 'timelineTime', trackId: 'video-1', time: 8 },
    ]);
  });

  it('maps track-select-all operations to the grouped selection tool', () => {
    const operation: TimelineEditOperation = {
      id: 'select-forward:3',
      type: 'select-clips-from-time',
      time: 3,
      direction: 'forward',
      includeLinked: true,
    };

    expect(getTimelineReplayToolId(operation)).toBe('track-select-forward-all');
    expect(createTimelineEditReplayDescriptor(operation)).toMatchObject({
      operationType: 'select-clips-from-time',
      toolId: 'track-select-forward-all',
      targets: [
        expect.objectContaining({ target: { kind: 'timelineTime', time: 3 } }),
      ],
    });
  });

  it('compiles placement descriptors to visual guided timeline actions', () => {
    const descriptor = createTimelineEditReplayDescriptor({
      id: 'place:insert:2',
      type: 'place-timeline-range',
      mode: 'insert',
      trackIds: ['video-1'],
      startTime: 2,
      duration: 5,
    });

    const actions = compileTimelineEditReplayDescriptor(descriptor);

    expect(descriptor.toolId).toBe('insert');
    expect(actions.map((action) => action.type)).toEqual([
      'focusPanel',
      'resolveTarget',
      'highlightTarget',
      'moveCursorTo',
      'callout',
      'confirmState',
    ]);
    expect(actions[1]).toMatchObject({
      target: { kind: 'timelineTime', trackId: 'video-1', time: 2 },
    });
  });

  it('maps transition preview and clear operations to select replay descriptors', () => {
    const preview = createTimelineEditReplayDescriptor({
      id: 'transition-preview:1',
      type: 'transition-preview-drop',
      transactionId: 'transition-preview:1',
      historyBatchId: 'transition-preview:1',
      source: 'external-drop',
      transitionType: 'crossfade',
      requestedDuration: 1,
      junction: {
        geometrySnapshotId: 'geometry-1',
        trackId: 'video-1',
        clipAId: 'clip-a',
        clipBId: 'clip-b',
        junctionTime: 4,
        junctionRect: { geometrySnapshotId: 'geometry-1', rectId: 'junction', kind: 'transition-junction' },
        dropZoneRect: { geometrySnapshotId: 'geometry-1', rectId: 'drop-zone', kind: 'transition-drop-zone' },
        thresholdSeconds: 0.5,
      },
    });
    const clear = createTimelineEditReplayDescriptor({
      id: 'transition-clear:1',
      type: 'transition-clear-preview',
      transactionId: 'transition-clear:1',
      historyBatchId: 'transition-clear:1',
      source: 'external-drop',
      reason: 'drag-leave',
    });

    expect(preview).toMatchObject({
      operationType: 'transition-preview-drop',
      toolId: 'select',
      targets: [
        expect.objectContaining({ target: { kind: 'timelineClip', clipId: 'clip-a' } }),
        expect.objectContaining({ target: { kind: 'timelineTime', trackId: 'video-1', time: 4 } }),
      ],
    });
    expect(preview.overlayLabels?.[0]).toMatchObject({
      title: 'Preview Transition Drop',
      body: 'Preview crossfade for 1.00s.',
    });
    expect(clear).toMatchObject({
      operationType: 'transition-clear-preview',
      toolId: 'select',
      targets: [],
    });
    expect(clear.overlayLabels?.[0]).toMatchObject({
      title: 'Clear Transition Preview',
      body: 'Clear transition preview after drag-leave.',
    });
  });

  it('maps fade and keyframe transactions to stable replay descriptors', () => {
    const fade = createTimelineEditReplayDescriptor({
      id: 'fade-begin:1',
      type: 'fade-transaction-begin',
      transactionId: 'fade-begin:1',
      historyBatchId: 'fade-begin:1',
      source: 'ui',
      phase: 'begin',
      clipId: 'clip-1',
      edge: 'left',
      originalFadeDuration: 0.5,
      clipDuration: 8,
      property: 'opacity',
    });
    const keyframes = createTimelineEditReplayDescriptor({
      id: 'keyframe-commit:1',
      type: 'keyframe-transaction-commit',
      transactionId: 'keyframe-commit:1',
      historyBatchId: 'keyframe-commit:1',
      source: 'ui',
      phase: 'commit',
      clipId: 'clip-1',
      property: 'opacity',
      keyframeIds: ['kf-1'],
      operations: [{
        type: 'keyframe-update-easing',
        keyframeId: 'kf-1',
        clipId: 'clip-1',
        property: 'opacity',
        easing: 'ease-in',
      }],
    });

    expect(fade).toMatchObject({
      operationType: 'fade-transaction-begin',
      toolId: 'select',
      targets: [expect.objectContaining({ target: { kind: 'timelineClip', clipId: 'clip-1' } })],
    });
    expect(fade.overlayLabels?.[0]).toMatchObject({
      title: 'Begin Fade',
      body: 'Begin left fade from 0.50s.',
    });
    expect(keyframes).toMatchObject({
      operationType: 'keyframe-transaction-commit',
      toolId: 'pen-keyframe',
      targets: [expect.objectContaining({ target: { kind: 'timelineClip', clipId: 'clip-1' } })],
    });
    expect(keyframes.overlayLabels?.[0]).toMatchObject({
      title: 'Commit Keyframes',
      body: 'Commit 1 keyframe operation.',
    });
  });
});
