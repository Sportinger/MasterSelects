import { afterEach, describe, expect, it } from 'vitest';

import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const initialTimelineState = useTimelineStore.getState();

afterEach(() => {
  useTimelineStore.setState(initialTimelineState);
});

describe('motion parent 2D/3D invariant', () => {
  it('blocks a 3D toggle that would invalidate a parent edge', () => {
    const track = createMockTrack({ id: 'video-parent-space', type: 'video' });
    const parent = createMockClip({ id: 'parent-space', trackId: track.id });
    const child = createMockClip({
      id: 'child-space',
      trackId: track.id,
      parentClipId: parent.id,
    });
    useTimelineStore.setState({ tracks: [track], clips: [parent, child] });

    useTimelineStore.getState().toggle3D(parent.id);
    useTimelineStore.getState().toggle3D(child.id);

    expect(useTimelineStore.getState().clips.find((clip) => clip.id === parent.id)?.is3D)
      .not.toBe(true);
    expect(useTimelineStore.getState().clips.find((clip) => clip.id === child.id)?.is3D)
      .not.toBe(true);
    expect(useTimelineStore.getState().clips.find((clip) => clip.id === child.id)?.parentClipId)
      .toBe(parent.id);
  });

  it('still toggles an unparented clip into 3D', () => {
    const track = createMockTrack({ id: 'video-free-space', type: 'video' });
    const clip = createMockClip({
      id: 'free-space',
      trackId: track.id,
      source: { type: 'video' },
    });
    useTimelineStore.setState({ tracks: [track], clips: [clip] });

    useTimelineStore.getState().toggle3D(clip.id);

    expect(useTimelineStore.getState().clips.find((entry) => entry.id === clip.id)?.is3D)
      .toBe(true);
  });
});
