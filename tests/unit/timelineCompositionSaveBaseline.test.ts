import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MediaState } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';
import type { CompositionTimelineData, TimelineClip, TimelineTrack } from '../../src/types/timeline';

vi.mock('../../src/services/audioRoutingManager', () => ({
  audioRoutingManager: { dispose: vi.fn() },
}));

const track: TimelineTrack = {
  id: 'video-1',
  name: 'Video 1',
  type: 'video',
  height: 60,
  muted: false,
  visible: true,
  solo: false,
};

function makeRuntimeClip(duration = 5): TimelineClip {
  return {
    id: 'clip-1',
    trackId: track.id,
    name: 'Clip 1',
    startTime: 0,
    duration,
    inPoint: 0,
    outPoint: duration,
    source: { type: 'video', mediaFileId: 'media-1', naturalDuration: 6 },
    mediaFileId: 'media-1',
    transform: {
      opacity: 1,
      blendMode: 'normal',
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    },
    effects: [],
  };
}

describe('timeline composition save baseline', () => {
  afterEach(() => {
    const globals = globalThis as typeof globalThis & {
      __mediaStoreModule?: unknown;
      __masterselectsTimelineCompositionSaveSignatures?: unknown;
      __masterselectsTimelineCompositionSaveRefs?: unknown;
    };
    delete globals.__mediaStoreModule;
    delete globals.__masterselectsTimelineCompositionSaveSignatures;
    delete globals.__masterselectsTimelineCompositionSaveRefs;
  });

  it('keeps the first post-load mirror clean and still mirrors a later authored clip edit', async () => {
    const originalTimelineData: CompositionTimelineData = {
      tracks: [track],
      clips: [],
      playheadPosition: 0,
      duration: 5,
      zoom: 50,
      scrollX: 0,
      inPoint: null,
      outPoint: null,
      loopPlayback: false,
    };
    let mediaState = {
      activeCompositionId: 'comp-1',
      compositions: [{
        id: 'comp-1',
        name: 'Composition 1',
        type: 'composition',
        parentId: null,
        createdAt: 1,
        width: 1920,
        height: 1080,
        frameRate: 30,
        duration: 5,
        backgroundColor: '#000000',
        timelineData: originalTimelineData,
      }],
    } as Partial<MediaState>;
    const setMediaState = vi.fn((update: Partial<MediaState> | ((state: MediaState) => Partial<MediaState>)) => {
      const patch = typeof update === 'function' ? update(mediaState as MediaState) : update;
      mediaState = { ...mediaState, ...patch };
    });
    const fakeUseMediaStore = Object.assign(vi.fn(), {
      getState: vi.fn(() => mediaState),
      setState: setMediaState,
      subscribe: vi.fn(),
    });
    (globalThis as typeof globalThis & {
      __mediaStoreModule?: { useMediaStore: typeof fakeUseMediaStore };
    }).__mediaStoreModule = { useMediaStore: fakeUseMediaStore };

    const {
      establishTimelineCompositionSaveBaseline,
      triggerTimelineSave,
    } = await import('../../src/stores/mediaStore/init');
    useTimelineStore.setState({
      tracks: [track],
      clips: [makeRuntimeClip()],
      duration: 5,
      durationLocked: false,
      inPoint: null,
      outPoint: null,
      loopPlayback: false,
      markers: [],
      clipKeyframes: new Map(),
      videoBakeRegions: [],
      masterAudioState: undefined,
    });

    establishTimelineCompositionSaveBaseline();
    useTimelineStore.setState((state) => ({ clips: [...state.clips] }));
    triggerTimelineSave();
    expect(setMediaState).not.toHaveBeenCalled();

    useTimelineStore.setState({ clips: [makeRuntimeClip(6)] });
    triggerTimelineSave();

    expect(setMediaState).toHaveBeenCalledTimes(1);
    expect(mediaState.compositions?.[0]?.timelineData?.clips[0]?.duration).toBe(6);
  });
});
