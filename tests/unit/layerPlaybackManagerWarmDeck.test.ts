import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flags } from '../../src/engine/featureFlags';
import { engine } from '../../src/engine/WebGPUEngine';
import { useMediaStore } from '../../src/stores/mediaStore';
import { layerPlaybackManager } from '../../src/services/layerPlaybackManager';
import { slotDeckManager } from '../../src/services/slotDeckManager';
import { mediaRuntimeRegistry } from '../../src/services/mediaRuntime/registry';
import { timelineRuntimeCoordinator } from '../../src/services/timeline/timelineRuntimeCoordinator';
import type { Composition } from '../../src/stores/mediaStore/types';

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
const noop = () => undefined;
type TestEngine = typeof engine & {
  preCacheVideoFrame?: (video: HTMLVideoElement) => void;
};
let originalPreCacheVideoFrame: TestEngine['preCacheVideoFrame'];
let cleanupVideoSpy: ReturnType<typeof vi.spyOn>;

function createComposition(id: string, options?: Partial<NonNullable<Composition['timelineData']>>): Composition {
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
      tracks: options?.tracks ?? [],
      clips: options?.clips ?? [],
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
    mediaRuntimeRegistry.clear();
    timelineRuntimeCoordinator.clearResources();
    originalPreCacheVideoFrame = (engine as TestEngine).preCacheVideoFrame;
    (engine as TestEngine).preCacheVideoFrame = vi.fn();
    cleanupVideoSpy = vi.spyOn(engine, 'cleanupVideo').mockImplementation(noop);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(noop);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(noop);
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
    mediaRuntimeRegistry.clear();
    timelineRuntimeCoordinator.clearResources();
    if (originalPreCacheVideoFrame) {
      (engine as TestEngine).preCacheVideoFrame = originalPreCacheVideoFrame;
    } else {
      delete (engine as TestEngine).preCacheVideoFrame;
    }
    flags.useWarmSlotDecks = false;
    vi.clearAllMocks();
    vi.restoreAllMocks();
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
    expect(layerPlaybackManager.getLayerState(0)).toMatchObject({
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
    expect(layerPlaybackManager.getLayerState(1)).toMatchObject({
      compositionId: 'comp-1',
      resourceOwnership: 'layer',
      slotIndex: null,
    });

    layerPlaybackManager.deactivateLayer(1);
    expect(mockedSlotDeckManager.releaseLayerPin).not.toHaveBeenCalled();
  });

  it('registers cold-hydrated background layer resources and releases them on deactivate', () => {
    mockedSlotDeckManager.getPreparedDeck.mockReturnValue(null);
    const videoFile = new File(['video'], 'background.mp4', {
      type: 'video/mp4',
      lastModified: 1,
    });
    const clip = {
      id: 'clip-bg',
      trackId: 'track-v1',
      name: 'background.mp4',
      startTime: 0,
      duration: 6,
      inPoint: 0,
      outPoint: 6,
      sourceType: 'video',
      mediaFileId: 'media-bg',
      transform: {
        opacity: 1,
        blendMode: 'normal',
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: { x: 0, y: 0, z: 0 },
      },
      effects: [],
    };
    mockedUseMediaStore.getState.mockReturnValue({
      compositions: [
        createComposition('comp-bg', {
          tracks: [{ id: 'track-v1', type: 'video', visible: true }],
          clips: [clip],
        }),
      ],
      files: [
        {
          id: 'media-bg',
          name: 'background.mp4',
          url: 'blob:background',
          file: videoFile,
          duration: 6,
        },
      ],
      layerOpacities: {},
      slotClipSettings: {},
    });

    const createdVideos: HTMLVideoElement[] = [];
    const actualCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      const element = actualCreateElement(tagName);
      if (tagName === 'video') {
        Object.defineProperty(element, 'duration', { configurable: true, value: 6 });
        createdVideos.push(element as HTMLVideoElement);
      }
      return element;
    }) as typeof document.createElement);

    layerPlaybackManager.activateLayer(2, 'comp-bg', 0, { slotIndex: 5 });
    createdVideos[0].dispatchEvent(new Event('canplaythrough'));

    const backgroundStats = timelineRuntimeCoordinator.getBridgeStats().policies.background;
    expect(backgroundStats.budgetReport.usage).toMatchObject({
      resources: 2,
      sessions: 1,
      htmlMediaElements: 1,
    });
    expect(backgroundStats.resources.map((resource) => resource.kind).toSorted()).toEqual([
      'html-media',
      'runtime-binding',
    ]);

    layerPlaybackManager.deactivateLayer(2);

    expect(cleanupVideoSpy).toHaveBeenCalledWith(createdVideos[0]);
    expect(timelineRuntimeCoordinator.getBridgeStats().policies.background?.resources ?? []).toHaveLength(0);
    expect(mediaRuntimeRegistry.listRuntimes()).toHaveLength(0);
    createElementSpy.mockRestore();
  });

  it('cleans a pending background video when the layer deactivates before readiness', () => {
    mockedSlotDeckManager.getPreparedDeck.mockReturnValue(null);
    const videoFile = new File(['video'], 'background.mp4', {
      type: 'video/mp4',
      lastModified: 1,
    });
    const clip = {
      id: 'clip-bg-pending',
      trackId: 'track-v1',
      name: 'background.mp4',
      startTime: 0,
      duration: 6,
      inPoint: 0,
      outPoint: 6,
      sourceType: 'video',
      mediaFileId: 'media-bg',
      transform: {
        opacity: 1,
        blendMode: 'normal',
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: { x: 0, y: 0, z: 0 },
      },
      effects: [],
    };
    mockedUseMediaStore.getState.mockReturnValue({
      compositions: [
        createComposition('comp-bg-pending', {
          tracks: [{ id: 'track-v1', type: 'video', visible: true }],
          clips: [clip],
        }),
      ],
      files: [
        {
          id: 'media-bg',
          name: 'background.mp4',
          url: 'blob:background',
          file: videoFile,
          duration: 6,
        },
      ],
      layerOpacities: {},
      slotClipSettings: {},
    });

    const createdVideos: HTMLVideoElement[] = [];
    const actualCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      const element = actualCreateElement(tagName);
      if (tagName === 'video') {
        Object.defineProperty(element, 'duration', { configurable: true, value: 6 });
        createdVideos.push(element as HTMLVideoElement);
      }
      return element;
    }) as typeof document.createElement);

    layerPlaybackManager.activateLayer(2, 'comp-bg-pending', 0, { slotIndex: 5 });

    expect(timelineRuntimeCoordinator.getBridgeStats().policies.background.resources).toHaveLength(2);

    layerPlaybackManager.deactivateLayer(2);
    createdVideos[0].dispatchEvent(new Event('canplaythrough'));

    expect(cleanupVideoSpy).toHaveBeenCalledTimes(1);
    expect(cleanupVideoSpy).toHaveBeenCalledWith(createdVideos[0]);
    expect((engine as TestEngine).preCacheVideoFrame).not.toHaveBeenCalled();
    expect(timelineRuntimeCoordinator.getBridgeStats().policies.background?.resources ?? []).toHaveLength(0);
    expect(mediaRuntimeRegistry.listRuntimes()).toHaveLength(0);
    createElementSpy.mockRestore();
  });

  it('cancels pending background image hydration when the layer deactivates', () => {
    mockedSlotDeckManager.getPreparedDeck.mockReturnValue(null);
    const clip = {
      id: 'clip-bg-image',
      trackId: 'track-v1',
      name: 'background.png',
      startTime: 0,
      duration: 6,
      inPoint: 0,
      outPoint: 6,
      sourceType: 'image',
      mediaFileId: 'media-bg-image',
      transform: {
        opacity: 1,
        blendMode: 'normal',
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: { x: 0, y: 0, z: 0 },
      },
      effects: [],
    };
    mockedUseMediaStore.getState.mockReturnValue({
      compositions: [
        createComposition('comp-bg-image', {
          tracks: [{ id: 'track-v1', type: 'video', visible: true }],
          clips: [clip],
        }),
      ],
      files: [
        {
          id: 'media-bg-image',
          name: 'background.png',
          url: 'blob:background-image',
          duration: 6,
        },
      ],
      layerOpacities: {},
      slotClipSettings: {},
    });
    const createdImages: HTMLImageElement[] = [];
    vi.stubGlobal('Image', function MockImage() {
      const image = document.createElement('img');
      createdImages.push(image);
      return image;
    } as unknown as typeof Image);

    layerPlaybackManager.activateLayer(3, 'comp-bg-image', 0, { slotIndex: 5 });
    expect(createdImages).toHaveLength(1);

    layerPlaybackManager.deactivateLayer(3);
    createdImages[0].dispatchEvent(new Event('load'));

    expect(timelineRuntimeCoordinator.getBridgeStats().policies.background.resources).toHaveLength(0);
    expect(mediaRuntimeRegistry.listRuntimes()).toHaveLength(0);
  });

  it('skips background image hydration when the background image budget is full', () => {
    mockedSlotDeckManager.getPreparedDeck.mockReturnValue(null);
    for (let index = 0; index < 32; index += 1) {
      timelineRuntimeCoordinator.retainResource({
        id: `preexisting-background-image-${index}`,
        kind: 'image-canvas',
        policyId: 'background',
        owner: {
          ownerId: `preexisting-background-image-${index}`,
          ownerType: 'clip',
          clipId: `preexisting-background-image-${index}`,
        },
        source: {
          clipId: `preexisting-background-image-${index}`,
        },
        imageKind: 'html-image',
        imageId: `preexisting-background-image-${index}`,
        label: 'Preexisting background image',
      });
    }
    const clip = {
      id: 'clip-bg-image',
      trackId: 'track-v1',
      name: 'background.png',
      startTime: 0,
      duration: 6,
      inPoint: 0,
      outPoint: 6,
      sourceType: 'image',
      mediaFileId: 'media-bg-image',
      transform: {
        opacity: 1,
        blendMode: 'normal',
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: { x: 0, y: 0, z: 0 },
      },
      effects: [],
    };
    mockedUseMediaStore.getState.mockReturnValue({
      compositions: [
        createComposition('comp-bg-image', {
          tracks: [{ id: 'track-v1', type: 'video', visible: true }],
          clips: [clip],
        }),
      ],
      files: [
        {
          id: 'media-bg-image',
          name: 'background.png',
          url: 'blob:background-image',
          duration: 6,
        },
      ],
      layerOpacities: {},
      slotClipSettings: {},
    });
    const createdImages: HTMLImageElement[] = [];
    vi.stubGlobal('Image', function MockImage() {
      const image = document.createElement('img');
      createdImages.push(image);
      return image;
    } as unknown as typeof Image);

    layerPlaybackManager.activateLayer(3, 'comp-bg-image', 0, { slotIndex: 5 });

    expect(createdImages).toHaveLength(0);
    expect(timelineRuntimeCoordinator.getBridgeStats().policies.background.budgetReport.usage.imageBitmaps).toBe(32);
    expect(mediaRuntimeRegistry.listRuntimes()).toHaveLength(0);
  });
});
