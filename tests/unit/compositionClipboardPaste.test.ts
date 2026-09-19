import { describe, expect, it, vi } from 'vitest';
import { createPastedClipboardClipsPlan } from '../../src/stores/timeline/clipboard/clipboardClipPastePlanner';
import { refreshCompClipNestedDataAction } from '../../src/stores/timeline/clip/compositionClipActions';
import { createNestedContentHash } from '../../src/stores/timeline/clip/addCompClip';
import type { ClipboardClipData } from '../../src/stores/timeline/types';
import type { Composition } from '../../src/stores/mediaStore/types';
import type { TimelineClip, TimelineTrack } from '../../src/types/timeline';
import type { ClipActionContext } from '../../src/stores/timeline/clip/clipActionContext';

const mediaState = vi.hoisted(() => ({
  current: {
    files: [],
    compositions: [],
    activeCompositionId: 'parent-comp',
  } as {
    files: unknown[];
    compositions: Composition[];
    activeCompositionId: string | null;
  },
}));

vi.mock('../../src/stores/mediaStore', () => ({
  useMediaStore: {
    getState: () => mediaState.current,
  },
}));

const TRANSFORM = {
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  rotation: { x: 0, y: 0, z: 0 },
  opacity: 1,
  blendMode: 'normal' as const,
};

function createCompositionClipboardClip(
  overrides: Partial<ClipboardClipData>,
): ClipboardClipData {
  return {
    id: 'source-video',
    trackId: 'video-1',
    trackType: 'video',
    name: 'Nested Comp',
    startTime: 0,
    duration: 10,
    inPoint: 0,
    outPoint: 10,
    sourceType: 'video',
    transform: TRANSFORM,
    effects: [],
    isComposition: true,
    compositionId: 'source-comp',
    ...overrides,
  };
}

describe('composition clipboard paste', () => {
  it('recreates a linked composition pair with distinct video and audio sources', () => {
    const video = createCompositionClipboardClip({
      linkedClipId: 'source-audio',
    });
    const audio = createCompositionClipboardClip({
      id: 'source-audio',
      trackId: 'audio-1',
      trackType: 'audio',
      name: 'Nested Comp (Audio)',
      sourceType: 'audio',
      linkedClipId: 'source-video',
      waveform: [0, 0.5, 0.25],
    });
    let suffix = 0;

    const plan = createPastedClipboardClipsPlan({
      clipboardData: [video, audio],
      playheadPosition: 4,
      tracks: [
        { id: 'video-1', name: 'Video 1', type: 'video', height: 70, muted: false, visible: true, solo: false },
        { id: 'audio-1', name: 'Audio 1', type: 'audio', height: 70, muted: false, visible: true, solo: false },
      ],
      clipKeyframes: new Map(),
      timestamp: 42,
      createSuffix: () => `paste-${suffix += 1}`,
    });

    const pastedVideo = plan.newClips.find(clip => clip.trackId === 'video-1');
    const pastedAudio = plan.newClips.find(clip => clip.trackId === 'audio-1');
    expect(pastedVideo?.source?.type).toBe('video');
    expect(pastedAudio?.source?.type).toBe('audio');
    expect(pastedVideo?.linkedClipId).toBe(pastedAudio?.id);
    expect(pastedAudio?.linkedClipId).toBe(pastedVideo?.id);
  });

  it('refreshes nested visuals without attaching nested content to the audio wrapper', async () => {
    const timelineData = {
      tracks: [] as TimelineTrack[],
      clips: [],
      playheadPosition: 0,
      duration: 10,
      durationLocked: true,
      zoom: 50,
      scrollX: 0,
      inPoint: null,
      outPoint: null,
      loopPlayback: false,
    };
    mediaState.current = {
      files: [],
      activeCompositionId: 'parent-comp',
      compositions: [{
        id: 'source-comp',
        name: 'Nested Comp',
        type: 'composition',
        parentId: null,
        createdAt: 1,
        width: 1920,
        height: 1080,
        frameRate: 30,
        duration: 10,
        timelineData,
      }],
    };

    const video = {
      id: 'pasted-video',
      trackId: 'video-1',
      name: 'Nested Comp',
      file: new File([], 'Nested Comp'),
      startTime: 0,
      duration: 10,
      inPoint: 0,
      outPoint: 10,
      source: { type: 'video' as const, naturalDuration: 10 },
      transform: TRANSFORM,
      effects: [],
      isComposition: true,
      compositionId: 'source-comp',
      isLoading: true,
    } satisfies TimelineClip;
    const audio = {
      ...video,
      id: 'pasted-audio',
      trackId: 'audio-1',
      name: 'Nested Comp (Audio)',
      source: { type: 'audio' as const, naturalDuration: 10 },
    } satisfies TimelineClip;
    let state = {
      clips: [video, audio] as TimelineClip[],
      tracks: [] as TimelineTrack[],
      thumbnailsEnabled: false,
      clipKeyframes: new Map(),
      invalidateCache: vi.fn(),
    };
    const get = () => state;
    const set = (partial: Partial<typeof state>) => {
      state = { ...state, ...partial };
    };

    await refreshCompClipNestedDataAction(
      { get, set } as unknown as ClipActionContext,
      'source-comp',
    );

    const refreshedVideo = state.clips.find(clip => clip.id === video.id);
    const untouchedAudio = state.clips.find(clip => clip.id === audio.id);
    expect(refreshedVideo).toEqual(expect.objectContaining({
      nestedClips: [],
      nestedTracks: [],
      nestedContentHash: createNestedContentHash(timelineData),
      isLoading: false,
      needsReload: false,
    }));
    expect(untouchedAudio?.nestedClips).toBeUndefined();
    expect(untouchedAudio?.isLoading).toBe(true);
  });
});
