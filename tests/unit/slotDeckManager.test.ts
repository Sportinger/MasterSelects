import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flags } from '../../src/engine/featureFlags';
import { engine } from '../../src/engine/WebGPUEngine';
import { useMediaStore } from '../../src/stores/mediaStore';
import { slotDeckManager } from '../../src/services/slotDeckManager';
import { mediaRuntimeRegistry } from '../../src/services/mediaRuntime/registry';
import { timelineRuntimeCoordinator } from '../../src/services/timeline/timelineRuntimeCoordinator';
import type { Composition, SlotDeckState } from '../../src/stores/mediaStore/types';
import type { TimelineClip, TimelineTrack } from '../../src/types';

vi.mock('../../src/services/mediaRuntime/clipBindings', () => ({
  bindSourceRuntimeForOwner: vi.fn(({ ownerId, source }) => ({
    ...source,
    runtimeSourceId: `runtime:${ownerId}`,
    runtimeSessionKey: `session:${ownerId}`,
  })),
  planSourceRuntimeBindingForOwner: vi.fn(({ ownerId, source }) => ({
    source: {
      ...source,
      runtimeSourceId: `runtime:${ownerId}`,
      runtimeSessionKey: `session:${ownerId}`,
    },
    runtimeSourceId: `runtime:${ownerId}`,
    runtimeSessionKey: `session:${ownerId}`,
    mediaFileId: source.mediaFileId,
  })),
}));

vi.mock('../../src/services/mediaRuntime/registry', () => ({
  mediaRuntimeRegistry: {
    releaseSession: vi.fn(),
    releaseRuntime: vi.fn(),
    clear: vi.fn(),
    listRuntimes: vi.fn(() => []),
  },
}));

type MockFn = ReturnType<typeof vi.fn>;

type MockMediaStore = typeof useMediaStore & {
  getState: MockFn;
};

type MockMediaState = {
  files: Array<{
    id: string;
    url: string;
    duration?: number;
    width?: number;
    height?: number;
    fps?: number;
  }>;
  compositions: Composition[];
  slotAssignments: Record<string, number>;
  slotDeckStates: Record<number, SlotDeckState>;
  setSlotDeckState: (slotIndex: number, next: SlotDeckState) => void;
};

const mockedUseMediaStore = useMediaStore as unknown as MockMediaStore;

function createComposition(
  id: string,
  options?: { clips?: TimelineClip[]; tracks?: TimelineTrack[]; duration?: number },
): Composition {
  return {
    id,
    name: id,
    type: 'composition' as const,
    parentId: null,
    createdAt: 1,
    width: 1920,
    height: 1080,
    frameRate: 30,
    duration: options?.duration ?? 60,
    backgroundColor: '#000000',
    timelineData: {
      tracks: options?.tracks ?? [],
      clips: options?.clips ?? [],
      playheadPosition: 0,
      duration: options?.duration ?? 60,
      zoom: 50,
      scrollX: 0,
      inPoint: null,
      outPoint: null,
      loopPlayback: false,
    },
  };
}

describe('slotDeckManager', () => {
  let mediaState: MockMediaState;
  let createElementSpy: ReturnType<typeof vi.spyOn> | null = null;
  let cleanupVideoSpy: ReturnType<typeof vi.spyOn>;
  const noop = () => undefined;

  beforeEach(() => {
    flags.useWarmSlotDecks = true;
    slotDeckManager.disposeAll();
    timelineRuntimeCoordinator.clearResources();
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(noop);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(noop);
    cleanupVideoSpy = vi.spyOn(engine, 'cleanupVideo').mockImplementation(noop);

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
    createElementSpy?.mockRestore();
    createElementSpy = null;
    slotDeckManager.disposeAll();
    timelineRuntimeCoordinator.clearResources();
    flags.useWarmSlotDecks = false;
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('prepares an empty composition deck and exposes warm state', () => {
    mediaState.compositions = [createComposition('comp-empty')];
    mediaState.slotAssignments = { 'comp-empty': 0 };

    slotDeckManager.prepareSlot(0, 'comp-empty');

    expect(slotDeckManager.getSlotState(0)).toMatchObject({
      slotIndex: 0,
      compositionId: 'comp-empty',
      status: 'warm',
      firstFrameReady: true,
    });
    expect(mediaState.slotDeckStates[0]).toMatchObject({
      compositionId: 'comp-empty',
      status: 'warm',
    });

    expect(slotDeckManager.adoptDeckToLayer(0, 1)).toBe(true);
    expect(mediaState.slotDeckStates[0]).toMatchObject({
      status: 'hot',
      pinnedLayerIndex: 1,
    });

    slotDeckManager.releaseLayerPin(0, 1);
    expect(mediaState.slotDeckStates[0]).toMatchObject({
      status: 'hot',
      pinnedLayerIndex: null,
    });
  });

  it('promotes a visual deck to hot after media readiness and releases runtime ownership on dispose', () => {
    const videoClip = {
      id: 'clip-1',
      trackId: 'video-track',
      name: 'Video Clip',
      startTime: 0,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      sourceType: 'video',
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
    mediaState.compositions = [
      createComposition('comp-video', {
        tracks: [{ id: 'video-track', type: 'video', visible: true }],
        clips: [videoClip],
      }),
    ];
    mediaState.files = [{ id: 'media-1', url: 'blob:test-video', duration: 5 }];
    mediaState.slotAssignments = { 'comp-video': 0 };

    const createdVideos: HTMLVideoElement[] = [];
    const actualCreateElement = document.createElement.bind(document);
    createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      const element = actualCreateElement(tagName);
      if (tagName === 'video') {
        Object.defineProperty(element, 'duration', { configurable: true, value: 5 });
        createdVideos.push(element as HTMLVideoElement);
      }
      return element;
    }) as typeof document.createElement);

    slotDeckManager.prepareSlot(0, 'comp-video');
    expect(slotDeckManager.getSlotState(0)).toMatchObject({
      status: 'warming',
      preparedClipCount: 1,
      readyClipCount: 0,
    });

    createdVideos[0].dispatchEvent(new Event('canplaythrough'));

    expect(slotDeckManager.getSlotState(0)).toMatchObject({
      status: 'hot',
      readyClipCount: 1,
      firstFrameReady: true,
      decoderMode: 'html',
    });

    const preparedDeck = slotDeckManager.getPreparedDeck(0, 'comp-video');
    expect(preparedDeck?.clips[0].source).toMatchObject({
      runtimeSourceId: 'runtime:slot-deck:0:clip-1',
      runtimeSessionKey: 'session:slot-deck:0:clip-1',
    });
    expect(timelineRuntimeCoordinator.getBridgeStats().policies['slot-deck']).toMatchObject({
      budgetReport: {
        usage: {
          resources: 2,
          sessions: 1,
          htmlMediaElements: 1,
        },
      },
    });

    slotDeckManager.disposeSlot(0);

    expect(mediaState.slotDeckStates[0]).toMatchObject({
      status: 'disposed',
      compositionId: null,
    });
    expect(mediaRuntimeRegistry.releaseSession).toHaveBeenCalledWith(
      'runtime:slot-deck:0:clip-1',
      'session:slot-deck:0:clip-1'
    );
    expect(mediaRuntimeRegistry.releaseRuntime).toHaveBeenCalledWith(
      'runtime:slot-deck:0:clip-1',
      'slot-deck:0:clip-1'
    );
    expect(cleanupVideoSpy).toHaveBeenCalledWith(createdVideos[0]);
    expect(timelineRuntimeCoordinator.getBridgeStats().policies['slot-deck']?.resources ?? []).toHaveLength(0);
  });

  it('cleans a pending slot video when the deck is disposed before readiness', () => {
    const videoClip = {
      id: 'clip-pending',
      trackId: 'video-track',
      name: 'Video Clip',
      startTime: 0,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      sourceType: 'video',
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
    mediaState.compositions = [
      createComposition('comp-video-pending', {
        tracks: [{ id: 'video-track', type: 'video', visible: true }],
        clips: [videoClip],
      }),
    ];
    mediaState.files = [{ id: 'media-1', url: 'blob:test-video', duration: 5 }];
    mediaState.slotAssignments = { 'comp-video-pending': 0 };

    const createdVideos: HTMLVideoElement[] = [];
    const actualCreateElement = document.createElement.bind(document);
    createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      const element = actualCreateElement(tagName);
      if (tagName === 'video') {
        Object.defineProperty(element, 'duration', { configurable: true, value: 5 });
        createdVideos.push(element as HTMLVideoElement);
      }
      return element;
    }) as typeof document.createElement);

    slotDeckManager.prepareSlot(0, 'comp-video-pending');

    expect(slotDeckManager.getSlotState(0)).toMatchObject({
      status: 'warming',
      preparedClipCount: 1,
      readyClipCount: 0,
    });
    expect(timelineRuntimeCoordinator.getBridgeStats().policies['slot-deck'].resources).toHaveLength(2);

    slotDeckManager.disposeSlot(0);
    createdVideos[0].dispatchEvent(new Event('canplaythrough'));

    expect(mediaState.slotDeckStates[0]).toMatchObject({
      status: 'disposed',
      compositionId: null,
    });
    expect(cleanupVideoSpy).toHaveBeenCalledTimes(1);
    expect(cleanupVideoSpy).toHaveBeenCalledWith(createdVideos[0]);
    expect(timelineRuntimeCoordinator.getBridgeStats().policies['slot-deck']?.resources ?? []).toHaveLength(0);
    expect(mediaRuntimeRegistry.releaseRuntime).not.toHaveBeenCalledWith(
      'runtime:slot-deck:0:clip-pending',
      'slot-deck:0:clip-pending'
    );
  });

  it('cancels pending slot image hydration when the deck is disposed', () => {
    const imageClip = {
      id: 'clip-image',
      trackId: 'video-track',
      name: 'Image Clip',
      startTime: 0,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      sourceType: 'image',
      mediaFileId: 'media-image',
      transform: {
        opacity: 1,
        blendMode: 'normal',
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: { x: 0, y: 0, z: 0 },
      },
      effects: [],
    };
    mediaState.compositions = [
      createComposition('comp-image', {
        tracks: [{ id: 'video-track', type: 'video', visible: true }],
        clips: [imageClip],
      }),
    ];
    mediaState.files = [{ id: 'media-image', url: 'blob:test-image', duration: 5 }];
    mediaState.slotAssignments = { 'comp-image': 0 };
    const createdImages: HTMLImageElement[] = [];
    vi.stubGlobal('Image', function MockImage() {
      const image = document.createElement('img');
      createdImages.push(image);
      return image;
    } as unknown as typeof Image);

    slotDeckManager.prepareSlot(0, 'comp-image');
    expect(slotDeckManager.getSlotState(0)).toMatchObject({
      status: 'warming',
      preparedClipCount: 1,
      readyClipCount: 0,
    });

    slotDeckManager.disposeSlot(0);
    createdImages[0].dispatchEvent(new Event('load'));

    expect(mediaState.slotDeckStates[0]).toMatchObject({
      status: 'disposed',
      compositionId: null,
    });
    expect(timelineRuntimeCoordinator.getBridgeStats().policies['slot-deck'].resources).toHaveLength(0);
    expect(mediaRuntimeRegistry.releaseRuntime).not.toHaveBeenCalledWith(
      'runtime:slot-deck:0:clip-image',
      'slot-deck:0:clip-image'
    );
  });

  it('skips slot image hydration when the slot-deck image budget is full', () => {
    for (let index = 0; index < 48; index += 1) {
      timelineRuntimeCoordinator.retainResource({
        id: `preexisting-slot-image-${index}`,
        kind: 'image-canvas',
        policyId: 'slot-deck',
        owner: {
          ownerId: `preexisting-slot-image-${index}`,
          ownerType: 'slot',
          clipId: `preexisting-slot-image-${index}`,
        },
        source: {
          clipId: `preexisting-slot-image-${index}`,
        },
        imageKind: 'html-image',
        imageId: `preexisting-slot-image-${index}`,
        label: 'Preexisting slot image',
      });
    }
    const imageClip = {
      id: 'clip-image',
      trackId: 'video-track',
      name: 'Image Clip',
      startTime: 0,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      sourceType: 'image',
      mediaFileId: 'media-image',
      transform: {
        opacity: 1,
        blendMode: 'normal',
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: { x: 0, y: 0, z: 0 },
      },
      effects: [],
    };
    mediaState.compositions = [
      createComposition('comp-image', {
        tracks: [{ id: 'video-track', type: 'video', visible: true }],
        clips: [imageClip],
      }),
    ];
    mediaState.files = [{ id: 'media-image', url: 'blob:test-image', duration: 5 }];
    mediaState.slotAssignments = { 'comp-image': 0 };
    const createdImages: HTMLImageElement[] = [];
    vi.stubGlobal('Image', function MockImage() {
      const image = document.createElement('img');
      createdImages.push(image);
      return image;
    } as unknown as typeof Image);

    slotDeckManager.prepareSlot(0, 'comp-image');

    expect(createdImages).toHaveLength(0);
    expect(slotDeckManager.getSlotState(0)).toMatchObject({
      status: 'warm',
      preparedClipCount: 0,
      readyClipCount: 0,
      firstFrameReady: true,
    });
    expect(timelineRuntimeCoordinator.getBridgeStats().policies['slot-deck'].budgetReport.usage.imageBitmaps).toBe(48);
    expect(mediaRuntimeRegistry.releaseRuntime).not.toHaveBeenCalled();
  });

  it('re-prepares the newly assigned composition after a pinned deck is released', () => {
    mediaState.compositions = [
      createComposition('comp-old'),
      createComposition('comp-new'),
    ];
    mediaState.slotAssignments = { 'comp-old': 0 };

    slotDeckManager.prepareSlot(0, 'comp-old');
    expect(slotDeckManager.adoptDeckToLayer(0, 2)).toBe(true);

    mediaState.slotAssignments = { 'comp-new': 0 };
    slotDeckManager.prepareSlot(0, 'comp-new');

    expect(mediaState.slotDeckStates[0]).toMatchObject({
      compositionId: 'comp-new',
      status: 'warming',
      pinnedLayerIndex: 2,
    });

    slotDeckManager.releaseLayerPin(0, 2);

    expect(slotDeckManager.getSlotState(0)).toMatchObject({
      compositionId: 'comp-new',
      status: 'warm',
      pinnedLayerIndex: null,
    });
  });
});
