import { afterEach, describe, expect, it } from 'vitest';

import { useTimelineStore } from '../../src/stores/timeline';
import type { TimelineClip } from '../../src/types/timeline';

const originalState = useTimelineStore.getState();

function clip(): TimelineClip {
  return {
    id: 'anchor-clip',
    trackId: 'video-1',
    name: 'Anchor clip',
    file: new File([], 'clip.dat'),
    startTime: 0,
    duration: 1,
    inPoint: 0,
    outPoint: 1,
    source: { type: 'gaussian-splat' },
    transform: {
      opacity: 1,
      blendMode: 'normal',
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    },
    effects: [],
    isLoading: false,
  };
}

afterEach(() => useTimelineStore.setState(originalState, true));

describe('anchor store mutation', () => {
  it('writes static and keyframe-disabled anchor values', () => {
    useTimelineStore.setState({
      ...originalState,
      clips: [clip()],
      tracks: [{ id: 'video-1', name: 'Video 1', type: 'video', height: 70, muted: false, visible: true, solo: false }],
      clipKeyframes: new Map(),
      keyframeRecordingEnabled: new Set(),
    }, true);

    useTimelineStore.getState().setPropertyValue('anchor-clip', 'anchor.x', 0.25);
    useTimelineStore.getState().disablePropertyKeyframes('anchor-clip', 'anchor.y', -0.5);

    expect(useTimelineStore.getState().clips[0]?.transform.anchor).toEqual({
      x: 0.25,
      y: -0.5,
      z: 0,
    });
  });
});
