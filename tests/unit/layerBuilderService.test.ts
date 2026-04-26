import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LayerBuilderService } from '../../src/services/layerBuilder/LayerBuilderService';
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
import { lottieRuntimeManager } from '../../src/services/vectorAnimation/LottieRuntimeManager';
import type { RuntimeFrameProvider } from '../../src/services/mediaRuntime/types';
import type { TimelineClip } from '../../src/types';

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

describe('LayerBuilderService paused visual provider selection', () => {
  beforeEach(() => {
    mediaRuntimeRegistry.clear();
    scrubSettleState.clear();
    useTimelineStore.setState(initialTimelineState);
    useMediaStore.setState(initialMediaState);
    flags.useFullWebCodecsPlayback = true;
    flags.disableHtmlPreviewFallback = true;
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
    const clipPlayer = {
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

  it('routes lottie clips through the existing canvas layer path', () => {
    const service = new LayerBuilderService();
    const canvas = document.createElement('canvas');
    const renderSpy = vi.spyOn(lottieRuntimeManager, 'renderClipAtTime').mockReturnValue(canvas);

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

    expect(renderSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'clip-lottie-1' }), 1);
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
});
