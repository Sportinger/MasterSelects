import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useTimelineStore } from '../../src/stores/timeline';

const initialState = useTimelineStore.getState();
const PINNED_PATHS = ['position.x', 'shape.size.w', 'appearance.stale.opacity'];

function resetTimeline(): string {
  useTimelineStore.setState({
    ...initialState,
    clips: [],
    tracks: [{
      id: 'video-1',
      name: 'Video 1',
      type: 'video',
      height: 70,
      muted: false,
      visible: true,
      solo: false,
    }],
    clipKeyframes: new Map(),
    selectedClipIds: new Set(),
    selectedKeyframeIds: new Set(),
    clipboardData: null,
    clipboardKeyframes: null,
    playheadPosition: 0,
  });

  const clipId = useTimelineStore.getState().addMotionShapeClip(
    'video-1',
    0,
    { primitive: 'rectangle', duration: 5 },
  )!;
  useTimelineStore.getState().updateMotionLayer(clipId, motion => ({
    ...motion,
    ui: {
      ...motion.ui,
      pinnedProperties: [...PINNED_PATHS],
    },
  }));
  return clipId;
}

describe('Motion property pin persistence', () => {
  beforeEach(() => {
    resetTimeline();
  });

  afterEach(() => {
    act(() => {
      useTimelineStore.setState(initialState);
    });
  });

  it('round-trips exact paths as project clip content', async () => {
    const clipId = useTimelineStore.getState().clips[0].id;
    const serialized = useTimelineStore.getState().getSerializableState();

    expect(serialized.clips[0].motion?.ui?.pinnedProperties).toEqual(PINNED_PATHS);

    await useTimelineStore.getState().loadState(serialized);

    expect(useTimelineStore.getState().clips.find(clip => clip.id === clipId)
      ?.motion?.ui?.pinnedProperties).toEqual(PINNED_PATHS);
  });

  it('deep-clones pins when splitting a clip', () => {
    const clipId = useTimelineStore.getState().clips[0].id;

    useTimelineStore.getState().splitClip(clipId, 2.5);

    const parts = useTimelineStore.getState().clips.toSorted(
      (left, right) => left.startTime - right.startTime,
    );
    expect(parts).toHaveLength(2);
    expect(parts[0].motion?.ui?.pinnedProperties).toEqual(PINNED_PATHS);
    expect(parts[1].motion?.ui?.pinnedProperties).toEqual(PINNED_PATHS);
    expect(parts[0].motion?.ui?.pinnedProperties)
      .not.toBe(parts[1].motion?.ui?.pinnedProperties);

    useTimelineStore.getState().updateMotionLayer(parts[0].id, motion => ({
      ...motion,
      ui: { ...motion.ui, pinnedProperties: ['opacity'] },
    }));

    expect(useTimelineStore.getState().clips.find(clip => clip.id === parts[1].id)
      ?.motion?.ui?.pinnedProperties).toEqual(PINNED_PATHS);
  });

  it('deep-clones pins through timeline clipboard paste', () => {
    const original = useTimelineStore.getState().clips[0];
    useTimelineStore.setState({
      selectedClipIds: new Set([original.id]),
      primarySelectedClipId: original.id,
      playheadPosition: 8,
    });

    useTimelineStore.getState().copyClips();
    useTimelineStore.getState().pasteClips();

    const pasted = useTimelineStore.getState().clips.find(clip => clip.id !== original.id);
    expect(pasted?.motion?.ui?.pinnedProperties).toEqual(PINNED_PATHS);
    expect(pasted?.motion?.ui?.pinnedProperties)
      .not.toBe(original.motion?.ui?.pinnedProperties);

    useTimelineStore.getState().updateMotionLayer(pasted!.id, motion => ({
      ...motion,
      ui: { ...motion.ui, pinnedProperties: ['opacity'] },
    }));

    expect(useTimelineStore.getState().clips.find(clip => clip.id === original.id)
      ?.motion?.ui?.pinnedProperties).toEqual(PINNED_PATHS);
  });
});
