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
});
