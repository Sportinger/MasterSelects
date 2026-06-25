import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LayerBuilderService } from '../../src/services/layerBuilder/LayerBuilderService';
import { canUseHeldLayerBuilderProxyFrame } from '../../src/services/layerBuilder/layerBuilderProxyFrames';
import { flags } from '../../src/engine/featureFlags';
import { useTimelineStore } from '../../src/stores/timeline';
import { useMediaStore } from '../../src/stores/mediaStore';
import { DEFAULT_TRANSFORM } from '../../src/stores/timeline/constants';
import { bindSourceRuntimeToClip } from '../../src/services/mediaRuntime/clipBindings';
import {
  getPreviewRuntimeSource,
  getScrubRuntimeSource,
  setRuntimeFrameProvider,
} from '../../src/services/mediaRuntime/runtimePlayback';
import { mediaRuntimeRegistry } from '../../src/services/mediaRuntime/registry';
import { scrubSettleState } from '../../src/services/scrubSettleState';
import { proxyFrameCache } from '../../src/services/proxyFrameCache';
import { vectorAnimationRuntimeManager } from '../../src/services/vectorAnimation/VectorAnimationRuntimeManager';
import {
  getLazyTimelineImageElementCount,
  releaseAllLazyTimelineImageElements,
} from '../../src/services/timeline/lazyImageElements';
import { timelineRuntimeCoordinator } from '../../src/services/timeline/timelineRuntimeCoordinator';
import type { RuntimeFrameProvider } from '../../src/services/mediaRuntime/types';
import type { TimelineClip, TimelineTrack } from '../../src/types';
import {
  addClipCustomNodeDefinition,
  createClipAICustomNodeDefinition,
} from '../../src/services/nodeGraph';

const initialTimelineState = useTimelineStore.getState();
const initialMediaState = useMediaStore.getState();
type WebCodecsPlayerSlot = NonNullable<TimelineClip['source']>['webCodecsPlayer'];
type LayerBuilderServiceTestAccess = {
  buildLayersFromStore: LayerBuilderService['buildLayersFromStore'];
  getPausedVisualProvider: (...args: unknown[]) => unknown;
  hasRenderableVideoSource: (...args: unknown[]) => boolean;
};
type NestedCompositionSource = {
  nestedComposition?: {
    layers?: unknown[];
  };
};

const createService = (): LayerBuilderServiceTestAccess => new LayerBuilderService() as unknown as LayerBuilderServiceTestAccess;
const asRuntimeProvider = (provider: unknown): RuntimeFrameProvider => provider as RuntimeFrameProvider;
const asWebCodecsPlayer = (player: unknown): WebCodecsPlayerSlot => player as WebCodecsPlayerSlot;

function createTestWebCodecsPlayer(currentTime = 1): WebCodecsPlayerSlot {
  return {
    isFullMode: () => true,
    isSimpleMode: () => false,
    hasFrame: () => true,
    getCurrentFrame: () => ({ timestamp: currentTime * 1_000_000 }),
    getPendingSeekTime: () => null,
    getDebugInfo: () => null,
    currentTime,
    isPlaying: false,
    pause: () => {},
    seek: () => {},
  } as WebCodecsPlayerSlot;
}

function setSingleVideoTrackMediaState(): void {
  useMediaStore.setState({
    activeCompositionId: null,
    activeLayerSlots: {},
    layerOpacities: {},
    files: [],
    compositions: [],
    proxyEnabled: false,
  });
}

function withMediaStoreState<T>(
  overrides: Partial<ReturnType<typeof useMediaStore.getState>>,
  run: () => T,
): T {
  const getStateMock = vi.mocked(useMediaStore.getState);
  const previousImplementation = getStateMock.getMockImplementation();
  getStateMock.mockReturnValue({
    ...initialMediaState,
    ...overrides,
  });

  try {
    return run();
  } finally {
    if (previousImplementation) {
      getStateMock.mockImplementation(previousImplementation);
    }
  }
}

describe('LayerBuilderService paused visual provider selection', () => {
  beforeEach(() => {
    mediaRuntimeRegistry.clear();
    releaseAllLazyTimelineImageElements();
    timelineRuntimeCoordinator.clearResources();
    scrubSettleState.clear();
    useTimelineStore.setState(initialTimelineState);
    useMediaStore.setState(initialMediaState);
    flags.useFullWebCodecsPlayback = true;
    flags.disableHtmlPreviewFallback = true;
  });

  afterEach(() => {
    releaseAllLazyTimelineImageElements();
    timelineRuntimeCoordinator.clearResources();
    vi.unstubAllGlobals();
  });

  it('treats a full WebCodecs source as renderable even before the video element is attached', () => {
    const service = createService();

    expect(
      service.hasRenderableVideoSource({
        webCodecsPlayer: {
          isFullMode: () => true,
        },
      })
    ).toBe(true);
  });

  it('does not treat a source without video element or full WebCodecs player as renderable video', () => {
    const service = createService();

    expect(
      service.hasRenderableVideoSource({
        webCodecsPlayer: {
          isFullMode: () => false,
        },
      })
    ).toBe(false);
  });

  it('renders data-only image clips through the lazy image runtime once loaded', () => {
    const service = new LayerBuilderService();
    const createdImages: HTMLImageElement[] = [];
    const ImageCtor = vi.fn(function ImageMock() {
      const image = document.createElement('img');
      createdImages.push(image);
      return image;
    });
    vi.stubGlobal('Image', ImageCtor);

    const mediaState = {
      ...initialMediaState,
      activeCompositionId: null,
      activeLayerSlots: {},
      layerOpacities: {},
      files: [{
        id: 'media-image-1',
        name: 'still.png',
        type: 'image',
        parentId: null,
        createdAt: 1,
        url: 'blob:lazy-image',
        duration: 5,
        width: 100,
        height: 100,
      }],
    };
    useTimelineStore.setState({
      tracks: [{
        id: 'track-v1',
        name: 'Video 1',
        type: 'video',
        visible: true,
        muted: false,
        solo: false,
      }],
      clips: [{
        id: 'clip-image-1',
        trackId: 'track-v1',
        name: 'still.png',
        file: new File([], 'pending.png', { type: 'image/png' }),
        startTime: 0,
        duration: 5,
        inPoint: 0,
        outPoint: 5,
        effects: [],
        transform: { ...DEFAULT_TRANSFORM },
        source: {
          type: 'image',
          mediaFileId: 'media-image-1',
          naturalDuration: 5,
        },
        mediaFileId: 'media-image-1',
        isLoading: false,
      }],
      playheadPosition: 1,
      isPlaying: false,
      isDraggingPlayhead: false,
      playbackSpeed: 1,
    });

    const coldLayers = withMediaStoreState(mediaState, () => service.buildLayersFromStore());

    expect(coldLayers).toHaveLength(0);
    expect(getLazyTimelineImageElementCount()).toBe(1);
    expect(createdImages[0]?.src).toBe('blob:lazy-image');
    expect(useTimelineStore.getState().clips[0].source?.imageElement).toBeUndefined();

    createdImages[0].dispatchEvent(new Event('load'));

    const warmLayers = withMediaStoreState(mediaState, () => service.buildLayersFromStore());

    expect(warmLayers).toHaveLength(1);
    expect(warmLayers[0]?.source).toEqual({
      type: 'image',
      imageElement: createdImages[0],
    });
    expect(useTimelineStore.getState().clips[0].source?.imageElement).toBeUndefined();
  });

  it('does not allocate lazy image elements when the interactive image budget is full', () => {
    const service = new LayerBuilderService();
    const ImageCtor = vi.fn(function ImageMock() {
      return document.createElement('img');
    });
    vi.stubGlobal('Image', ImageCtor);
    for (let index = 0; index < 64; index += 1) {
      timelineRuntimeCoordinator.retainResource({
        id: `preexisting-image-${index}`,
        kind: 'image-canvas',
        policyId: 'interactive',
        owner: {
          ownerId: `preexisting-image-${index}`,
          ownerType: 'clip',
          clipId: `preexisting-image-${index}`,
        },
        source: {
          clipId: `preexisting-image-${index}`,
        },
        imageKind: 'html-image',
        imageId: `preexisting-image-${index}`,
        label: 'Preexisting image',
      });
    }

    const mediaState = {
      ...initialMediaState,
      activeCompositionId: null,
      activeLayerSlots: {},
      layerOpacities: {},
      files: [{
        id: 'media-image-1',
        name: 'still.png',
        type: 'image',
        parentId: null,
        createdAt: 1,
        url: 'blob:lazy-image',
        duration: 5,
        width: 100,
        height: 100,
      }],
    };
    useTimelineStore.setState({
      tracks: [{
        id: 'track-v1',
        name: 'Video 1',
        type: 'video',
        visible: true,
        muted: false,
        solo: false,
      }],
      clips: [{
        id: 'clip-image-1',
        trackId: 'track-v1',
        name: 'still.png',
        file: new File([], 'pending.png', { type: 'image/png' }),
        startTime: 0,
        duration: 5,
        inPoint: 0,
        outPoint: 5,
        effects: [],
        transform: { ...DEFAULT_TRANSFORM },
        source: {
          type: 'image',
          mediaFileId: 'media-image-1',
          naturalDuration: 5,
        },
        mediaFileId: 'media-image-1',
        isLoading: false,
      }],
      playheadPosition: 1,
      isPlaying: false,
      isDraggingPlayhead: false,
      playbackSpeed: 1,
    });

    const layers = withMediaStoreState(mediaState, () => service.buildLayersFromStore());

    expect(layers).toHaveLength(0);
    expect(getLazyTimelineImageElementCount()).toBe(0);
    expect(ImageCtor).not.toHaveBeenCalled();
    expect(useTimelineStore.getState().clips[0].source?.imageElement).toBeUndefined();
    expect(timelineRuntimeCoordinator.getBridgeStats().totals.imageBitmaps).toBe(64);
  });

  it('rejects stale held proxy frames during drag scrubs after large time jumps', () => {
    expect(canUseHeldLayerBuilderProxyFrame(576, 4.8, 30, true)).toBe(false);
    expect(canUseHeldLayerBuilderProxyFrame(147, 4.85, 30, true)).toBe(true);
  });

  it('allows a wider held proxy tolerance for paused non-drag refreshes', () => {
    expect(canUseHeldLayerBuilderProxyFrame(150, 5.35, 30, false)).toBe(true);
    expect(canUseHeldLayerBuilderProxyFrame(150, 5.75, 30, false)).toBe(false);
  });

  it('keeps the clip player when the scrub runtime is near the target but has no frame', () => {
    const service = createService();
    const clipPlayer = {
      isFullMode: () => true,
      hasFrame: () => true,
      getCurrentFrame: () => ({ timestamp: 1_000_000 }),
      currentTime: 1,
    };
    const runtimeProvider = {
      isFullMode: () => true,
      hasFrame: () => false,
      getCurrentFrame: () => null,
      currentTime: 1.02,
      getPendingSeekTime: () => 1.02,
    };

    const provider = service.getPausedVisualProvider(
      { webCodecsPlayer: asWebCodecsPlayer(clipPlayer) },
      asRuntimeProvider(runtimeProvider),
      1.01
    );

    expect(provider).toBe(clipPlayer);
  });

  it('uses the scrub runtime once it has a frame near the target', () => {
    const service = createService();
    const clipPlayer = {
      isFullMode: () => true,
      hasFrame: () => true,
      getCurrentFrame: () => ({ timestamp: 900_000 }),
      currentTime: 0.9,
    };
    const runtimeProvider = {
      isFullMode: () => true,
      hasFrame: () => true,
      getCurrentFrame: () => ({ timestamp: 1_000_000 }),
      currentTime: 1.01,
      getPendingSeekTime: () => 1.01,
    };

    const provider = service.getPausedVisualProvider(
      { webCodecsPlayer: asWebCodecsPlayer(clipPlayer) },
      asRuntimeProvider(runtimeProvider),
      1.01
    );

    expect(provider).toBe(runtimeProvider);
  });

  it('prefers the provider whose frame is closer to the paused target', () => {
    const service = createService();
    const clipPlayer = {
      isFullMode: () => true,
      hasFrame: () => true,
      getCurrentFrame: () => ({ timestamp: 22_589_233 }),
      currentTime: 22.589233,
    };
    const runtimeProvider = {
      isFullMode: () => true,
      hasFrame: () => true,
      getCurrentFrame: () => ({ timestamp: 8_700_000 }),
      currentTime: 8.7,
      getPendingSeekTime: () => 8.7,
    };

    const provider = service.getPausedVisualProvider(
      { webCodecsPlayer: asWebCodecsPlayer(clipPlayer) },
      asRuntimeProvider(runtimeProvider),
      8.68
    );

    expect(provider).toBe(runtimeProvider);
  });

  it('builds primary layers from timeline clips even when no active composition is selected', () => {
    const service = new LayerBuilderService();
    const clipPlayer = createTestWebCodecsPlayer(1);

    setSingleVideoTrackMediaState();

    useTimelineStore.setState({
      tracks: [
        {
          id: 'track-v1',
          name: 'Video 1',
          type: 'video',
          visible: true,
          muted: false,
          solo: false,
        },
      ],
      clips: [
        {
          id: 'clip-1',
          trackId: 'track-v1',
          name: 'clip.mp4',
          startTime: 0,
          duration: 10,
          inPoint: 0,
          outPoint: 10,
          effects: [],
          transform: { ...DEFAULT_TRANSFORM },
          source: {
            type: 'video',
            naturalDuration: 10,
            webCodecsPlayer: clipPlayer,
          },
          isLoading: false,
        },
      ],
      playheadPosition: 1,
      isPlaying: false,
      isDraggingPlayhead: false,
      playbackSpeed: 1,
    });

    const layers = service.buildLayersFromStore();

    expect(layers).toHaveLength(1);
    expect(layers[0]?.source?.webCodecsPlayer).toBe(clipPlayer);
  });

  it('builds centered transition layers with the incoming clip active at the cut', () => {
    const service = new LayerBuilderService();
    const outgoingPlayer = createTestWebCodecsPlayer(9);
    const incomingPlayer = createTestWebCodecsPlayer(0.5);

    setSingleVideoTrackMediaState();
    useTimelineStore.setState({
      tracks: [{
        id: 'track-v1',
        name: 'Video 1',
        type: 'video',
        visible: true,
        muted: false,
        solo: false,
      }],
      clips: [
        {
          id: 'clip-a',
          trackId: 'track-v1',
          name: 'outgoing.mp4',
          startTime: 0,
          duration: 10,
          inPoint: 0,
          outPoint: 10,
          effects: [],
          transform: { ...DEFAULT_TRANSFORM },
          source: { type: 'video', naturalDuration: 10, webCodecsPlayer: outgoingPlayer },
          transitionOut: { id: 'transition-existing', type: 'crossfade', duration: 2, linkedClipId: 'clip-b' },
          isLoading: false,
        },
        {
          id: 'clip-b',
          trackId: 'track-v1',
          name: 'incoming.mp4',
          startTime: 10,
          duration: 8,
          inPoint: 0.5,
          outPoint: 8.5,
          effects: [],
          transform: { ...DEFAULT_TRANSFORM },
          source: { type: 'video', naturalDuration: 8.5, webCodecsPlayer: incomingPlayer },
          transitionIn: { id: 'transition-existing', type: 'crossfade', duration: 2, linkedClipId: 'clip-a' },
          isLoading: false,
        },
      ],
      playheadPosition: 10,
      isPlaying: false,
      isDraggingPlayhead: false,
      playbackSpeed: 1,
    });

    const layers = service.buildLayersFromStore();

    expect(layers.map((layer) => layer.sourceClipId)).toEqual(['clip-b', 'clip-a']);
    expect(layers[0]?.id).toBe('transition:crossfade:clip-a:clip-b:incoming:clip-b:0');
    expect(layers[1]?.id).toBe('transition:crossfade:clip-a:clip-b:outgoing:clip-a:0');
    expect(layers[0]?.opacity).toBeCloseTo(0.5);
    expect(layers[1]?.opacity).toBeCloseTo(1);
    expect(layers[0]?.source?.webCodecsPlayer).toBe(incomingPlayer);
    expect(layers[1]?.source?.webCodecsPlayer).toBe(outgoingPlayer);
  });

  it('builds dip transition solid and opacity layers from primitive recipes', () => {
    const service = new LayerBuilderService();

    setSingleVideoTrackMediaState();
    useTimelineStore.setState({
      tracks: [{
        id: 'track-v1',
        name: 'Video 1',
        type: 'video',
        visible: true,
        muted: false,
        solo: false,
      }],
      clips: [
        {
          id: 'clip-a',
          trackId: 'track-v1',
          name: 'outgoing.mp4',
          startTime: 0,
          duration: 10,
          inPoint: 0,
          outPoint: 10,
          effects: [],
          transform: { ...DEFAULT_TRANSFORM },
          source: { type: 'video', naturalDuration: 10, webCodecsPlayer: createTestWebCodecsPlayer(9.25) },
          transitionOut: { id: 'transition-existing', type: 'dip-to-black', duration: 2, linkedClipId: 'clip-b' },
          isLoading: false,
        },
        {
          id: 'clip-b',
          trackId: 'track-v1',
          name: 'incoming.mp4',
          startTime: 10,
          duration: 8,
          inPoint: 1,
          outPoint: 9,
          effects: [],
          transform: { ...DEFAULT_TRANSFORM },
          source: { type: 'video', naturalDuration: 9, webCodecsPlayer: createTestWebCodecsPlayer(0.25) },
          transitionIn: { id: 'transition-existing', type: 'dip-to-black', duration: 2, linkedClipId: 'clip-a' },
          isLoading: false,
        },
      ],
      playheadPosition: 10.25,
      isPlaying: false,
      isDraggingPlayhead: false,
      playbackSpeed: 1,
    });

    const layers = service.buildLayersFromStore();

    expect(layers).toHaveLength(3);
    expect(layers.map((layer) => layer.sourceClipId ?? 'solid')).toEqual(['clip-b', 'clip-a', 'solid']);
    expect(layers[0]?.opacity).toBeCloseTo(0.25);
    expect(layers[1]?.opacity).toBeCloseTo(0);
    expect(layers[2]?.source).toMatchObject({ type: 'solid', color: '#000000' });
  });

  it('uses normalized transition params for dip-to-color solid layers', () => {
    const service = new LayerBuilderService();

    setSingleVideoTrackMediaState();
    useTimelineStore.setState({
      tracks: [{
        id: 'track-v1',
        name: 'Video 1',
        type: 'video',
        visible: true,
        muted: false,
        solo: false,
      }],
      clips: [
        {
          id: 'clip-a',
          trackId: 'track-v1',
          name: 'outgoing.mp4',
          startTime: 0,
          duration: 10,
          inPoint: 0,
          outPoint: 10,
          effects: [],
          transform: { ...DEFAULT_TRANSFORM },
          source: { type: 'video', naturalDuration: 10, webCodecsPlayer: createTestWebCodecsPlayer(9.25) },
          transitionOut: {
            id: 'transition-existing',
            type: 'dip-to-color',
            duration: 2,
            params: { color: '#ff0080' },
            linkedClipId: 'clip-b',
          },
          isLoading: false,
        },
        {
          id: 'clip-b',
          trackId: 'track-v1',
          name: 'incoming.mp4',
          startTime: 10,
          duration: 8,
          inPoint: 1,
          outPoint: 9,
          effects: [],
          transform: { ...DEFAULT_TRANSFORM },
          source: { type: 'video', naturalDuration: 9, webCodecsPlayer: createTestWebCodecsPlayer(0.25) },
          transitionIn: {
            id: 'transition-existing',
            type: 'dip-to-color',
            duration: 2,
            params: { color: '#ff0080' },
            linkedClipId: 'clip-a',
          },
          isLoading: false,
        },
      ],
      playheadPosition: 10.25,
      isPlaying: false,
      isDraggingPlayhead: false,
      playbackSpeed: 1,
    });

    const layers = service.buildLayersFromStore();

    expect(layers).toHaveLength(3);
    expect(layers[2]?.source).toMatchObject({ type: 'solid', color: '#ff0080' });
  });

  it('sizes generated transition overlay canvases from the active preview composition with the render cap', () => {
    const service = new LayerBuilderService();

    const mediaState = {
      activeCompositionId: 'comp-preview',
      activeLayerSlots: {},
      layerOpacities: {},
      files: [],
      compositions: [{ id: 'comp-preview', width: 1280, height: 720 }],
      proxyEnabled: false,
    } satisfies Partial<ReturnType<typeof useMediaStore.getState>>;
    useTimelineStore.setState({
      tracks: [{
        id: 'track-v1',
        name: 'Video 1',
        type: 'video',
        visible: true,
        muted: false,
        solo: false,
      }],
      clips: [
        {
          id: 'clip-a',
          trackId: 'track-v1',
          name: 'outgoing.mp4',
          startTime: 0,
          duration: 10,
          inPoint: 0,
          outPoint: 10,
          effects: [],
          transform: { ...DEFAULT_TRANSFORM },
          source: { type: 'video', naturalDuration: 10, webCodecsPlayer: createTestWebCodecsPlayer(9.25) },
          transitionOut: { id: 'transition-existing', type: 'light-sweep', duration: 2, linkedClipId: 'clip-b' },
          isLoading: false,
        },
        {
          id: 'clip-b',
          trackId: 'track-v1',
          name: 'incoming.mp4',
          startTime: 10,
          duration: 8,
          inPoint: 1,
          outPoint: 9,
          effects: [],
          transform: { ...DEFAULT_TRANSFORM },
          source: { type: 'video', naturalDuration: 9, webCodecsPlayer: createTestWebCodecsPlayer(0.25) },
          transitionIn: { id: 'transition-existing', type: 'light-sweep', duration: 2, linkedClipId: 'clip-a' },
          isLoading: false,
        },
      ],
      playheadPosition: 10.25,
      isPlaying: false,
      isDraggingPlayhead: false,
      playbackSpeed: 1,
    });

    const layers = withMediaStoreState(mediaState, () => service.buildLayersFromStore());
    const overlayLayers = layers.filter((layer) => layer.id.includes(':overlay:'));

    expect(overlayLayers).toHaveLength(2);
    expect(overlayLayers[0]?.source?.type).toBe('solid');
    expect(overlayLayers[0]?.source?.textCanvas?.width).toBe(960);
    expect(overlayLayers[0]?.source?.textCanvas?.height).toBe(540);
  });

  it('attaches wipe transition render metadata to the incoming layer', () => {
    const service = new LayerBuilderService();

    setSingleVideoTrackMediaState();
    useTimelineStore.setState({
      tracks: [{
        id: 'track-v1',
        name: 'Video 1',
        type: 'video',
        visible: true,
        muted: false,
        solo: false,
      }],
      clips: [
        {
          id: 'clip-a',
          trackId: 'track-v1',
          name: 'outgoing.mp4',
          startTime: 0,
          duration: 10,
          inPoint: 0,
          outPoint: 10,
          effects: [],
          transform: { ...DEFAULT_TRANSFORM },
          source: { type: 'video', naturalDuration: 10, webCodecsPlayer: createTestWebCodecsPlayer(9) },
          transitionOut: { id: 'transition-existing', type: 'wipe-left', duration: 2, linkedClipId: 'clip-b' },
          isLoading: false,
        },
        {
          id: 'clip-b',
          trackId: 'track-v1',
          name: 'incoming.mp4',
          startTime: 10,
          duration: 8,
          inPoint: 1,
          outPoint: 9,
          effects: [],
          transform: { ...DEFAULT_TRANSFORM },
          source: { type: 'video', naturalDuration: 9, webCodecsPlayer: createTestWebCodecsPlayer(0) },
          transitionIn: { id: 'transition-existing', type: 'wipe-left', duration: 2, linkedClipId: 'clip-a' },
          isLoading: false,
        },
      ],
      playheadPosition: 10,
      isPlaying: false,
      isDraggingPlayhead: false,
      playbackSpeed: 1,
    });

    const layers = service.buildLayersFromStore();

    expect(layers[0]?.sourceClipId).toBe('clip-b');
    expect(layers[0]?.transitionRender).toEqual({
      kind: 'wipe',
      direction: 'left',
      progress: 0.5,
    });
    expect(layers[1]?.transitionRender).toBeUndefined();
  });

  it('composes push transition transforms without mutating source clip transforms', () => {
    const service = new LayerBuilderService();
    const outgoingTransform = {
      ...DEFAULT_TRANSFORM,
      position: { x: 0.2, y: 0.1, z: 0.3 },
      scale: { x: 1, y: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    };
    const incomingTransform = {
      ...DEFAULT_TRANSFORM,
      position: { x: -0.1, y: -0.2, z: 0.4 },
      scale: { x: 1, y: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    };

    setSingleVideoTrackMediaState();
    useTimelineStore.setState({
      tracks: [{
        id: 'track-v1',
        name: 'Video 1',
        type: 'video',
        visible: true,
        muted: false,
        solo: false,
      }],
      clips: [
        {
          id: 'clip-a',
          trackId: 'track-v1',
          name: 'outgoing.mp4',
          startTime: 0,
          duration: 10,
          inPoint: 0,
          outPoint: 10,
          effects: [],
          transform: outgoingTransform,
          source: { type: 'video', naturalDuration: 10, webCodecsPlayer: createTestWebCodecsPlayer(9) },
          transitionOut: { id: 'transition-existing', type: 'push-left', duration: 2, linkedClipId: 'clip-b' },
          isLoading: false,
        },
        {
          id: 'clip-b',
          trackId: 'track-v1',
          name: 'incoming.mp4',
          startTime: 10,
          duration: 8,
          inPoint: 1,
          outPoint: 9,
          effects: [],
          transform: incomingTransform,
          source: { type: 'video', naturalDuration: 9, webCodecsPlayer: createTestWebCodecsPlayer(0) },
          transitionIn: { id: 'transition-existing', type: 'push-left', duration: 2, linkedClipId: 'clip-a' },
          isLoading: false,
        },
      ],
      playheadPosition: 10,
      isPlaying: false,
      isDraggingPlayhead: false,
      playbackSpeed: 1,
    });

    const layers = service.buildLayersFromStore();

    expect(layers.map((layer) => layer.sourceClipId)).toEqual(['clip-b', 'clip-a']);
    expect(layers[0]?.position).toEqual({ x: 0.4, y: -0.2, z: 0.4 });
    expect(layers[1]?.position).toEqual({ x: -0.3, y: 0.1, z: 0.3 });
    expect(layers[0]?.position).not.toBe(incomingTransform.position);
    expect(layers[1]?.position).not.toBe(outgoingTransform.position);
    expect(useTimelineStore.getState().clips.find((clip) => clip.id === 'clip-a')?.transform.position).toEqual({ x: 0.2, y: 0.1, z: 0.3 });
    expect(useTimelineStore.getState().clips.find((clip) => clip.id === 'clip-b')?.transform.position).toEqual({ x: -0.1, y: -0.2, z: 0.4 });
  });

  it('passes linked audio analysis context into rendered AI node layers', () => {
    const service = new LayerBuilderService();
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = 2;
    sourceCanvas.height = 1;
    const sourceContext = sourceCanvas.getContext('2d');
    expect(sourceContext).not.toBeNull();
    const imageData = sourceContext?.createImageData(2, 1);
    expect(imageData).toBeDefined();
    imageData?.data.set([
      1, 1, 1, 255,
      2, 2, 2, 255,
    ]);
    if (imageData) {
      sourceContext?.putImageData(imageData, 0, 0);
    }

    const videoTrack: TimelineTrack = {
      id: 'track-v1',
      name: 'Video 1',
      type: 'video',
      visible: true,
      muted: false,
      solo: false,
    };
    const audioTrack: TimelineTrack = {
      id: 'track-a1',
      name: 'Audio 1',
      type: 'audio',
      visible: true,
      muted: false,
      solo: false,
      audioState: {
        volumeDb: -9,
        pan: 0,
      },
    };
    const audioClip: TimelineClip = {
      id: 'clip-audio',
      trackId: 'track-a1',
      name: 'Linked Audio',
      file: new File([], 'linked.wav', { type: 'audio/wav' }),
      mediaFileId: 'media-audio',
      linkedClipId: 'clip-video',
      startTime: 0,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      effects: [],
      transform: { ...DEFAULT_TRANSFORM },
      source: { type: 'audio', mediaFileId: 'media-audio' },
      waveform: [0, 0.5, -0.25],
      audioState: {
        sourceAudioRevisionId: 'audio-rev-linked',
        sourceAnalysisRefs: {
          frequencySummaryId: 'linked-frequency-summary',
        },
      },
      isLoading: false,
    };
    const baseVideoClip: TimelineClip = {
      id: 'clip-video',
      trackId: 'track-v1',
      name: 'Linked Visual',
      mediaFileId: 'media-video',
      linkedClipId: 'clip-audio',
      startTime: 0,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      effects: [],
      transform: { ...DEFAULT_TRANSFORM },
      source: {
        type: 'text',
        textCanvas: sourceCanvas,
      },
      isLoading: false,
    };
    const definition = {
      ...createClipAICustomNodeDefinition('custom-linked-audio', baseVideoClip),
      status: 'ready' as const,
      ai: {
        prompt: 'Use linked audio at render time',
        generatedCode: `
          defineNode({
            process(input, context) {
              const output = {
                ...input.input,
                data: new Uint8ClampedArray(input.input.data),
              };
              const sourceNode = context.graph.nodes.find((node) => node.id === 'source');
              const frequencyPort = sourceNode.outputs.find((port) => port.id === 'frequency-bands');
              output.data[0] = context.audio.metadata.trackId === 'track-a1' ? 141 : 0;
              output.data[1] = context.audio.metadata.mediaFileId === 'media-audio' ? 142 : 0;
              output.data[2] = context.audio.routing.track.volumeDb === -9 ? 143 : 0;
              output.data[4] = frequencyPort.metadata.targetClipId === 'clip-audio' ? 144 : 0;
              output.data[5] = frequencyPort.metadata.artifactId === 'linked-frequency-summary' ? 145 : 0;
              return { output };
            }
          })
        `,
      },
    };
    const nodeGraph = addClipCustomNodeDefinition(baseVideoClip, definition, videoTrack, {
      linkedClip: audioClip,
      linkedTrack: audioTrack,
    });
    const videoClip: TimelineClip = {
      ...baseVideoClip,
      nodeGraph,
    };

    useMediaStore.setState({
      activeCompositionId: null,
      activeLayerSlots: {},
      layerOpacities: {},
      files: [],
      compositions: [],
      proxyEnabled: false,
    });

    useTimelineStore.setState({
      tracks: [videoTrack, audioTrack],
      clips: [videoClip, audioClip],
      playheadPosition: 1,
      isPlaying: false,
      isDraggingPlayhead: false,
      playbackSpeed: 1,
    });

    const layers = service.buildLayersFromStore();

    expect(layers).toHaveLength(1);
    const outputCanvas = layers[0]?.source?.textCanvas;
    expect(outputCanvas).toBeInstanceOf(HTMLCanvasElement);
    const outputData = outputCanvas?.getContext('2d')?.getImageData(0, 0, 2, 1).data;
    expect(outputData?.[0]).toBe(141);
    expect(outputData?.[1]).toBe(142);
    expect(outputData?.[2]).toBe(143);
    expect(outputData?.[4]).toBe(144);
    expect(outputData?.[5]).toBe(145);
  });

  it('routes lottie clips through the existing canvas layer path', () => {
    const service = new LayerBuilderService();
    const canvas = document.createElement('canvas');
    const renderSpy = vi.spyOn(vectorAnimationRuntimeManager, 'renderClipAtTime').mockReturnValue(canvas);

    useMediaStore.setState({
      activeCompositionId: null,
      activeLayerSlots: {},
      layerOpacities: {},
      files: [],
      compositions: [],
      proxyEnabled: false,
    });

    useTimelineStore.setState({
      tracks: [
        {
          id: 'track-v1',
          name: 'Video 1',
          type: 'video',
          visible: true,
          muted: false,
          solo: false,
        },
      ],
      clips: [
        {
          id: 'clip-lottie-1',
          trackId: 'track-v1',
          name: 'anim.lottie',
          file: new File(['lottie'], 'anim.lottie', { type: 'application/zip' }),
          startTime: 0,
          duration: 4,
          inPoint: 0,
          outPoint: 4,
          effects: [],
          transform: { ...DEFAULT_TRANSFORM },
          source: {
            type: 'lottie',
            textCanvas: canvas,
            naturalDuration: 4,
          },
          isLoading: false,
        },
      ],
      playheadPosition: 1,
      isPlaying: false,
      isDraggingPlayhead: false,
      playbackSpeed: 1,
    });

    const layers = service.buildLayersFromStore();

    expect(renderSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'clip-lottie-1' }),
      1,
      expect.objectContaining({ playbackMode: 'forward' }),
    );
    expect(layers).toHaveLength(1);
    expect(layers[0]?.source?.type).toBe('text');
    expect(layers[0]?.source?.textCanvas).toBe(canvas);

    renderSpy.mockRestore();
  });

  it('selects the correct model sequence frame for preview layers', () => {
    const service = new LayerBuilderService();

    useMediaStore.setState({
      activeCompositionId: null,
      activeLayerSlots: {},
      layerOpacities: {},
      files: [{
        id: 'media-model-seq-1',
        name: 'hero (3f)',
        type: 'model',
        createdAt: 1,
        modelSequence: {
          fps: 2,
          frameCount: 3,
          playbackMode: 'clamp',
          sequenceName: 'hero',
          frames: [
            { name: 'hero000000.glb', modelUrl: 'blob:hero-0' },
            { name: 'hero000001.glb', modelUrl: 'blob:hero-1' },
            { name: 'hero000002.glb', modelUrl: 'blob:hero-2' },
          ],
        },
      }],
      compositions: [],
      proxyEnabled: false,
    });

    useTimelineStore.setState({
      tracks: [
        {
          id: 'track-v1',
          name: 'Video 1',
          type: 'video',
          visible: true,
          muted: false,
          solo: false,
        },
      ],
      clips: [
        {
          id: 'clip-model-seq-1',
          trackId: 'track-v1',
          name: 'Hero Sequence',
          mediaFileId: 'media-model-seq-1',
          startTime: 0,
          duration: 2,
          inPoint: 0,
          outPoint: 2,
          effects: [],
          transform: { ...DEFAULT_TRANSFORM },
          source: {
            type: 'model',
            mediaFileId: 'media-model-seq-1',
            modelSequence: {
              fps: 2,
              frameCount: 3,
              playbackMode: 'clamp',
              sequenceName: 'hero',
              frames: [
                { name: 'hero000000.glb', modelUrl: 'blob:hero-0' },
                { name: 'hero000001.glb', modelUrl: 'blob:hero-1' },
                { name: 'hero000002.glb', modelUrl: 'blob:hero-2' },
              ],
            },
          },
          isLoading: false,
          is3D: true,
        },
      ],
      playheadPosition: 0.5,
      isPlaying: false,
      isDraggingPlayhead: false,
      playbackSpeed: 1,
    });

    const layers = service.buildLayersFromStore();

    expect(layers).toHaveLength(1);
    expect(layers[0]?.source?.type).toBe('model');
    expect(layers[0]?.source?.modelUrl).toBe('blob:hero-1');
  });

  it('falls back to media-library model sequence and URL for preview layers', () => {
    const service = new LayerBuilderService();
    const modelFile = new File(['model'], 'fallback.glb', { type: 'model/gltf-binary' });

    const mediaState = {
      activeCompositionId: null,
      activeLayerSlots: {},
      layerOpacities: {},
      files: [{
        id: 'media-model-fallback',
        name: 'fallback.glb',
        type: 'model',
        createdAt: 1,
        file: modelFile,
        url: 'blob:media-model-fallback',
        modelSequence: {
          fps: 2,
          frameCount: 3,
          playbackMode: 'clamp',
          sequenceName: 'fallback',
          frames: [
            { name: 'fallback000000.glb', modelUrl: 'https://assets.local/fallback-0.glb' },
            { name: 'fallback000001.glb', modelUrl: 'https://assets.local/fallback-1.glb' },
            { name: 'fallback000002.glb', modelUrl: 'https://assets.local/fallback-2.glb' },
          ],
        },
      }],
      compositions: [],
      proxyEnabled: false,
    } satisfies Partial<ReturnType<typeof useMediaStore.getState>>;
    useMediaStore.setState(mediaState);

    useTimelineStore.setState({
      tracks: [
        {
          id: 'track-v1',
          name: 'Video 1',
          type: 'video',
          visible: true,
          muted: false,
          solo: false,
        },
      ],
      clips: [
        {
          id: 'clip-model-fallback',
          trackId: 'track-v1',
          name: 'Fallback Model',
          mediaFileId: 'media-model-fallback',
          file: modelFile,
          startTime: 0,
          duration: 2,
          inPoint: 0,
          outPoint: 2,
          effects: [],
          transform: { ...DEFAULT_TRANSFORM },
          source: {
            type: 'model',
            mediaFileId: 'media-model-fallback',
          },
          isLoading: false,
          is3D: true,
        },
      ],
      playheadPosition: 0.5,
      isPlaying: false,
      isDraggingPlayhead: false,
      playbackSpeed: 1,
    });

    const layers = withMediaStoreState(mediaState, () => service.buildLayersFromStore());

    expect(layers).toHaveLength(1);
    expect(layers[0]?.source?.type).toBe('model');
    expect(layers[0]?.source?.modelUrl).toBe('https://assets.local/fallback-1.glb');
    expect(layers[0]?.source?.modelFileName).toBe('fallback000001.glb');
    expect(layers[0]?.source?.modelSequence?.frameCount).toBe(3);
    expect(layers[0]?.source?.file).toBe(modelFile);
  });

  it('falls back to media-library model URL for preview layers without sequence data', () => {
    const service = new LayerBuilderService();

    const mediaState = {
      activeCompositionId: null,
      activeLayerSlots: {},
      layerOpacities: {},
      files: [{
        id: 'media-model-url',
        name: 'url-model.glb',
        type: 'model',
        createdAt: 1,
        url: 'https://assets.local/url-model.glb',
      }],
      compositions: [],
      proxyEnabled: false,
    } satisfies Partial<ReturnType<typeof useMediaStore.getState>>;
    useMediaStore.setState(mediaState);

    useTimelineStore.setState({
      tracks: [
        {
          id: 'track-v1',
          name: 'Video 1',
          type: 'video',
          visible: true,
          muted: false,
          solo: false,
        },
      ],
      clips: [
        {
          id: 'clip-model-url',
          trackId: 'track-v1',
          name: 'URL Model',
          mediaFileId: 'media-model-url',
          startTime: 0,
          duration: 2,
          inPoint: 0,
          outPoint: 2,
          effects: [],
          transform: { ...DEFAULT_TRANSFORM },
          source: {
            type: 'model',
            mediaFileId: 'media-model-url',
          },
          isLoading: false,
          is3D: true,
        },
      ],
      playheadPosition: 0.5,
      isPlaying: false,
      isDraggingPlayhead: false,
      playbackSpeed: 1,
    });

    const layers = withMediaStoreState(mediaState, () => service.buildLayersFromStore());

    expect(layers).toHaveLength(1);
    expect(layers[0]?.source?.type).toBe('model');
    expect(layers[0]?.source?.modelUrl).toBe('https://assets.local/url-model.glb');
    expect(layers[0]?.source?.modelSequence).toBeUndefined();
  });

  it('selects the correct gaussian splat sequence frame and keeps native renderer selection', () => {
    const service = new LayerBuilderService();
    const frameFiles = [
      new File(['0'], 'scan000000.ply', { type: 'application/octet-stream' }),
      new File(['1'], 'scan000001.ply', { type: 'application/octet-stream' }),
      new File(['2'], 'scan000002.ply', { type: 'application/octet-stream' }),
    ];

    useMediaStore.setState({
      activeCompositionId: null,
      activeLayerSlots: {},
      layerOpacities: {},
      files: [{
        id: 'media-splat-seq-1',
        name: 'scan (3f)',
        type: 'gaussian-splat',
        createdAt: 1,
        gaussianSplatSequence: {
          fps: 2,
          frameCount: 3,
          playbackMode: 'clamp',
          sequenceName: 'scan',
          frames: [
            { name: 'scan000000.ply', projectPath: 'Raw/scan000000.ply', file: frameFiles[0], splatUrl: 'blob:scan-0' },
            { name: 'scan000001.ply', projectPath: 'Raw/scan000001.ply', file: frameFiles[1], splatUrl: 'blob:scan-1' },
            { name: 'scan000002.ply', projectPath: 'Raw/scan000002.ply', file: frameFiles[2], splatUrl: 'blob:scan-2' },
          ],
        },
      }],
      compositions: [],
      proxyEnabled: false,
    });

    useTimelineStore.setState({
      tracks: [
        {
          id: 'track-v1',
          name: 'Video 1',
          type: 'video',
          visible: true,
          muted: false,
          solo: false,
        },
      ],
      clips: [
        {
          id: 'clip-splat-seq-1',
          trackId: 'track-v1',
          name: 'Scan Sequence',
          mediaFileId: 'media-splat-seq-1',
          startTime: 0,
          duration: 2,
          inPoint: 0,
          outPoint: 2,
          effects: [],
          transform: { ...DEFAULT_TRANSFORM },
          source: {
            type: 'gaussian-splat',
            mediaFileId: 'media-splat-seq-1',
            gaussianSplatSequence: {
              fps: 2,
              frameCount: 3,
              playbackMode: 'clamp',
              sequenceName: 'scan',
              frames: [
                { name: 'scan000000.ply', projectPath: 'Raw/scan000000.ply', file: frameFiles[0], splatUrl: 'blob:scan-0' },
                { name: 'scan000001.ply', projectPath: 'Raw/scan000001.ply', file: frameFiles[1], splatUrl: 'blob:scan-1' },
                { name: 'scan000002.ply', projectPath: 'Raw/scan000002.ply', file: frameFiles[2], splatUrl: 'blob:scan-2' },
              ],
            },
            gaussianSplatSettings: {
              render: {
                useNativeRenderer: true,
                maxSplats: 2048,
                splatScale: 1,
                nearPlane: 0.1,
                farPlane: 1000,
                backgroundColor: 'transparent',
                sortFrequency: 8,
              },
              temporal: {
                enabled: false,
                playbackMode: 'loop',
                sequenceFps: 30,
                frameBlend: 0,
              },
              particle: {
                enabled: false,
                effectType: 'none',
                intensity: 0,
                speed: 1,
                seed: 1,
              },
            },
          },
          isLoading: false,
          is3D: true,
        },
      ],
      playheadPosition: 0.5,
      isPlaying: false,
      isDraggingPlayhead: false,
      playbackSpeed: 1,
    });

    const layers = service.buildLayersFromStore();

    expect(layers).toHaveLength(1);
    expect(layers[0]?.source?.type).toBe('gaussian-splat');
    expect(layers[0]?.source?.gaussianSplatUrl).toBe('blob:scan-1');
    expect(layers[0]?.source?.gaussianSplatFileName).toBe('scan000001.ply');
    expect(layers[0]?.source?.gaussianSplatFileHash).toBeUndefined();
    expect(layers[0]?.source?.gaussianSplatRuntimeKey).toBe('Raw/scan000001.ply');
    expect(layers[0]?.source?.file).toBe(frameFiles[1]);
    expect(layers[0]?.source?.gaussianSplatSettings?.render.useNativeRenderer).toBe(true);
  });

  it('keeps full WebCodecs preview bound to the scrub runtime while actively dragging the playhead', () => {
    const service = new LayerBuilderService();
    const videoElement = { currentTime: 1.25 } as HTMLVideoElement;
    const clipPlayer = {
      isFullMode: () => true,
      isSimpleMode: () => false,
      hasFrame: () => true,
      getCurrentFrame: () => ({ timestamp: 1_250_000 }),
      getPendingSeekTime: () => null,
      getDebugInfo: () => null,
      currentTime: 1.25,
      isPlaying: false,
      pause: () => {},
      seek: () => {},
    };

    useMediaStore.setState({
      activeCompositionId: null,
      activeLayerSlots: {},
      layerOpacities: {},
      files: [],
      compositions: [],
      proxyEnabled: false,
    });

    useTimelineStore.setState({
      tracks: [
        {
          id: 'track-v1',
          name: 'Video 1',
          type: 'video',
          visible: true,
          muted: false,
          solo: false,
        },
      ],
      clips: [
        {
          id: 'clip-1',
          trackId: 'track-v1',
          name: 'clip.mp4',
          startTime: 0,
          duration: 10,
          inPoint: 0,
          outPoint: 10,
          effects: [],
          transform: { ...DEFAULT_TRANSFORM },
          source: {
            type: 'video',
            naturalDuration: 10,
            videoElement,
            runtimeSourceId: 'media:clip-1',
            runtimeSessionKey: 'interactive:clip-1',
            webCodecsPlayer: clipPlayer,
          },
          isLoading: false,
        },
      ],
      playheadPosition: 1.25,
      isPlaying: false,
      isDraggingPlayhead: true,
      playbackSpeed: 1,
    });

    const layers = service.buildLayersFromStore();

    expect(layers).toHaveLength(1);
    expect(layers[0]?.source?.videoElement).toBe(videoElement);
    expect(layers[0]?.source?.webCodecsPlayer).toBe(clipPlayer);
    expect(layers[0]?.source?.runtimeSessionKey).toBe('interactive-scrub:track-v1:media:clip-1');
  });

  it('keeps paused timeline preview on the playback runtime when not actively dragging', () => {
    const service = new LayerBuilderService();
    const clipPlayer = {
      isFullMode: () => true,
      isSimpleMode: () => false,
      hasFrame: () => true,
      getCurrentFrame: () => ({ timestamp: 1_250_000 }),
      getPendingSeekTime: () => null,
      getDebugInfo: () => null,
      currentTime: 1.25,
      isPlaying: false,
      pause: () => {},
      seek: () => {},
    };

    useMediaStore.setState({
      activeCompositionId: null,
      activeLayerSlots: {},
      layerOpacities: {},
      files: [],
      compositions: [],
      proxyEnabled: false,
    });

    useTimelineStore.setState({
      tracks: [
        {
          id: 'track-v1',
          name: 'Video 1',
          type: 'video',
          visible: true,
          muted: false,
          solo: false,
        },
      ],
      clips: [
        {
          id: 'clip-1',
          trackId: 'track-v1',
          name: 'clip.mp4',
          startTime: 0,
          duration: 10,
          inPoint: 0,
          outPoint: 10,
          effects: [],
          transform: { ...DEFAULT_TRANSFORM },
          source: {
            type: 'video',
            naturalDuration: 10,
            runtimeSourceId: 'media:clip-1',
            runtimeSessionKey: 'interactive:clip-1',
            webCodecsPlayer: clipPlayer,
          },
          isLoading: false,
        },
      ],
      playheadPosition: 1.25,
      isPlaying: false,
      isDraggingPlayhead: false,
      playbackSpeed: 1,
    });

    const layers = service.buildLayersFromStore();

    expect(layers).toHaveLength(1);
    expect(layers[0]?.source?.webCodecsPlayer).toBe(clipPlayer);
    expect(layers[0]?.source?.runtimeSessionKey).toBe('interactive-track:track-v1:media:clip-1');
  });

  it('prefers the paused runtime provider while scrub-settle is pending', () => {
    const service = new LayerBuilderService();
    const file = new File(['video'], 'clip.mp4', { type: 'video/mp4', lastModified: 103 });
    const clipPlayer = {
      isFullMode: () => true,
      isSimpleMode: () => false,
      hasFrame: () => true,
      getCurrentFrame: () => ({ timestamp: 22_500_000 }),
      getPendingSeekTime: () => null,
      getDebugInfo: () => null,
      currentTime: 22.5,
      isPlaying: false,
      pause: () => {},
      seek: () => {},
    };
    const runtimeProvider = {
      isFullMode: () => true,
      isSimpleMode: () => false,
      hasFrame: () => false,
      getCurrentFrame: () => null,
      getPendingSeekTime: () => 8.7,
      getDebugInfo: () => null,
      currentTime: 8.7,
      isPlaying: false,
      pause: () => {},
      seek: () => {},
    };
    const source = bindSourceRuntimeToClip({
      clipId: 'clip-1',
      source: {
        type: 'video',
        naturalDuration: 30,
        mediaFileId: 'media-clip-1',
        webCodecsPlayer: asWebCodecsPlayer(clipPlayer),
      },
      file,
      mediaFileId: 'media-clip-1',
    });
    const previewRuntimeSource = getScrubRuntimeSource(source, 'track-v1', true);

    setRuntimeFrameProvider(previewRuntimeSource, asRuntimeProvider(runtimeProvider));
    scrubSettleState.begin('clip-1', 8.7, 500, 'scrub-stop');

    useMediaStore.setState({
      activeCompositionId: null,
      activeLayerSlots: {},
      layerOpacities: {},
      files: [{ id: 'media-clip-1', file, name: 'clip.mp4', duration: 30 }],
      compositions: [],
      proxyEnabled: false,
    });

    useTimelineStore.setState({
      tracks: [
        {
          id: 'track-v1',
          name: 'Video 1',
          type: 'video',
          visible: true,
          muted: false,
          solo: false,
        },
      ],
      clips: [
        {
          id: 'clip-1',
          trackId: 'track-v1',
          name: 'clip.mp4',
          file,
          startTime: 0,
          duration: 30,
          inPoint: 0,
          outPoint: 30,
          effects: [],
          transform: { ...DEFAULT_TRANSFORM },
          source,
          isLoading: false,
        },
      ],
      playheadPosition: 8.7,
      isPlaying: false,
      isDraggingPlayhead: false,
      playbackSpeed: 1,
    });

    const layers = service.buildLayersFromStore();

    expect(layers).toHaveLength(1);
    expect(layers[0]?.source?.webCodecsPlayer).toBe(runtimeProvider);
  });

  it('uses the playback runtime provider for active full WebCodecs playback', () => {
    const service = new LayerBuilderService();
    const file = new File(['video'], 'clip.mp4', { type: 'video/mp4', lastModified: 101 });
    const clipPlayer = {
      isFullMode: () => true,
      isSimpleMode: () => false,
      hasFrame: () => true,
      getCurrentFrame: () => ({ timestamp: 1_250_000 }),
      getPendingSeekTime: () => null,
      getDebugInfo: () => null,
      currentTime: 1.25,
      isPlaying: false,
      pause: () => {},
      seek: () => {},
    };
    const runtimeProvider = {
      isFullMode: () => true,
      isSimpleMode: () => false,
      hasFrame: () => true,
      getCurrentFrame: () => ({ timestamp: 1_260_000 }),
      getPendingSeekTime: () => null,
      getDebugInfo: () => null,
      currentTime: 1.26,
      isPlaying: true,
      pause: () => {},
      seek: () => {},
    };
    const source = bindSourceRuntimeToClip({
      clipId: 'clip-1',
      source: {
        type: 'video',
        naturalDuration: 10,
        mediaFileId: 'media-clip-1',
        webCodecsPlayer: asWebCodecsPlayer(clipPlayer),
      },
      file,
      mediaFileId: 'media-clip-1',
    });
    const previewRuntimeSource = getPreviewRuntimeSource(source, 'track-v1', true);

    setRuntimeFrameProvider(previewRuntimeSource, asRuntimeProvider(runtimeProvider));

    useMediaStore.setState({
      activeCompositionId: null,
      activeLayerSlots: {},
      layerOpacities: {},
      files: [{ id: 'media-clip-1', file, name: 'clip.mp4', duration: 10 }],
      compositions: [],
      proxyEnabled: false,
    });

    useTimelineStore.setState({
      tracks: [
        {
          id: 'track-v1',
          name: 'Video 1',
          type: 'video',
          visible: true,
          muted: false,
          solo: false,
        },
      ],
      clips: [
        {
          id: 'clip-1',
          trackId: 'track-v1',
          name: 'clip.mp4',
          file,
          startTime: 0,
          duration: 10,
          inPoint: 0,
          outPoint: 10,
          effects: [],
          transform: { ...DEFAULT_TRANSFORM },
          source,
          isLoading: false,
        },
      ],
      playheadPosition: 1.25,
      isPlaying: true,
      isDraggingPlayhead: false,
      playbackSpeed: 1,
    });

    const layers = service.buildLayersFromStore();

    expect(layers).toHaveLength(1);
    expect(layers[0]?.source?.webCodecsPlayer).toBe(runtimeProvider);
    expect(layers[0]?.source?.runtimeSessionKey).toBe(previewRuntimeSource?.runtimeSessionKey);
  });

  it('keeps the scrub runtime provider active for playback while a scrub-stop settle is pending', () => {
    const service = new LayerBuilderService();
    const file = new File(['video'], 'clip.mp4', { type: 'video/mp4', lastModified: 111 });
    const clipPlayer = {
      isFullMode: () => true,
      isSimpleMode: () => false,
      hasFrame: () => true,
      getCurrentFrame: () => ({ timestamp: 29_200_000 }),
      getPendingSeekTime: () => null,
      getDebugInfo: () => null,
      currentTime: 29.2,
      isPlaying: false,
      pause: () => {},
      seek: () => {},
    };
    const playbackRuntimeProvider = {
      isFullMode: () => true,
      isSimpleMode: () => false,
      hasFrame: () => true,
      getCurrentFrame: () => ({ timestamp: 29_250_000 }),
      getPendingSeekTime: () => null,
      getDebugInfo: () => null,
      currentTime: 29.25,
      isPlaying: true,
      pause: () => {},
      seek: () => {},
    };
    const scrubRuntimeProvider = {
      isFullMode: () => true,
      isSimpleMode: () => false,
      hasFrame: () => true,
      getCurrentFrame: () => ({ timestamp: 30_000_000 }),
      getPendingSeekTime: () => 30,
      getDebugInfo: () => null,
      currentTime: 30,
      isPlaying: false,
      pause: () => {},
      seek: () => {},
    };
    const source = bindSourceRuntimeToClip({
      clipId: 'clip-1',
      source: {
        type: 'video',
        naturalDuration: 40,
        mediaFileId: 'media-clip-1',
        webCodecsPlayer: asWebCodecsPlayer(clipPlayer),
      },
      file,
      mediaFileId: 'media-clip-1',
    });
    const previewRuntimeSource = getPreviewRuntimeSource(source, 'track-v1', true);
    const scrubRuntimeSource = getScrubRuntimeSource(source, 'track-v1', true);

    setRuntimeFrameProvider(previewRuntimeSource, asRuntimeProvider(playbackRuntimeProvider));
    setRuntimeFrameProvider(scrubRuntimeSource, asRuntimeProvider(scrubRuntimeProvider));
    scrubSettleState.begin('clip-1', 30, 500, 'scrub-stop');

    useMediaStore.setState({
      activeCompositionId: null,
      activeLayerSlots: {},
      layerOpacities: {},
      files: [{ id: 'media-clip-1', file, name: 'clip.mp4', duration: 40 }],
      compositions: [],
      proxyEnabled: false,
    });

    useTimelineStore.setState({
      tracks: [
        {
          id: 'track-v1',
          name: 'Video 1',
          type: 'video',
          visible: true,
          muted: false,
          solo: false,
        },
      ],
      clips: [
        {
          id: 'clip-1',
          trackId: 'track-v1',
          name: 'clip.mp4',
          file,
          startTime: 0,
          duration: 40,
          inPoint: 0,
          outPoint: 40,
          effects: [],
          transform: { ...DEFAULT_TRANSFORM },
          source,
          isLoading: false,
        },
      ],
      playheadPosition: 30.2,
      isPlaying: true,
      isDraggingPlayhead: false,
      playbackSpeed: 1,
    });

    const layers = service.buildLayersFromStore();

    expect(layers).toHaveLength(1);
    expect(layers[0]?.source?.webCodecsPlayer).toBe(scrubRuntimeProvider);
    expect(layers[0]?.source?.runtimeSessionKey).toBe(scrubRuntimeSource?.runtimeSessionKey);
  });

  it('uses the playback runtime provider for nested full WebCodecs playback', () => {
    const service = new LayerBuilderService();
    const file = new File(['video'], 'nested.mp4', { type: 'video/mp4', lastModified: 102 });
    const clipPlayer = {
      isFullMode: () => true,
      isSimpleMode: () => false,
      hasFrame: () => true,
      getCurrentFrame: () => ({ timestamp: 1_250_000 }),
      getPendingSeekTime: () => null,
      getDebugInfo: () => null,
      currentTime: 1.25,
      isPlaying: false,
      pause: () => {},
      seek: () => {},
    };
    const runtimeProvider = {
      isFullMode: () => true,
      isSimpleMode: () => false,
      hasFrame: () => true,
      getCurrentFrame: () => ({ timestamp: 1_265_000 }),
      getPendingSeekTime: () => null,
      getDebugInfo: () => null,
      currentTime: 1.265,
      isPlaying: true,
      pause: () => {},
      seek: () => {},
    };
    const nestedSource = bindSourceRuntimeToClip({
      clipId: 'nested-clip-1',
      source: {
        type: 'video',
        naturalDuration: 10,
        mediaFileId: 'media-nested-1',
        webCodecsPlayer: asWebCodecsPlayer(clipPlayer),
      },
      file,
      mediaFileId: 'media-nested-1',
    });
    const previewRuntimeSource = getPreviewRuntimeSource(nestedSource, 'nested-track-v1', true);

    setRuntimeFrameProvider(previewRuntimeSource, asRuntimeProvider(runtimeProvider));

    useMediaStore.setState({
      activeCompositionId: null,
      activeLayerSlots: {},
      layerOpacities: {},
      files: [{ id: 'media-nested-1', file, name: 'nested.mp4', duration: 10 }],
      compositions: [{ id: 'comp-1', width: 1920, height: 1080 }],
      proxyEnabled: false,
    });

    useTimelineStore.setState({
      tracks: [
        {
          id: 'track-v1',
          name: 'Video 1',
          type: 'video',
          visible: true,
          muted: false,
          solo: false,
        },
      ],
      clips: [
        {
          id: 'comp-clip-1',
          trackId: 'track-v1',
          name: 'Comp 1',
          startTime: 0,
          duration: 10,
          inPoint: 0,
          outPoint: 10,
          effects: [],
          transform: { ...DEFAULT_TRANSFORM },
          isComposition: true,
          compositionId: 'comp-1',
          nestedTracks: [
            {
              id: 'nested-track-v1',
              name: 'Nested Video 1',
              type: 'video',
              visible: true,
              muted: false,
              solo: false,
            },
          ],
          nestedClips: [
            {
              id: 'nested-clip-1',
              trackId: 'nested-track-v1',
              name: 'nested.mp4',
              file,
              startTime: 0,
              duration: 10,
              inPoint: 0,
              outPoint: 10,
              effects: [],
              transform: { ...DEFAULT_TRANSFORM },
              source: nestedSource,
              isLoading: false,
            },
          ],
          isLoading: false,
        },
      ],
      playheadPosition: 1.25,
      isPlaying: true,
      isDraggingPlayhead: false,
      playbackSpeed: 1,
    });

    const layers = service.buildLayersFromStore();
    const nestedLayers = (layers[0]?.source as NestedCompositionSource | undefined)?.nestedComposition?.layers;

    expect(layers).toHaveLength(1);
    expect(nestedLayers).toHaveLength(1);
    expect(nestedLayers[0]?.source?.webCodecsPlayer).toBe(runtimeProvider);
    expect(nestedLayers[0]?.source?.runtimeSessionKey).toBe(
      previewRuntimeSource?.runtimeSessionKey
    );
  });

  it('rebuilds paused layers when the playhead jumps to a different clip without dragging', () => {
    const service = new LayerBuilderService();
    const clipPlayerA = {
      isFullMode: () => true,
      isSimpleMode: () => false,
      hasFrame: () => true,
      getCurrentFrame: () => ({ timestamp: 1_000_000 }),
      getPendingSeekTime: () => null,
      getDebugInfo: () => null,
      currentTime: 1,
      isPlaying: false,
      pause: () => {},
      seek: () => {},
    };
    const clipPlayerB = {
      isFullMode: () => true,
      isSimpleMode: () => false,
      hasFrame: () => true,
      getCurrentFrame: () => ({ timestamp: 12_000_000 }),
      getPendingSeekTime: () => null,
      getDebugInfo: () => null,
      currentTime: 12,
      isPlaying: false,
      pause: () => {},
      seek: () => {},
    };

    useMediaStore.setState({
      activeCompositionId: null,
      activeLayerSlots: {},
      layerOpacities: {},
      files: [],
      compositions: [],
      proxyEnabled: false,
    });

    useTimelineStore.setState({
      tracks: [
        {
          id: 'track-v1',
          name: 'Video 1',
          type: 'video',
          visible: true,
          muted: false,
          solo: false,
        },
      ],
      clips: [
        {
          id: 'clip-a',
          trackId: 'track-v1',
          name: 'a.mp4',
          startTime: 0,
          duration: 5,
          inPoint: 0,
          outPoint: 5,
          effects: [],
          transform: { ...DEFAULT_TRANSFORM },
          source: {
            type: 'video',
            naturalDuration: 5,
            webCodecsPlayer: clipPlayerA,
          },
          isLoading: false,
        },
        {
          id: 'clip-b',
          trackId: 'track-v1',
          name: 'b.mp4',
          startTime: 10,
          duration: 5,
          inPoint: 0,
          outPoint: 5,
          effects: [],
          transform: { ...DEFAULT_TRANSFORM },
          source: {
            type: 'video',
            naturalDuration: 5,
            webCodecsPlayer: clipPlayerB,
          },
          isLoading: false,
        },
      ],
      playheadPosition: 1,
      isPlaying: false,
      isDraggingPlayhead: false,
      playbackSpeed: 1,
    });

    const firstLayers = service.buildLayersFromStore();
    expect(firstLayers).toHaveLength(1);
    expect(firstLayers[0]?.sourceClipId).toBe('clip-a');
    expect(firstLayers[0]?.source?.webCodecsPlayer).toBe(clipPlayerA);

    useTimelineStore.setState({
      playheadPosition: 11,
    });

    const secondLayers = service.buildLayersFromStore();
    expect(secondLayers).toHaveLength(1);
    expect(secondLayers[0]?.sourceClipId).toBe('clip-b');
    expect(secondLayers[0]?.source?.webCodecsPlayer).toBe(clipPlayerB);
  });

  it('builds nested gaussian splat layers into the shared 3D layer contract', () => {
    const service = new LayerBuilderService();
    const file = new File(['splat'], 'nested.splat', { type: 'application/octet-stream' });

    useMediaStore.setState({
      activeCompositionId: null,
      activeLayerSlots: {},
      layerOpacities: {},
      files: [
        {
          id: 'media-splat-1',
          file,
          fileHash: 'splat-hash-1',
          name: 'nested.splat',
        },
      ],
      compositions: [{ id: 'comp-1', width: 1920, height: 1080 }],
      proxyEnabled: false,
    });

    useTimelineStore.setState({
      tracks: [
        {
          id: 'track-v1',
          name: 'Video 1',
          type: 'video',
          visible: true,
          muted: false,
          solo: false,
        },
      ],
      clips: [
        {
          id: 'comp-clip-1',
          trackId: 'track-v1',
          name: 'Comp 1',
          startTime: 0,
          duration: 10,
          inPoint: 0,
          outPoint: 10,
          effects: [],
          transform: { ...DEFAULT_TRANSFORM },
          isComposition: true,
          compositionId: 'comp-1',
          nestedTracks: [
            {
              id: 'nested-track-v1',
              name: 'Nested 3D',
              type: 'video',
              visible: true,
              muted: false,
              solo: false,
            },
          ],
          nestedClips: [
            {
              id: 'nested-splat-1',
              trackId: 'nested-track-v1',
              mediaFileId: 'media-splat-1',
              name: 'nested.splat',
              file,
              startTime: 0,
              duration: 10,
              inPoint: 0,
              outPoint: 10,
              effects: [],
              transform: { ...DEFAULT_TRANSFORM },
              source: {
                type: 'gaussian-splat',
                mediaFileId: 'media-splat-1',
                gaussianSplatUrl: 'blob:nested-splat',
                gaussianSplatFileName: 'nested.splat',
                gaussianSplatSettings: {
                  render: {
                    useNativeRenderer: true,
                  },
                },
              },
              isLoading: false,
            },
          ],
          isLoading: false,
        },
      ],
      playheadPosition: 2,
      isPlaying: false,
      isDraggingPlayhead: false,
      playbackSpeed: 1,
    });

    const layers = service.buildLayersFromStore();
    const nestedLayers = (layers[0]?.source as NestedCompositionSource | undefined)?.nestedComposition?.layers;

    expect(nestedLayers).toHaveLength(1);
    expect(nestedLayers[0]).toMatchObject({
      sourceClipId: 'nested-splat-1',
      is3D: true,
      source: expect.objectContaining({
        type: 'gaussian-splat',
        gaussianSplatUrl: 'blob:nested-splat',
        gaussianSplatFileName: 'nested.splat',
        mediaFileId: 'media-splat-1',
      }),
    });
    expect(nestedLayers[0]?.source?.gaussianSplatRuntimeKey).toBeTruthy();
    expect(nestedLayers[0]?.source?.gaussianSplatSettings?.render?.useNativeRenderer).toBe(true);
  });

  it('uses proxy frames for video clips inside nested composition clips while scrubbing', () => {
    const service = new LayerBuilderService();
    const file = new File(['video'], 'nested.mp4', { type: 'video/mp4' });
    const video = document.createElement('video');
    const proxyImage = document.createElement('img');
    const mockedProxyFrameCache = proxyFrameCache as typeof proxyFrameCache & {
      getCachedFrame: ReturnType<typeof vi.fn>;
      getNearestCachedFrameEntry: ReturnType<typeof vi.fn>;
      getFrame: ReturnType<typeof vi.fn>;
    };
    mockedProxyFrameCache.getCachedFrame = vi.fn().mockReturnValue(proxyImage);
    mockedProxyFrameCache.getNearestCachedFrameEntry = vi.fn().mockReturnValue(null);
    mockedProxyFrameCache.getFrame = vi.fn().mockResolvedValue(proxyImage);

    const getMediaStateSpy = vi.spyOn(useMediaStore, 'getState').mockReturnValue({
      ...initialMediaState,
      activeCompositionId: null,
      activeLayerSlots: {},
      layerOpacities: {},
      proxyEnabled: true,
      files: [{
        id: 'media-video-1',
        name: 'nested.mp4',
        type: 'video',
        createdAt: 1,
        file,
        duration: 10,
        proxyStatus: 'ready',
        proxyFps: 24,
      }],
      compositions: [],
    });

    useTimelineStore.setState({
      tracks: [
        {
          id: 'track-v1',
          name: 'Video 1',
          type: 'video',
          visible: true,
          muted: false,
          solo: false,
        },
      ],
      clips: [
        {
          id: 'comp-clip-1',
          trackId: 'track-v1',
          name: 'Comp 1',
          startTime: 0,
          duration: 10,
          inPoint: 0,
          outPoint: 10,
          effects: [],
          transform: { ...DEFAULT_TRANSFORM },
          isComposition: true,
          compositionId: 'comp-1',
          nestedTracks: [
            {
              id: 'nested-track-v1',
              name: 'Nested Video',
              type: 'video',
              visible: true,
              muted: false,
              solo: false,
            },
          ],
          nestedClips: [
            {
              id: 'nested-video-1',
              trackId: 'nested-track-v1',
              mediaFileId: 'media-video-1',
              name: 'nested.mp4',
              file,
              startTime: 0,
              duration: 10,
              inPoint: 0,
              outPoint: 10,
              effects: [],
              transform: { ...DEFAULT_TRANSFORM },
              source: {
                type: 'video',
                mediaFileId: 'media-video-1',
                videoElement: video,
                naturalDuration: 10,
              },
              isLoading: false,
            },
          ],
          isLoading: false,
        },
      ],
      playheadPosition: 1,
      isPlaying: false,
      isDraggingPlayhead: true,
      playbackSpeed: 1,
    });

    const layers = service.buildLayersFromStore();
    const nestedLayers = (layers[0]?.source as NestedCompositionSource | undefined)?.nestedComposition?.layers as Array<{
      source?: {
        type?: string;
        imageElement?: HTMLImageElement;
        proxyFrameIndex?: number;
        previewPath?: string;
        mediaFileId?: string;
      };
    }> | undefined;

    expect(mockedProxyFrameCache.getCachedFrame).toHaveBeenCalledWith('media-video-1', 24, 24);
    expect(nestedLayers).toHaveLength(1);
    expect(nestedLayers?.[0]?.source).toMatchObject({
      type: 'image',
      imageElement: proxyImage,
      proxyFrameIndex: 24,
      previewPath: 'nested-proxy-image-frame',
      mediaFileId: 'media-video-1',
    });

    delete mockedProxyFrameCache.getCachedFrame;
    delete mockedProxyFrameCache.getNearestCachedFrameEntry;
    delete mockedProxyFrameCache.getFrame;
    getMediaStateSpy.mockRestore();
  });

  it('widens the nearest-proxy search to the preload range while dragging the playhead', () => {
    const service = new LayerBuilderService();
    const file = new File(['video'], 'nested.mp4', { type: 'video/mp4' });
    const video = document.createElement('video');
    const proxyImage = document.createElement('img');
    const mockedProxyFrameCache = proxyFrameCache as typeof proxyFrameCache & {
      getCachedFrame: ReturnType<typeof vi.fn>;
      getNearestCachedFrameEntry: ReturnType<typeof vi.fn>;
      getFrame: ReturnType<typeof vi.fn>;
    };
    // Cold region: no exact frame and no nearest frame, forcing the fallback path.
    mockedProxyFrameCache.getCachedFrame = vi.fn().mockReturnValue(null);
    mockedProxyFrameCache.getNearestCachedFrameEntry = vi.fn().mockReturnValue(null);
    mockedProxyFrameCache.getFrame = vi.fn().mockResolvedValue(proxyImage);

    const getMediaStateSpy = vi.spyOn(useMediaStore, 'getState').mockReturnValue({
      ...initialMediaState,
      activeCompositionId: null,
      activeLayerSlots: {},
      layerOpacities: {},
      proxyEnabled: true,
      files: [{
        id: 'media-video-1',
        name: 'nested.mp4',
        type: 'video',
        createdAt: 1,
        file,
        duration: 10,
        proxyStatus: 'ready',
        proxyFps: 24,
      }],
      compositions: [],
    });

    useTimelineStore.setState({
      tracks: [
        {
          id: 'track-v1',
          name: 'Video 1',
          type: 'video',
          visible: true,
          muted: false,
          solo: false,
        },
      ],
      clips: [
        {
          id: 'comp-clip-1',
          trackId: 'track-v1',
          name: 'Comp 1',
          startTime: 0,
          duration: 10,
          inPoint: 0,
          outPoint: 10,
          effects: [],
          transform: { ...DEFAULT_TRANSFORM },
          isComposition: true,
          compositionId: 'comp-1',
          nestedTracks: [
            {
              id: 'nested-track-v1',
              name: 'Nested Video',
              type: 'video',
              visible: true,
              muted: false,
              solo: false,
            },
          ],
          nestedClips: [
            {
              id: 'nested-video-1',
              trackId: 'nested-track-v1',
              mediaFileId: 'media-video-1',
              name: 'nested.mp4',
              file,
              startTime: 0,
              duration: 10,
              inPoint: 0,
              outPoint: 10,
              effects: [],
              transform: { ...DEFAULT_TRANSFORM },
              source: {
                type: 'video',
                mediaFileId: 'media-video-1',
                videoElement: video,
                naturalDuration: 10,
              },
              isLoading: false,
            },
          ],
          isLoading: false,
        },
      ],
      playheadPosition: 1,
      isPlaying: false,
      isDraggingPlayhead: true,
      playbackSpeed: 1,
    });

    service.buildLayersFromStore();

    // Preloader fetches ±90 frames ahead; the fallback search must reach the same
    // distance during a drag so a cold-region scrub uses a preloaded frame.
    expect(mockedProxyFrameCache.getNearestCachedFrameEntry).toHaveBeenCalledWith('media-video-1', 24, 90);

    delete mockedProxyFrameCache.getCachedFrame;
    delete mockedProxyFrameCache.getNearestCachedFrameEntry;
    delete mockedProxyFrameCache.getFrame;
    getMediaStateSpy.mockRestore();
  });
});
