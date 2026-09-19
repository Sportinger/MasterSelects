import { describe, expect, it } from 'vitest';
import { createKeyframeViewStateActions } from '../../src/stores/timeline/keyframes/keyframeViewStateActions';
import type { TimelineClip } from '../../src/types/timeline';
import type { TimelineStore } from '../../src/stores/timeline/types';

function createActions(state: TimelineStore) {
  return createKeyframeViewStateActions(
    () => undefined,
    () => state,
  );
}

describe('keyframe view state performance guards', () => {
  it('returns the base expanded height without reading clips when selection is empty', () => {
    const clips = new Proxy([] as TimelineClip[], {
      get() {
        throw new Error('clips should not be read for an empty selection');
      },
    });
    const state = {
      clips,
      clipKeyframes: new Map(),
      expandedTracks: new Set(['video-1']),
      selectedClipIds: new Set<string>(),
    } as TimelineStore;

    expect(createActions(state).getExpandedTrackHeight('video-1', 60)).toBe(60);
  });

  it('reuses track membership until clips or keyframes change', () => {
    let iterations = 0;
    const clip = { id: 'clip-1', trackId: 'video-1' } as TimelineClip;
    const clips = new Proxy([clip], {
      get(target, property, receiver) {
        if (property === Symbol.iterator) iterations += 1;
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    let state = {
      clips,
      clipKeyframes: new Map(),
      expandedTracks: new Set<string>(),
      selectedClipIds: new Set<string>(),
    } as TimelineStore;
    const actions = createKeyframeViewStateActions(
      () => undefined,
      () => state,
    );

    expect(actions.trackHasKeyframes('video-1')).toBe(false);
    expect(actions.trackHasKeyframes('audio-1')).toBe(false);
    expect(iterations).toBe(1);

    state = {
      ...state,
      clipKeyframes: new Map([['clip-1', [{ id: 'kf-1' }]]]),
    } as TimelineStore;
    expect(actions.trackHasKeyframes('video-1')).toBe(true);
    expect(iterations).toBe(2);
  });
});
