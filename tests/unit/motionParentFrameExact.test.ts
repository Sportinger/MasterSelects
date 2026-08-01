import { afterEach, describe, expect, it } from 'vitest';

import { createFrameContext } from '../../src/services/layerBuilder/FrameContext';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockKeyframe, createMockTrack } from '../helpers/mockData';

const initialTimelineState = useTimelineStore.getState();

afterEach(() => {
  useTimelineStore.setState(initialTimelineState);
});

describe('motion parent exact-frame evaluation', () => {
  it('evaluates an animated parent at the requested frame instead of the UI playhead', () => {
    const track = createMockTrack({ id: 'video-parent-frame', type: 'video' });
    const parent = createMockClip({
      id: 'parent-frame',
      trackId: track.id,
      startTime: 10,
      duration: 10,
    });
    const child = createMockClip({
      id: 'child-frame',
      trackId: track.id,
      startTime: 12,
      duration: 6,
      parentClipId: parent.id,
      transform: {
        ...createMockClip().transform,
        position: { x: 5, y: 0, z: 0 },
      },
    });
    const parentKeyframes = [
      createMockKeyframe({
        id: 'parent-x-start',
        clipId: parent.id,
        property: 'position.x',
        time: 0,
        value: 0,
        easing: 'linear',
      }),
      createMockKeyframe({
        id: 'parent-x-requested',
        clipId: parent.id,
        property: 'position.x',
        time: 4,
        value: 100,
        easing: 'linear',
      }),
    ];

    useTimelineStore.setState({
      tracks: [track],
      clips: [parent, child],
      clipKeyframes: new Map([[parent.id, parentKeyframes]]),
      // Deliberately differs from the requested producer frame at t=14.
      playheadPosition: 10,
      isPlaying: false,
      isDraggingPlayhead: false,
    });

    const context = createFrameContext(14);
    const transform = context.getInterpolatedTransform(child.id, 2);

    expect(context.playheadPosition).toBe(14);
    expect(useTimelineStore.getState().playheadPosition).toBe(10);
    expect(transform.position.x).toBeCloseTo(105);
  });
});
