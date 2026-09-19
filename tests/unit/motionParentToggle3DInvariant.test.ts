import { afterEach, describe, expect, it } from 'vitest';

import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const initialTimelineState = useTimelineStore.getState();

afterEach(() => {
  useTimelineStore.setState(initialTimelineState);
});

describe('motion parent 2D/3D invariant', () => {
  it('toggles an entire Pick Whip hierarchy into 3D from any connected clip', () => {
    const track = createMockTrack({ id: 'video-parent-space', type: 'video' });
    const parent = createMockClip({ id: 'parent-space', trackId: track.id });
    const child = createMockClip({
      id: 'child-space',
      trackId: track.id,
      parentClipId: parent.id,
    });
    const grandchild = createMockClip({
      id: 'grandchild-space',
      trackId: track.id,
      parentClipId: child.id,
    });
    const unrelated = createMockClip({ id: 'unrelated-space', trackId: track.id });
    useTimelineStore.setState({ tracks: [track], clips: [parent, child, grandchild, unrelated] });

    useTimelineStore.getState().toggle3D(child.id);

    expect(useTimelineStore.getState().clips.find((clip) => clip.id === parent.id)?.is3D)
      .toBe(true);
    expect(useTimelineStore.getState().clips.find((clip) => clip.id === child.id)?.is3D)
      .toBe(true);
    expect(useTimelineStore.getState().clips.find((clip) => clip.id === grandchild.id)?.is3D)
      .toBe(true);
    expect(useTimelineStore.getState().clips.find((clip) => clip.id === unrelated.id)?.is3D)
      .not.toBe(true);
    expect(useTimelineStore.getState().clips.find((clip) => clip.id === child.id)?.parentClipId)
      .toBe(parent.id);
  });

  it('toggles the whole connected hierarchy back to 2D', () => {
    const track = createMockTrack({ id: 'video-parent-space', type: 'video' });
    const parent = createMockClip({ id: 'parent-space', trackId: track.id, is3D: true });
    const child = createMockClip({
      id: 'child-space',
      trackId: track.id,
      is3D: true,
      parentClipId: parent.id,
    });
    useTimelineStore.setState({ tracks: [track], clips: [parent, child] });

    useTimelineStore.getState().toggle3D(parent.id);

    expect(useTimelineStore.getState().clips.find((clip) => clip.id === parent.id)?.is3D)
      .toBe(false);
    expect(useTimelineStore.getState().clips.find((clip) => clip.id === child.id)?.is3D)
      .toBe(false);
    expect(useTimelineStore.getState().clips.find((clip) => clip.id === child.id)?.parentClipId)
      .toBe(parent.id);
  });

  it('keeps a connected hierarchy unchanged when any member track is locked', () => {
    const parentTrack = createMockTrack({ id: 'video-parent-space', type: 'video' });
    const lockedChildTrack = createMockTrack({
      id: 'video-child-space',
      type: 'video',
      locked: true,
    });
    const parent = createMockClip({ id: 'parent-space', trackId: parentTrack.id });
    const child = createMockClip({
      id: 'child-space',
      trackId: lockedChildTrack.id,
      parentClipId: parent.id,
    });
    useTimelineStore.setState({
      tracks: [parentTrack, lockedChildTrack],
      clips: [parent, child],
    });

    useTimelineStore.getState().toggle3D(parent.id);

    expect(useTimelineStore.getState().clips.find((clip) => clip.id === parent.id)?.is3D)
      .not.toBe(true);
    expect(useTimelineStore.getState().clips.find((clip) => clip.id === child.id)?.is3D)
      .not.toBe(true);
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
