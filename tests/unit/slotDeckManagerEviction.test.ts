import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flags } from '../../src/engine/featureFlags';
import { useMediaStore } from '../../src/stores/mediaStore';
import { slotDeckManager } from '../../src/services/slotDeckManager';
import type { Composition, SlotDeckState } from '../../src/stores/mediaStore/types';

type MockFn = ReturnType<typeof vi.fn>;

type MockMediaStore = typeof useMediaStore & {
  getState: MockFn;
};

type MockMediaState = {
  files: Array<{
    id: string;
    url: string;
  }>;
  compositions: Composition[];
  slotAssignments: Record<string, number>;
  slotDeckStates: Record<number, SlotDeckState>;
  setSlotDeckState: (slotIndex: number, next: SlotDeckState) => void;
};

const mockedUseMediaStore = useMediaStore as unknown as MockMediaStore;

function createComposition(id: string): Composition {
  return {
    id,
    name: id,
    type: 'composition' as const,
    parentId: null,
    createdAt: 1,
    width: 1920,
    height: 1080,
    frameRate: 30,
    duration: 60,
    backgroundColor: '#000000',
    timelineData: {
      tracks: [],
      clips: [],
      playheadPosition: 0,
      duration: 60,
      zoom: 50,
      scrollX: 0,
      inPoint: null,
      outPoint: null,
      loopPlayback: false,
    },
  };
}

describe('slotDeckManager eviction', () => {
  let mediaState: MockMediaState;
  let currentTimeMs: number;

  const advanceClock = (stepMs = 1_000) => {
    currentTimeMs += stepMs;
    vi.setSystemTime(currentTimeMs);
  };

  const registerSlot = (slotIndex: number) => {
    const compositionId = `comp-${slotIndex}`;
    mediaState.compositions.push(createComposition(compositionId));
    mediaState.slotAssignments[compositionId] = slotIndex;
    return compositionId;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    currentTimeMs = Date.parse('2026-03-17T00:00:00.000Z');
    vi.setSystemTime(currentTimeMs);
    flags.useWarmSlotDecks = true;
    slotDeckManager.disposeAll();

    mediaState = {
      files: [],
      compositions: [],
      slotAssignments: {},
      slotDeckStates: {},
      setSlotDeckState: (slotIndex, next) => {
        mediaState.slotDeckStates = {
          ...mediaState.slotDeckStates,
          [slotIndex]: next,
        };
      },
    };

    mockedUseMediaStore.getState.mockImplementation(
      () => mediaState as unknown as ReturnType<typeof useMediaStore.getState>,
    );
  });

  afterEach(() => {
    slotDeckManager.disposeAll();
    flags.useWarmSlotDecks = false;
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('evicts the least recently used unpinned deck when the soft cap is exceeded', () => {
    for (let slotIndex = 0; slotIndex <= 8; slotIndex += 1) {
      const compositionId = registerSlot(slotIndex);
      slotDeckManager.prepareSlot(slotIndex, compositionId);
      advanceClock();
    }

    expect(slotDeckManager.getSlotState(0)).toBeNull();
    expect(mediaState.slotDeckStates[0]).toMatchObject({
      slotIndex: 0,
      compositionId: null,
      status: 'disposed',
    });
    expect(slotDeckManager.getSlotState(8)).toMatchObject({
      slotIndex: 8,
      compositionId: 'comp-8',
      status: 'warm',
    });
  });

  it('keeps pinned decks and evicts the oldest remaining unpinned deck', () => {
    for (let slotIndex = 0; slotIndex <= 7; slotIndex += 1) {
      const compositionId = registerSlot(slotIndex);
      slotDeckManager.prepareSlot(slotIndex, compositionId);
      advanceClock();
    }

    expect(slotDeckManager.adoptDeckToLayer(0, 100)).toBe(true);
    advanceClock();

    const newestCompositionId = registerSlot(8);
    slotDeckManager.prepareSlot(8, newestCompositionId);

    expect(slotDeckManager.getSlotState(0)).toMatchObject({
      compositionId: 'comp-0',
      status: 'hot',
      pinnedLayerIndex: 100,
    });
    expect(slotDeckManager.getSlotState(1)).toBeNull();
    expect(mediaState.slotDeckStates[1]).toMatchObject({
      slotIndex: 1,
      compositionId: null,
      status: 'disposed',
    });
    expect(slotDeckManager.getSlotState(8)).toMatchObject({
      compositionId: 'comp-8',
      status: 'warm',
    });
  });

  it('allows temporary overflow when only pinned decks would otherwise be evicted, then trims on release', () => {
    for (let slotIndex = 0; slotIndex <= 7; slotIndex += 1) {
      const compositionId = registerSlot(slotIndex);
      slotDeckManager.prepareSlot(slotIndex, compositionId);
      advanceClock();
      expect(slotDeckManager.adoptDeckToLayer(slotIndex, slotIndex)).toBe(true);
      advanceClock();
    }

    const overflowCompositionId = registerSlot(8);
    slotDeckManager.prepareSlot(8, overflowCompositionId);

    expect(slotDeckManager.getSlotState(8)).toMatchObject({
      compositionId: 'comp-8',
      status: 'warm',
      pinnedLayerIndex: null,
    });
    expect(slotDeckManager.getSlotState(0)).toMatchObject({
      compositionId: 'comp-0',
      status: 'hot',
      pinnedLayerIndex: 0,
    });

    slotDeckManager.releaseLayerPin(0, 0);

    expect(slotDeckManager.getSlotState(0)).toBeNull();
    expect(mediaState.slotDeckStates[0]).toMatchObject({
      slotIndex: 0,
      compositionId: null,
      status: 'disposed',
    });
    expect(slotDeckManager.getSlotState(8)).toMatchObject({
      compositionId: 'comp-8',
      status: 'warm',
    });
  });
});
