import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useMediaStore, type Composition } from '../../../src/stores/mediaStore';
import type { AnimatableProperty } from '../../../src/types/animationProperties';
import { createMockClip, createMockKeyframe, createMockTransform } from '../../helpers/mockData';
import { createTestTimelineStore } from '../../helpers/storeFactory';

function composition(id: string, name: string, duration = 12): Composition {
  return {
    id,
    name,
    type: 'composition',
    parentId: null,
    createdAt: 1,
    width: 1920,
    height: 1080,
    frameRate: 30,
    duration,
    timelineData: { duration, clips: [], tracks: [] },
  };
}

describe('replaceClipSourceWithComposition', () => {
  const originalMediaState = useMediaStore.getState();

  beforeEach(() => {
    const parent = composition('parent-comp', 'Parent');
    const child = composition('child-comp', 'Nested Source');
    vi.mocked(useMediaStore.getState).mockReturnValue({
      ...originalMediaState,
      activeCompositionId: parent.id,
      compositions: [parent, child],
    });
  });

  afterEach(() => {
    vi.mocked(useMediaStore.getState).mockReturnValue(originalMediaState);
    vi.restoreAllMocks();
  });

  it('turns a linked video clip into a subcomp while retaining wrapper edits', async () => {
    const transform = createMockTransform({ opacity: 0.6 });
    const videoClip = createMockClip({
      id: 'video-clip',
      trackId: 'video-1',
      name: 'Original.mp4',
      mediaFileId: 'old-media',
      source: { type: 'video', naturalDuration: 20, mediaFileId: 'old-media' },
      linkedClipId: 'audio-clip',
      duration: 4,
      inPoint: 3,
      outPoint: 7,
      transform,
      effects: [{ id: 'fx-1', name: 'blur', type: 'blur', enabled: true, params: { radius: 8 } }],
    });
    const audioClip = createMockClip({
      id: 'audio-clip',
      trackId: 'audio-1',
      source: { type: 'audio', naturalDuration: 20, mediaFileId: 'old-media' },
      mediaFileId: 'old-media',
      linkedClipId: videoClip.id,
      duration: 4,
      inPoint: 3,
      outPoint: 7,
      audioState: {
        effectStack: [{
          id: 'compressor',
          descriptorId: 'audio-compressor',
          enabled: true,
          params: { ratio: 3 },
        }],
        sourceAnalysisRefs: { waveformPyramidId: 'old-waveform' },
      },
    });
    const wrapperKeyframe = createMockKeyframe({
      id: 'wrapper-keyframe',
      clipId: videoClip.id,
      property: 'opacity' as AnimatableProperty,
    });
    const store = createTestTimelineStore({
      clips: [videoClip, audioClip],
      clipKeyframes: new Map([[videoClip.id, [wrapperKeyframe]]]),
    });

    await expect(
      store.getState().replaceClipSourceWithComposition(videoClip.id, 'child-comp'),
    ).resolves.toBe(true);

    const state = store.getState();
    const replacedVideo = state.clips.find(clip => clip.id === videoClip.id)!;
    const replacedAudio = state.clips.find(clip => clip.id === audioClip.id)!;
    expect(replacedVideo).toMatchObject({
      id: videoClip.id,
      name: 'Nested Source',
      duration: 4,
      inPoint: 3,
      outPoint: 7,
      transform,
      effects: videoClip.effects,
      isComposition: true,
      compositionId: 'child-comp',
      isLoading: false,
      mediaFileId: undefined,
      source: { type: 'video', naturalDuration: 12 },
    });
    expect(replacedAudio).toMatchObject({
      id: audioClip.id,
      duration: 4,
      inPoint: 3,
      outPoint: 7,
      isComposition: true,
      compositionId: 'child-comp',
      mediaFileId: undefined,
      source: { type: 'audio', naturalDuration: 12 },
    });
    expect(replacedAudio.audioState?.effectStack).toEqual(audioClip.audioState?.effectStack);
    expect(replacedAudio.audioState?.sourceAnalysisRefs).toBeUndefined();
    expect(state.clipKeyframes.get(videoClip.id)).toEqual([wrapperKeyframe]);
  });

  it('rejects a composition that already references the active parent', async () => {
    const parent = composition('parent-comp', 'Parent');
    const cyclicChild = composition('child-comp', 'Cyclic Child');
    cyclicChild.timelineData = {
      duration: 12,
      tracks: [],
      clips: [{
        id: 'parent-ref',
        trackId: 'video-1',
        name: 'Parent',
        startTime: 0,
        duration: 12,
        inPoint: 0,
        outPoint: 12,
        sourceType: 'video',
        isComposition: true,
        compositionId: parent.id,
        transform: createMockTransform(),
        effects: [],
      }],
    };
    vi.mocked(useMediaStore.getState).mockReturnValue({
      ...originalMediaState,
      activeCompositionId: parent.id,
      compositions: [parent, cyclicChild],
    });
    const originalClip = createMockClip({
      id: 'video-clip',
      trackId: 'video-1',
      source: { type: 'video', naturalDuration: 5 },
    });
    const store = createTestTimelineStore({ clips: [originalClip] });

    await expect(
      store.getState().replaceClipSourceWithComposition(originalClip.id, cyclicChild.id),
    ).resolves.toBe(false);
    expect(store.getState().clips).toEqual([originalClip]);
  });
});
