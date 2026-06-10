import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClipboardClipData } from '../../src/stores/timeline/types';
import { createPastedClipboardClipsPlan } from '../../src/stores/timeline/clipboard/clipboardClipPastePlanner';
import { createTestTimelineStore } from '../helpers/storeFactory';
import { createMockClip, createMockTrack, createMockTransform } from '../helpers/mockData';

vi.mock('../../src/stores/timeline/clip/addImageClip', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/stores/timeline/clip/addImageClip')>();
  return {
    ...actual,
    loadImageMedia: vi.fn(async ({ clip, updateClip }) => {
      updateClip(clip.id, { isLoading: false });
    }),
  };
});

function createClipboardClip(overrides: Partial<ClipboardClipData> = {}): ClipboardClipData {
  return {
    id: 'clipboard-clip',
    trackId: 'video-1',
    trackType: 'video',
    name: 'Clipboard Clip',
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    sourceType: 'image',
    transform: createMockTransform(),
    effects: [],
    ...overrides,
  };
}

describe('locked track placement guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('places direct media adds on the next unlocked compatible track and leaves locked track clips untouched', async () => {
    const lockedClip = createMockClip({
      id: 'locked-existing',
      trackId: 'video-1',
      startTime: 0,
      duration: 3,
    });
    const store = createTestTimelineStore({
      tracks: [
        createMockTrack({ id: 'video-1', type: 'video', locked: true }),
        createMockTrack({ id: 'video-2', type: 'video', locked: false }),
        createMockTrack({ id: 'audio-1', type: 'audio', locked: false }),
      ],
      clips: [lockedClip],
    });

    const clipId = await store.getState().addClip(
      'video-1',
      new File(['image'], 'drop.png', { type: 'image/png' }),
      1,
      5,
      undefined,
      'image',
    );

    const clips = store.getState().clips;
    const newClip = clips.find(clip => clip.id === clipId);

    expect(newClip?.trackId).toBe('video-2');
    expect(clips.find(clip => clip.id === 'locked-existing')).toEqual(lockedClip);
    expect(clips.filter(clip => clip.trackId === 'video-1')).toEqual([lockedClip]);
  });

  it('creates an unlocked compatible track when every existing compatible target is locked', async () => {
    const lockedClip = createMockClip({
      id: 'locked-existing',
      trackId: 'video-1',
      startTime: 0,
      duration: 3,
    });
    const store = createTestTimelineStore({
      tracks: [
        createMockTrack({ id: 'video-1', type: 'video', locked: true }),
        createMockTrack({ id: 'audio-1', type: 'audio', locked: false }),
      ],
      clips: [lockedClip],
    });

    const clipId = await store.getState().addClip(
      'video-1',
      new File(['image'], 'external.png', { type: 'image/png' }),
      2,
      4,
      undefined,
      'image',
    );

    const state = store.getState();
    const newClip = state.clips.find(clip => clip.id === clipId);
    const newTrack = state.tracks.find(track => track.id === newClip?.trackId);

    expect(newTrack).toEqual(expect.objectContaining({ type: 'video' }));
    expect(newTrack?.id).not.toBe('video-1');
    expect(newTrack?.locked).not.toBe(true);
    expect(state.clips.filter(clip => clip.trackId === 'video-1')).toEqual([lockedClip]);
  });

  it('pastes onto an unlocked compatible track instead of the original locked track', () => {
    const plan = createPastedClipboardClipsPlan({
      clipboardData: [createClipboardClip()],
      playheadPosition: 10,
      tracks: [
        createMockTrack({ id: 'video-1', type: 'video', locked: true }),
        createMockTrack({ id: 'video-2', type: 'video', locked: false }),
        createMockTrack({ id: 'audio-1', type: 'audio', locked: false }),
      ],
      clipKeyframes: new Map(),
      timestamp: 1,
      createSuffix: () => 'next',
    });

    expect(plan.newClips).toHaveLength(1);
    expect(plan.newClips[0]?.trackId).toBe('video-2');
  });
});
