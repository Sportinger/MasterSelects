import { beforeEach, describe, expect, it } from 'vitest';
import { LayerBuilderService } from '../../src/services/layerBuilder/LayerBuilderService';
import { flags } from '../../src/engine/featureFlags';
import { useTimelineStore } from '../../src/stores/timeline';
import { useMediaStore } from '../../src/stores/mediaStore';
import { DEFAULT_TRANSFORM } from '../../src/stores/timeline/constants';

const initialTimelineState = useTimelineStore.getState();
const initialMediaState = useMediaStore.getState();

describe('LayerBuilderService paused visual provider selection', () => {
  beforeEach(() => {
    useTimelineStore.setState(initialTimelineState);
    useMediaStore.setState(initialMediaState);
    flags.useFullWebCodecsPlayback = true;
  });

  it('treats a full WebCodecs source as renderable even before the video element is attached', () => {
    const service = new LayerBuilderService() as any;

    expect(
      service.hasRenderableVideoSource({
        webCodecsPlayer: {
          isFullMode: () => true,
        },
      })
    ).toBe(true);
  });

  it('does not treat a source without video element or full WebCodecs player as renderable video', () => {
    const service = new LayerBuilderService() as any;

    expect(
      service.hasRenderableVideoSource({
        webCodecsPlayer: {
          isFullMode: () => false,
        },
      })
    ).toBe(false);
  });

  it('keeps the clip player when the scrub runtime is near the target but has no frame', () => {
    const service = new LayerBuilderService() as any;
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
      { webCodecsPlayer: clipPlayer } as any,
      runtimeProvider as any,
      1.01
    );

    expect(provider).toBe(clipPlayer);
  });

  it('uses the scrub runtime once it has a frame near the target', () => {
    const service = new LayerBuilderService() as any;
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
      { webCodecsPlayer: clipPlayer } as any,
      runtimeProvider as any,
      1.01
    );

    expect(provider).toBe(runtimeProvider);
  });

  it('prefers the provider whose frame is closer to the paused target', () => {
    const service = new LayerBuilderService() as any;
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
      { webCodecsPlayer: clipPlayer } as any,
      runtimeProvider as any,
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
    } as any);

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
    } as any);

    const layers = service.buildLayersFromStore();

    expect(layers).toHaveLength(1);
    expect(layers[0]?.source?.webCodecsPlayer).toBe(clipPlayer);
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
    } as any);

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
    } as any);

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
    } as any);

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
    } as any);

    const layers = service.buildLayersFromStore();

    expect(layers).toHaveLength(1);
    expect(layers[0]?.source?.webCodecsPlayer).toBe(clipPlayer);
    expect(layers[0]?.source?.runtimeSessionKey).toBe('interactive-track:track-v1:media:clip-1');
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
    } as any);

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
    } as any);

    const firstLayers = service.buildLayersFromStore();
    expect(firstLayers).toHaveLength(1);
    expect(firstLayers[0]?.sourceClipId).toBe('clip-a');
    expect(firstLayers[0]?.source?.webCodecsPlayer).toBe(clipPlayerA);

    useTimelineStore.setState({
      playheadPosition: 11,
    } as any);

    const secondLayers = service.buildLayersFromStore();
    expect(secondLayers).toHaveLength(1);
    expect(secondLayers[0]?.sourceClipId).toBe('clip-b');
    expect(secondLayers[0]?.source?.webCodecsPlayer).toBe(clipPlayerB);
  });
});
