import { describe, expect, it } from 'vitest';
import { createTestTimelineStore } from '../helpers/storeFactory';
import { createMockClip } from '../helpers/mockData';

describe('clip opacity bounds', () => {
  it('clamps static opacity edits to the visible 0-100 percent range', () => {
    const clip = createMockClip({ id: 'clip-opacity' });
    const store = createTestTimelineStore({ clips: [clip] });

    store.getState().setPropertyValue(clip.id, 'opacity', -0.25);
    expect(store.getState().clips[0].transform.opacity).toBe(0);

    store.getState().setPropertyValue(clip.id, 'opacity', 1.25);
    expect(store.getState().clips[0].transform.opacity).toBe(1);
  });

  it('clamps opacity keyframes created or edited through the graph path', () => {
    const clip = createMockClip({ id: 'clip-opacity-keyframes' });
    const store = createTestTimelineStore({ clips: [clip] });

    store.getState().addKeyframe(clip.id, 'opacity', -0.5, 0);
    const keyframe = store.getState().clipKeyframes.get(clip.id)?.[0];
    expect(keyframe?.value).toBe(0);

    store.getState().updateKeyframe(keyframe!.id, { value: 1.5 });
    expect(store.getState().clipKeyframes.get(clip.id)?.[0].value).toBe(1);
  });

  it('also clamps direct transform updates', () => {
    const clip = createMockClip({ id: 'clip-opacity-transform' });
    const store = createTestTimelineStore({ clips: [clip] });

    store.getState().updateClipTransform(clip.id, { opacity: -1 });
    expect(store.getState().clips[0].transform.opacity).toBe(0);
  });
});
