import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compositionRenderer } from '../../src/services/compositionRenderer';
import { mediaRuntimeRegistry } from '../../src/services/mediaRuntime/registry';
import { textRenderer } from '../../src/services/textRenderer';
import { timelineRuntimeCoordinator } from '../../src/services/timeline/timelineRuntimeCoordinator';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';
import type { Composition } from '../../src/stores/mediaStore/types';
import type { SerializableClip, TimelineClip, TimelineTrack } from '../../src/types';

type MockMediaStore = typeof useMediaStore & {
  getState: ReturnType<typeof vi.fn>;
};

const mockedUseMediaStore = useMediaStore as unknown as MockMediaStore;

const defaultTransform = {
  opacity: 1,
  blendMode: 'normal' as const,
  position: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1 },
  rotation: { x: 0, y: 0, z: 0 },
};

const tracks: TimelineTrack[] = [
  {
    id: 'video-track',
    name: 'Video 1',
    type: 'video',
    height: 60,
    muted: false,
    visible: true,
    solo: false,
  },
];

function makeComposition(id: string, clips: SerializableClip[]): Composition {
  return {
    id,
    name: id,
    type: 'composition',
    parentId: null,
    createdAt: 1,
    width: 1920,
    height: 1080,
    frameRate: 30,
    duration: 10,
    backgroundColor: '#000000',
    timelineData: {
      tracks,
      clips,
      playheadPosition: 0,
      duration: 10,
      zoom: 50,
      scrollX: 0,
      inPoint: null,
      outPoint: null,
      loopPlayback: false,
    },
  };
}

function makeVideoClip(): SerializableClip {
  return {
    id: 'clip-video',
    trackId: 'video-track',
    name: 'Video Clip',
    mediaFileId: 'media-video',
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    sourceType: 'video',
    naturalDuration: 5,
    transform: defaultTransform,
    effects: [],
  };
}

function makeImageClip(): SerializableClip {
  return {
    id: 'clip-image',
    trackId: 'video-track',
    name: 'Image Clip',
    mediaFileId: 'media-image',
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    sourceType: 'image',
    naturalDuration: 5,
    transform: defaultTransform,
    effects: [],
  };
}

function makeActiveImageClip(): TimelineClip {
  return {
    id: 'clip-image',
    trackId: 'video-track',
    name: 'Image Clip',
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    source: {
      type: 'image',
      mediaFileId: 'media-image',
      imageUrl: 'blob:active-image',
      naturalDuration: 5,
    },
    transform: defaultTransform,
    effects: [],
    isLoading: false,
  } as TimelineClip;
}

function makeActiveNestedImageCompositionClip(): TimelineClip {
  const nestedTrack: TimelineTrack = {
    ...tracks[0],
    id: 'nested-video-track',
    name: 'Nested Video 1',
  };
  const nestedImageClip: TimelineClip = {
    id: 'nested-image',
    trackId: nestedTrack.id,
    name: 'Nested Image',
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    source: {
      type: 'image',
      mediaFileId: 'media-image',
      imageUrl: 'blob:nested-image',
      naturalDuration: 5,
    },
    transform: defaultTransform,
    effects: [],
    isLoading: false,
  } as TimelineClip;

  return {
    id: 'clip-comp',
    trackId: 'video-track',
    name: 'Nested Comp Clip',
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    source: {
      type: 'video',
      naturalDuration: 5,
    },
    transform: defaultTransform,
    effects: [],
    isLoading: false,
    isComposition: true,
    compositionId: 'nested-comp',
    nestedTracks: [nestedTrack],
    nestedClips: [nestedImageClip],
  } as TimelineClip;
}

function makeTextClip(): SerializableClip {
  return {
    id: 'clip-text',
    trackId: 'video-track',
    name: 'Text Clip',
    mediaFileId: '',
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    sourceType: 'text',
    naturalDuration: 5,
    transform: defaultTransform,
    effects: [],
    textProperties: {
      text: 'Hello',
      fontSize: 48,
      fontFamily: 'Arial',
      color: '#ffffff',
      backgroundColor: 'transparent',
      align: 'center',
      verticalAlign: 'middle',
    },
  };
}

describe('compositionRenderer runtime reporting', () => {
  beforeEach(() => {
    compositionRenderer.disposeComposition('comp-render');
    timelineRuntimeCoordinator.clearResources();
    mediaRuntimeRegistry.clear();
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:composition-video');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    useTimelineStore.setState({ clips: [], tracks });
    mockedUseMediaStore.getState.mockReturnValue({
      activeCompositionId: 'active-comp',
      compositions: [],
      files: [],
      activeLayerSlots: {},
    });
  });

  afterEach(() => {
    compositionRenderer.disposeComposition('comp-render');
    timelineRuntimeCoordinator.clearResources();
    mediaRuntimeRegistry.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reports non-active video composition sources and releases them on dispose', async () => {
    const clip = makeVideoClip();
    const videoFile = new File(['video'], 'video.mp4', {
      type: 'video/mp4',
      lastModified: 1,
    });
    const createdVideos: HTMLVideoElement[] = [];
    const actualCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      const element = actualCreateElement(tagName);
      if (tagName === 'video') {
        Object.defineProperty(element, 'duration', { configurable: true, value: 5 });
        createdVideos.push(element as HTMLVideoElement);
      }
      return element;
    }) as typeof document.createElement);

    mockedUseMediaStore.getState.mockReturnValue({
      activeCompositionId: 'active-comp',
      compositions: [makeComposition('comp-render', [clip])],
      files: [
        {
          id: 'media-video',
          name: 'video.mp4',
          type: 'video',
          parentId: null,
          createdAt: 1,
          file: videoFile,
          url: 'blob:media-video',
          duration: 5,
        },
      ],
      activeLayerSlots: {},
    });

    const prepare = compositionRenderer.prepareComposition('comp-render');
    await vi.waitFor(() => expect(createdVideos).toHaveLength(1));
    createdVideos[0].dispatchEvent(new Event('canplaythrough'));
    await expect(prepare).resolves.toBe(true);

    const stats = timelineRuntimeCoordinator.getBridgeStats().policies['composition-render'];
    expect(stats.budgetReport.usage).toMatchObject({
      resources: 2,
      sessions: 1,
      htmlMediaElements: 1,
    });
    expect(stats.resources.map((resource) => resource.kind).toSorted()).toEqual([
      'html-media',
      'runtime-binding',
    ]);
    expect(stats.resources[0].owner).toMatchObject({
      ownerId: 'composition:comp-render:clip:clip-video',
      ownerType: 'composition',
      clipId: 'clip-video',
      compositionId: 'comp-render',
      mediaFileId: 'media-video',
    });
    expect(stats.resources.every((resource) =>
      resource.tags?.includes('runtime-provider-demand') &&
      resource.tags?.includes('background-cache')
    )).toBe(true);

    compositionRenderer.disposeComposition('comp-render');

    expect(timelineRuntimeCoordinator.getBridgeStats().policies['composition-render'].resources).toHaveLength(0);
    expect(mediaRuntimeRegistry.listRuntimes()).toHaveLength(0);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:composition-video');
  });

  it('cleans up stale video loads after invalidation without reporting resources', async () => {
    const clip = makeVideoClip();
    const videoFile = new File(['video'], 'video.mp4', {
      type: 'video/mp4',
      lastModified: 1,
    });
    const createdVideos: HTMLVideoElement[] = [];
    const actualCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      const element = actualCreateElement(tagName);
      if (tagName === 'video') {
        Object.defineProperty(element, 'duration', { configurable: true, value: 5 });
        createdVideos.push(element as HTMLVideoElement);
      }
      return element;
    }) as typeof document.createElement);

    mockedUseMediaStore.getState.mockReturnValue({
      activeCompositionId: 'active-comp',
      compositions: [makeComposition('comp-render', [clip])],
      files: [
        {
          id: 'media-video',
          name: 'video.mp4',
          type: 'video',
          parentId: null,
          createdAt: 1,
          file: videoFile,
          url: 'blob:media-video',
          duration: 5,
        },
      ],
      activeLayerSlots: {},
    });

    const prepare = compositionRenderer.prepareComposition('comp-render');
    await vi.waitFor(() => expect(createdVideos).toHaveLength(1));

    compositionRenderer.invalidateComposition('comp-render');

    await expect(prepare).resolves.toBe(false);
    createdVideos[0].dispatchEvent(new Event('canplaythrough'));

    const stats = timelineRuntimeCoordinator.getBridgeStats().policies['composition-render'];
    expect(stats.resources).toHaveLength(0);
    expect(mediaRuntimeRegistry.listRuntimes()).toHaveLength(0);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:composition-video');
  });

  it('cleans up pending video loads on dispose without waiting for canplaythrough', async () => {
    const clip = makeVideoClip();
    const videoFile = new File(['video'], 'video.mp4', {
      type: 'video/mp4',
      lastModified: 1,
    });
    const createdVideos: HTMLVideoElement[] = [];
    const actualCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      const element = actualCreateElement(tagName);
      if (tagName === 'video') {
        Object.defineProperty(element, 'duration', { configurable: true, value: 5 });
        createdVideos.push(element as HTMLVideoElement);
      }
      return element;
    }) as typeof document.createElement);

    mockedUseMediaStore.getState.mockReturnValue({
      activeCompositionId: 'active-comp',
      compositions: [makeComposition('comp-render', [clip])],
      files: [
        {
          id: 'media-video',
          name: 'video.mp4',
          type: 'video',
          parentId: null,
          createdAt: 1,
          file: videoFile,
          url: 'blob:media-video',
          duration: 5,
        },
      ],
      activeLayerSlots: {},
    });

    const prepare = compositionRenderer.prepareComposition('comp-render');
    await vi.waitFor(() => expect(createdVideos).toHaveLength(1));

    compositionRenderer.disposeComposition('comp-render');

    await expect(prepare).resolves.toBe(false);
    createdVideos[0].dispatchEvent(new Event('canplaythrough'));

    const stats = timelineRuntimeCoordinator.getBridgeStats().policies['composition-render'];
    expect(stats.resources).toHaveLength(0);
    expect(mediaRuntimeRegistry.listRuntimes()).toHaveLength(0);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:composition-video');
  });

  it('cleans up pending image loads on dispose without waiting for onload', async () => {
    const clip = makeImageClip();
    const imageFile = new File(['image'], 'image.png', {
      type: 'image/png',
      lastModified: 1,
    });
    const createdImages: HTMLImageElement[] = [];
    vi.stubGlobal('Image', function MockImage() {
      const image = document.createElement('img');
      createdImages.push(image);
      return image;
    } as unknown as typeof Image);

    mockedUseMediaStore.getState.mockReturnValue({
      activeCompositionId: 'active-comp',
      compositions: [makeComposition('comp-render', [clip])],
      files: [
        {
          id: 'media-image',
          name: 'image.png',
          type: 'image',
          parentId: null,
          createdAt: 1,
          file: imageFile,
          duration: 5,
        },
      ],
      activeLayerSlots: {},
    });

    const prepare = compositionRenderer.prepareComposition('comp-render');
    await vi.waitFor(() => expect(createdImages).toHaveLength(1));

    compositionRenderer.disposeComposition('comp-render');

    await expect(prepare).resolves.toBe(false);
    createdImages[0].dispatchEvent(new Event('load'));

    const stats = timelineRuntimeCoordinator.getBridgeStats().policies['composition-render'];
    expect(stats.resources).toHaveLength(0);
    expect(mediaRuntimeRegistry.listRuntimes()).toHaveLength(0);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:composition-video');
  });

  it('prepares active restored image clips from imageUrl without mutating clip source', async () => {
    const clip = makeActiveImageClip();
    const createdImages: HTMLImageElement[] = [];
    vi.stubGlobal('Image', function MockImage() {
      const image = document.createElement('img');
      createdImages.push(image);
      return image;
    } as unknown as typeof Image);

    useTimelineStore.setState({ clips: [clip], tracks });
    mockedUseMediaStore.getState.mockReturnValue({
      activeCompositionId: 'comp-render',
      compositions: [makeComposition('comp-render', [])],
      files: [
        {
          id: 'media-image',
          name: 'image.png',
          type: 'image',
          parentId: null,
          createdAt: 1,
          url: 'blob:media-image',
          duration: 5,
        },
      ],
      activeLayerSlots: {},
    });

    const prepare = compositionRenderer.prepareComposition('comp-render');
    await vi.waitFor(() => expect(createdImages).toHaveLength(1));
    expect(createdImages[0].src).toBe('blob:active-image');
    expect(timelineRuntimeCoordinator.getBridgeStats().policies['composition-render'].resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'composition-render:comp-render:clip-image:image-canvas:image',
          kind: 'image-canvas',
          tags: expect.arrayContaining([
            'runtime-provider-demand',
            'background-cache',
            'composition-render',
            'image',
          ]),
        }),
      ])
    );

    createdImages[0].dispatchEvent(new Event('load'));
    await expect(prepare).resolves.toBe(true);

    expect(clip.source?.imageElement).toBeUndefined();

    const layers = compositionRenderer.evaluateAtTime('comp-render', 0);
    expect(layers).toHaveLength(1);
    expect(layers[0].source).toMatchObject({
      type: 'image',
      imageElement: createdImages[0],
    });

    const stats = timelineRuntimeCoordinator.getBridgeStats().policies['composition-render'];
    expect(stats.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'image-canvas',
          imageKind: 'html-image',
          tags: expect.arrayContaining([
            'runtime-provider-demand',
            'background-cache',
            'composition-render',
          ]),
          owner: expect.objectContaining({
            clipId: 'clip-image',
            compositionId: 'comp-render',
            mediaFileId: 'media-image',
          }),
        }),
      ])
    );

    compositionRenderer.disposeComposition('comp-render');

    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:active-image');
  });

  it('prepares active nested restored image clips from imageUrl for nested composition layers', async () => {
    const clip = makeActiveNestedImageCompositionClip();
    const nestedImageClip = clip.nestedClips?.[0];
    const createdImages: HTMLImageElement[] = [];
    vi.stubGlobal('Image', function MockImage() {
      const image = document.createElement('img');
      createdImages.push(image);
      return image;
    } as unknown as typeof Image);

    useTimelineStore.setState({ clips: [clip], tracks });
    mockedUseMediaStore.getState.mockReturnValue({
      activeCompositionId: 'comp-render',
      compositions: [
        makeComposition('comp-render', []),
        makeComposition('nested-comp', []),
      ],
      files: [
        {
          id: 'media-image',
          name: 'nested.png',
          type: 'image',
          parentId: null,
          createdAt: 1,
          url: 'blob:media-image',
          duration: 5,
        },
      ],
      activeLayerSlots: {},
    });

    const prepare = compositionRenderer.prepareComposition('comp-render');
    await vi.waitFor(() => expect(createdImages).toHaveLength(1));
    expect(createdImages[0].src).toBe('blob:nested-image');

    createdImages[0].dispatchEvent(new Event('load'));
    await expect(prepare).resolves.toBe(true);

    expect(nestedImageClip?.source?.imageElement).toBeUndefined();

    const layers = compositionRenderer.evaluateAtTime('comp-render', 0);
    const nestedLayers = layers[0]?.source?.nestedComposition?.layers ?? [];
    expect(nestedLayers).toHaveLength(1);
    expect(nestedLayers[0].source).toMatchObject({
      type: 'image',
      imageElement: createdImages[0],
    });
  });

  it('renders transitions inside active nested composition clips as hidden transition comps', async () => {
    const nestedTrack: TimelineTrack = {
      ...tracks[0],
      id: 'nested-video-track',
      name: 'Nested Video 1',
    };
    const transition = {
      id: 'nested-transition',
      type: 'crossfade',
      duration: 1,
      linkedClipId: 'nested-incoming',
      compositionId: 'transition-comp',
    };
    const nestedOutgoing = {
      id: 'nested-outgoing',
      trackId: nestedTrack.id,
      name: 'Nested Out',
      startTime: 0,
      duration: 2,
      inPoint: 0,
      outPoint: 2,
      source: { type: 'image', naturalDuration: 2 },
      transform: defaultTransform,
      effects: [],
      transitionOut: transition,
      isLoading: false,
    } as TimelineClip;
    const nestedIncoming = {
      id: 'nested-incoming',
      trackId: nestedTrack.id,
      name: 'Nested In',
      startTime: 2,
      duration: 2,
      inPoint: 0,
      outPoint: 2,
      source: { type: 'image', naturalDuration: 2 },
      transform: defaultTransform,
      effects: [],
      transitionIn: {
        ...transition,
        linkedClipId: 'nested-outgoing',
      },
      isLoading: false,
    } as TimelineClip;
    const compClip = {
      id: 'clip-comp',
      trackId: 'video-track',
      name: 'Nested Comp Clip',
      startTime: 0,
      duration: 4,
      inPoint: 0,
      outPoint: 4,
      source: { type: 'video', naturalDuration: 4 },
      transform: defaultTransform,
      effects: [],
      isLoading: false,
      isComposition: true,
      compositionId: 'nested-comp',
      nestedTracks: [nestedTrack],
      nestedClips: [nestedOutgoing, nestedIncoming],
    } as TimelineClip;

    useTimelineStore.setState({ clips: [compClip], tracks });
    mockedUseMediaStore.getState.mockReturnValue({
      activeCompositionId: 'comp-render',
      compositions: [
        makeComposition('comp-render', []),
        makeComposition('nested-comp', []),
        {
          ...makeComposition('transition-comp', []),
          transitionComp: {
            kind: 'transition-comp',
            parentCompositionId: 'nested-comp',
            parentTransitionId: 'nested-transition',
            parentOutgoingClipId: 'nested-outgoing',
            parentIncomingClipId: 'nested-incoming',
            linkedOutgoingClipId: 'transition-outgoing',
            linkedIncomingClipId: 'transition-incoming',
            innerTransitionId: '',
            paddingBefore: 0,
            paddingAfter: 0,
            bodyStart: 0,
            bodyEnd: 1,
            materialized: true,
          },
        },
      ],
      files: [],
      activeLayerSlots: {},
    });

    await expect(compositionRenderer.prepareComposition('comp-render')).resolves.toBe(true);

    const layers = compositionRenderer.evaluateAtTime('comp-render', 1.75);
    const nestedLayers = layers[0]?.source?.nestedComposition?.layers ?? [];

    expect(nestedLayers).toHaveLength(1);
    expect(nestedLayers[0].source?.nestedComposition?.compositionId).toBe('transition-comp');
  });

  it('skips composition image hydration when the composition-render image budget is full', async () => {
    for (let index = 0; index < 96; index += 1) {
      timelineRuntimeCoordinator.retainResource({
        id: `preexisting-composition-image-${index}`,
        kind: 'image-canvas',
        policyId: 'composition-render',
        owner: {
          ownerId: `preexisting-composition-image-${index}`,
          ownerType: 'composition',
          clipId: `preexisting-composition-image-${index}`,
          compositionId: 'comp-render',
        },
        source: {
          clipId: `preexisting-composition-image-${index}`,
          compositionId: 'comp-render',
        },
        imageKind: 'html-image',
        imageId: `preexisting-composition-image-${index}`,
        label: 'Preexisting composition image',
      });
    }
    const clip = makeImageClip();
    const createdImages: HTMLImageElement[] = [];
    vi.stubGlobal('Image', function MockImage() {
      const image = document.createElement('img');
      createdImages.push(image);
      return image;
    } as unknown as typeof Image);

    mockedUseMediaStore.getState.mockReturnValue({
      activeCompositionId: null,
      compositions: [makeComposition('comp-render', [clip])],
      files: [
        {
          id: 'media-image',
          name: 'image.png',
          type: 'image',
          parentId: null,
          createdAt: 1,
          url: 'blob:media-image',
          duration: 5,
        },
      ],
      activeLayerSlots: {},
    });

    await expect(compositionRenderer.prepareComposition('comp-render')).resolves.toBe(true);

    expect(createdImages).toHaveLength(0);
    expect(compositionRenderer.evaluateAtTime('comp-render', 0)).toHaveLength(0);
    expect(timelineRuntimeCoordinator.getBridgeStats().policies['composition-render'].budgetReport.usage.imageBitmaps).toBe(96);
  });

  it('reports text canvas composition sources without requiring runtime bindings', async () => {
    const canvas = document.createElement('canvas');
    vi.spyOn(textRenderer, 'render').mockReturnValue(canvas);
    mockedUseMediaStore.getState.mockReturnValue({
      activeCompositionId: 'active-comp',
      compositions: [makeComposition('comp-render', [makeTextClip()])],
      files: [],
      activeLayerSlots: {},
    });

    await expect(compositionRenderer.prepareComposition('comp-render')).resolves.toBe(true);

    let stats = timelineRuntimeCoordinator.getBridgeStats().policies['composition-render'];
    expect(stats.budgetReport.usage).toMatchObject({
      resources: 1,
      imageBitmaps: 1,
    });
    expect(stats.resources[0]).toMatchObject({
      id: 'composition-render:comp-render:clip-text:image-canvas:text-canvas',
      kind: 'image-canvas',
      imageKind: 'html-canvas',
      owner: {
        ownerId: 'composition:comp-render:clip:clip-text',
        compositionId: 'comp-render',
      },
    });

    compositionRenderer.disposeComposition('comp-render');

    stats = timelineRuntimeCoordinator.getBridgeStats().policies['composition-render'];
    expect(stats.resources).toHaveLength(0);
  });
});
