import { describe, expect, it, vi } from 'vitest';
import { createMockClip, createMockTrack } from '../../helpers/mockData';
import { createTestTimelineStore } from '../../helpers/storeFactory';

describe('timeline video bake regions', () => {
  it('adds normalized composition video bake regions', () => {
    const store = createTestTimelineStore({ duration: 20 });

    const regionId = store.getState().addCompositionVideoBakeRegion(8, 3);

    expect(regionId).toBeTruthy();
    expect(store.getState().videoBakeRegions).toEqual([
      expect.objectContaining({
        id: regionId,
        scope: 'composition',
        startTime: 3,
        endTime: 8,
        status: 'marked',
      }),
    ]);
    expect(store.getState().videoBakeRegionSelection).toBeNull();
  });

  it('bakes and unbakes clip video bake regions through the RAM preview range path', async () => {
    const startRamPreviewForRange = vi.fn(async () => true);
    const clearRamPreview = vi.fn();
    const clip = createMockClip({
      id: 'clip-v',
      trackId: 'video-1',
      startTime: 10,
      duration: 5,
      inPoint: 2,
      outPoint: 7,
      source: {
        type: 'video',
        mediaFileId: 'media-v',
        naturalDuration: 8,
      },
    });
    const store = createTestTimelineStore({
      clips: [clip],
      tracks: [createMockTrack({ id: 'video-1', type: 'video', locked: false })],
      startRamPreviewForRange,
      clearRamPreview,
    });

    const regionId = store.getState().addClipVideoBakeRegion('clip-v', {
      trackId: 'video-1',
      startTime: 11,
      endTime: 13,
      sourceInPoint: 3,
      sourceOutPoint: 5,
    });

    expect(regionId).toBeTruthy();
    await expect(store.getState().bakeClipVideoBakeRegion('clip-v', regionId as string)).resolves.toBe(true);
    expect(startRamPreviewForRange).toHaveBeenCalledWith(11, 13, expect.objectContaining({
      centerTime: 12,
      label: 'Bake clip video region',
    }));

    const bakedClip = store.getState().clips.find(candidate => candidate.id === 'clip-v');
    expect(bakedClip?.videoState?.bakeRegions?.[0]).toEqual(expect.objectContaining({
      id: regionId,
      status: 'baked',
      progress: 100,
      sourceInPoint: 3,
      sourceOutPoint: 5,
    }));

    expect(store.getState().unbakeClipVideoBakeRegion('clip-v', regionId as string)).toBe(true);
    expect(clearRamPreview).toHaveBeenCalled();
    const unbakedClip = store.getState().clips.find(candidate => candidate.id === 'clip-v');
    expect(unbakedClip?.videoState?.bakeRegions?.[0]).toEqual(expect.objectContaining({
      id: regionId,
      status: 'marked',
    }));
  });

  it('rejects clip regions on locked or non-video tracks', () => {
    const clip = createMockClip({
      id: 'clip-v',
      trackId: 'video-1',
      startTime: 0,
      duration: 5,
    });
    const lockedStore = createTestTimelineStore({
      clips: [clip],
      tracks: [createMockTrack({ id: 'video-1', type: 'video', locked: true })],
    });

    expect(lockedStore.getState().addClipVideoBakeRegion('clip-v', {
      trackId: 'video-1',
      startTime: 1,
      endTime: 2,
    })).toBeNull();
    expect(lockedStore.getState().clips[0].videoState?.bakeRegions).toBeUndefined();

    const audioStore = createTestTimelineStore({
      clips: [
        createMockClip({
          id: 'clip-a',
          trackId: 'audio-1',
          source: { type: 'audio', mediaFileId: 'media-a', naturalDuration: 5 },
        }),
      ],
      tracks: [createMockTrack({ id: 'audio-1', type: 'audio', locked: false })],
    });

    expect(audioStore.getState().addClipVideoBakeRegion('clip-a', {
      trackId: 'audio-1',
      startTime: 1,
      endTime: 2,
    })).toBeNull();
  });
});
