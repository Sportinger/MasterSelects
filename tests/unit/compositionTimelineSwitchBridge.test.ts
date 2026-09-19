import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MediaState } from '../../src/stores/mediaStore/types';

const hoisted = vi.hoisted(() => ({
  loadState: vi.fn(async () => undefined),
  invalidateComposition: vi.fn(),
  prepareComposition: vi.fn(async () => true),
  timelineState: {
    clips: [],
    tracks: [],
    pause: vi.fn(),
    play: vi.fn(),
    loadState: vi.fn(async () => undefined),
    setPlayheadPosition: vi.fn(),
    setCompositionSwitchSourceTracks: vi.fn(),
    setCompositionSwitchTargetTracks: vi.fn(),
    setCompositionSwitchDirection: vi.fn(),
    setClipAnimationPhase: vi.fn(),
    refreshCompClipNestedData: vi.fn(async () => undefined),
    clearTimeline: vi.fn(),
    getSerializableState: vi.fn(() => ({
      clips: [],
      tracks: [],
      duration: 10,
      playheadPosition: 0,
    })),
  },
}));

vi.mock('../../src/services/compositionRenderer', () => ({
  compositionRenderer: {
    invalidateComposition: hoisted.invalidateComposition,
    invalidateCompositionAndParents: vi.fn(),
    prepareComposition: hoisted.prepareComposition,
  },
}));

vi.mock('../../src/services/layerBuilder', () => ({
  playheadState: {
    position: 0,
    isUsingInternalPosition: false,
  },
}));

vi.mock('../../src/stores/timeline', () => ({
  useTimelineStore: {
    getState: () => hoisted.timelineState,
  },
}));

vi.mock('../../src/stores/mediaStore/slices/composition/playbackClock', () => ({
  resetPlaybackClockForCompositionStart: vi.fn(),
  resolvePlayStartTime: vi.fn(() => 0),
}));

vi.mock('../../src/stores/mediaStore/slices/composition/timelineNavigationPlanner', () => ({
  calculateSyncedPlayhead: vi.fn(() => null),
  getCompositionSwitchDirection: vi.fn(() => 'forward'),
}));

vi.mock('../../src/stores/mediaStore/slices/composition/transitionCompositionSync', () => ({
  syncTransitionCompositionTimelineToParent: vi.fn((compositions) => compositions),
}));

import { doSetActiveComposition } from '../../src/stores/mediaStore/slices/composition/timelineSwitchBridge';

describe('composition timeline switch live cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.timelineState.loadState = hoisted.loadState;
  });

  it('rebinds a newly active composition after its live timeline has loaded', async () => {
    const composition = {
      id: 'child-comp',
      name: 'Child',
      type: 'composition' as const,
      parentId: null,
      createdAt: 1,
      width: 1920,
      height: 1080,
      frameRate: 30,
      duration: 10,
      backgroundColor: '#000000',
      timelineData: {
        clips: [],
        tracks: [],
        duration: 10,
        playheadPosition: 0,
        zoom: 50,
        scrollX: 0,
        inPoint: null,
        outPoint: null,
        loopPlayback: false,
      },
    };
    let mediaState = {
      activeCompositionId: null,
      openCompositionIds: [composition.id],
      compositions: [composition],
    } as unknown as MediaState;
    const set = (partial: Partial<MediaState> | ((state: MediaState) => Partial<MediaState>)) => {
      mediaState = {
        ...mediaState,
        ...(typeof partial === 'function' ? partial(mediaState) : partial),
      };
    };

    await doSetActiveComposition(
      set,
      () => mediaState,
      null,
      composition.id,
      [composition],
      { skipAnimation: true },
    );

    expect(hoisted.loadState).toHaveBeenCalledWith(composition.timelineData);
    expect(hoisted.invalidateComposition).toHaveBeenCalledWith(composition.id);
    expect(hoisted.prepareComposition).toHaveBeenCalledWith(composition.id);
    expect(hoisted.loadState.mock.invocationCallOrder[0])
      .toBeLessThan(hoisted.invalidateComposition.mock.invocationCallOrder[0]);
    expect(hoisted.invalidateComposition.mock.invocationCallOrder[0])
      .toBeLessThan(hoisted.prepareComposition.mock.invocationCallOrder[0]);
  });
});
