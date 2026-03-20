import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flags } from '../../src/engine/featureFlags';
import { useMediaStore } from '../../src/stores/mediaStore';
import { layerPlaybackManager } from '../../src/services/layerPlaybackManager';
import { slotDeckManager } from '../../src/services/slotDeckManager';

vi.mock('../../src/services/slotDeckManager', () => ({
  slotDeckManager: {
    prepareSlot: vi.fn(),
    disposeSlot: vi.fn(),
    disposeAll: vi.fn(),
    adoptDeckToLayer: vi.fn(),
    getSlotState: vi.fn(),
    getPreparedDeck: vi.fn(),
    releaseLayerPin: vi.fn(),
  },
}));

type MockFn = ReturnType<typeof vi.fn>;

type MockMediaStore = typeof useMediaStore & {
  getState: MockFn;
};

const mockedUseMediaStore = useMediaStore as unknown as MockMediaStore;
const mockedSlotDeckManager = slotDeckManager as unknown as {
  adoptDeckToLayer: MockFn;
  getPreparedDeck: MockFn;
  releaseLayerPin: MockFn;
};

function createComposition(id: string) {
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

describe('layerPlaybackManager warm deck adoption', () => {
  beforeEach(() => {
    flags.useWarmSlotDecks = true;
    mockedUseMediaStore.getState.mockReturnValue({
      compositions: [createComposition('comp-1')],
      files: [],
      layerOpacities: {},
    });
    mockedSlotDeckManager.getPreparedDeck.mockReset();
    mockedSlotDeckManager.adoptDeckToLayer.mockReset();
    mockedSlotDeckManager.releaseLayerPin.mockReset();
    layerPlaybackManager.deactivateAll();
  });

  afterEach(() => {
    layerPlaybackManager.deactivateAll();
    flags.useWarmSlotDecks = false;
    vi.clearAllMocks();
  });

  it('adopts a prepared slot deck without cold-hydrating the layer again', () => {
    const videoPause = vi.fn();
    const audioPause = vi.fn();
    mockedSlotDeckManager.getPreparedDeck.mockReturnValue({
      slotIndex: 0,
      compositionId: 'comp-1',
      composition: createComposition('comp-1'),
      tracks: [],
      duration: 60,
      clips: [
        {
          id: 'clip-1',
          source: {
            videoElement: { pause: videoPause },
            audioElement: { pause: audioPause },
          },
        },
      ],
    });
    mockedSlotDeckManager.adoptDeckToLayer.mockReturnValue(true);

    layerPlaybackManager.activateLayer(0, 'comp-1', 2, { slotIndex: 0 });

    expect(mockedSlotDeckManager.getPreparedDeck).toHaveBeenCalledWith(0, 'comp-1');
    expect(mockedSlotDeckManager.adoptDeckToLayer).toHaveBeenCalledWith(0, 0, 2);
    expect((layerPlaybackManager.getLayerState(0) as any)).toMatchObject({
      compositionId: 'comp-1',
      resourceOwnership: 'slot-deck',
      slotIndex: 0,
    });

    layerPlaybackManager.deactivateLayer(0);

    expect(videoPause).toHaveBeenCalled();
    expect(audioPause).toHaveBeenCalled();
    expect(mockedSlotDeckManager.releaseLayerPin).toHaveBeenCalledWith(0, 0);
    expect(layerPlaybackManager.getLayerState(0)).toBeUndefined();
  });

  it('falls back to normal layer ownership when no prepared deck is available', () => {
    mockedSlotDeckManager.getPreparedDeck.mockReturnValue(null);

    layerPlaybackManager.activateLayer(1, 'comp-1', 0, { slotIndex: 3 });

    expect(mockedSlotDeckManager.adoptDeckToLayer).not.toHaveBeenCalled();
    expect((layerPlaybackManager.getLayerState(1) as any)).toMatchObject({
      compositionId: 'comp-1',
      resourceOwnership: 'layer',
      slotIndex: null,
    });

    layerPlaybackManager.deactivateLayer(1);
    expect(mockedSlotDeckManager.releaseLayerPin).not.toHaveBeenCalled();
  });
});
