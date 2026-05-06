import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  getRuntimeFrameProvider: vi.fn(),
  readRuntimeFrameForSource: vi.fn(),
  wcRecord: vi.fn(),
}));

vi.mock('../../src/services/logger', () => ({
  Logger: {
    create: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  },
}));

vi.mock('../../src/services/mediaRuntime/runtimePlayback', () => ({
  getRuntimeFrameProvider: (...args: unknown[]) => hoisted.getRuntimeFrameProvider(...args),
  readRuntimeFrameForSource: (...args: unknown[]) => hoisted.readRuntimeFrameForSource(...args),
}));

vi.mock('../../src/services/wcPipelineMonitor', () => ({
  wcPipelineMonitor: {
    record: (...args: unknown[]) => hoisted.wcRecord(...args),
  },
}));

import { LayerCollector } from '../../src/engine/render/LayerCollector';
import { flags } from '../../src/engine/featureFlags';
import { scrubSettleState } from '../../src/services/scrubSettleState';
import { useTimelineStore } from '../../src/stores/timeline';
import type { TextureManager } from '../../src/engine/texture/TextureManager';
import type { ScrubbingCache } from '../../src/engine/texture/ScrubbingCache';
import type { Layer } from '../../src/types';

const defaultUserAgent = navigator.userAgent;

describe('LayerCollector', () => {
  beforeEach(() => {
    vi.useRealTimers();
    hoisted.getRuntimeFrameProvider.mockReset();
    hoisted.readRuntimeFrameForSource.mockReset();
    hoisted.wcRecord.mockReset();
    scrubSettleState.clear();
    flags.useFullWebCodecsPlayback = true;
    flags.disableHtmlPreviewFallback = true;
    useTimelineStore.setState({ isDraggingPlayhead: false });
    Object.defineProperty(globalThis.navigator, 'userAgent', {
      configurable: true,
      value: defaultUserAgent,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the clip WebCodecs frame while a separate scrub runtime session is still cold', () => {
    const clipFrame = {
      timestamp: 2_000_000,
      displayWidth: 1920,
      displayHeight: 1080,
    };

    const clipProvider = {
      currentTime: 2,
      isPlaying: false,
      isFullMode: () => true,
      isSimpleMode: () => false,
      getCurrentFrame: vi.fn(() => clipFrame),
      getPendingSeekTime: vi.fn(() => null),
      getDebugInfo: vi.fn(() => null),
      pause: vi.fn(),
      seek: vi.fn(),
    };

    const scrubRuntimeProvider = {
      currentTime: 2,
      isPlaying: false,
      isFullMode: () => true,
      isSimpleMode: () => false,
      getCurrentFrame: vi.fn(() => null),
      getPendingSeekTime: vi.fn(() => 3),
      getDebugInfo: vi.fn(() => null),
      pause: vi.fn(),
      seek: vi.fn(),
    };

    hoisted.getRuntimeFrameProvider.mockReturnValue(scrubRuntimeProvider);
    hoisted.readRuntimeFrameForSource.mockReturnValue(null);

    const extTex = { label: 'video-texture' };
    const textureManager = {
      importVideoTexture: vi.fn(() => extTex),
    };

    const layer = {
      id: 'layer-1',
      name: 'Video',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      source: {
        type: 'video',
        webCodecsPlayer: clipProvider,
        runtimeSourceId: 'media:test',
        runtimeSessionKey: 'interactive-scrub:track-1:media:test',
      },
    } as unknown as Layer;

    const collector = new LayerCollector();
    const result = collector.collect([layer], {
      textureManager: textureManager as unknown as TextureManager,
      scrubbingCache: null,
      getLastVideoTime: () => undefined,
      setLastVideoTime: () => {},
      isExporting: false,
      isPlaying: false,
    });

    expect(result).toHaveLength(1);
    expect(textureManager.importVideoTexture).toHaveBeenCalledWith(clipFrame);
    expect(clipProvider.getCurrentFrame).toHaveBeenCalledTimes(1);
    expect(hoisted.readRuntimeFrameForSource).not.toHaveBeenCalled();
    expect(result[0]?.displayedMediaTime).toBe(2);
    expect(result[0]?.targetMediaTime).toBe(2);
    expect(result[0]?.previewPath).toBe('webcodecs');
    expect(collector.getDecoder()).toBe('WebCodecs');
    expect(collector.hasActiveVideo()).toBe(true);
  });

  it('holds the last successful frame for the same provider while a pending target is still settling', () => {
    const stableFrame = {
      timestamp: 2_000_000,
      displayWidth: 1920,
      displayHeight: 1080,
    };

    const provider = {
      currentTime: 2,
      isPlaying: false,
      isFullMode: () => true,
      isSimpleMode: () => false,
      getCurrentFrame: vi.fn(() => stableFrame),
      getPendingSeekTime: vi.fn(() => null),
      getDebugInfo: vi.fn(() => null),
      pause: vi.fn(),
      seek: vi.fn(),
    };

    hoisted.getRuntimeFrameProvider.mockReturnValue(null);
    hoisted.readRuntimeFrameForSource.mockReturnValue(null);

    const extTex = { label: 'video-texture' };
    const textureManager = {
      importVideoTexture: vi.fn(() => extTex),
    };

    const layer = {
      id: 'layer-1',
      name: 'Video',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      source: {
        type: 'video',
        webCodecsPlayer: provider,
      },
    } as unknown as Layer;

    const collector = new LayerCollector();
    const deps = {
      textureManager: textureManager as unknown as TextureManager,
      scrubbingCache: null,
      getLastVideoTime: () => undefined,
      setLastVideoTime: () => {},
      isExporting: false,
      isPlaying: true,
    };

    const initial = collector.collect([layer], deps);
    expect(initial).toHaveLength(1);

    provider.getPendingSeekTime.mockReturnValue(2.4);

    const pending = collector.collect([layer], deps);
    expect(pending).toHaveLength(1);
    expect(provider.getCurrentFrame).toHaveBeenCalledTimes(2);
  });

  it('does not reuse an unstable frame across a provider change', () => {
    const oldProvider = {
      currentTime: 2,
      isPlaying: false,
      isFullMode: () => true,
      isSimpleMode: () => false,
      getCurrentFrame: vi.fn(() => ({
        timestamp: 2_000_000,
        displayWidth: 1920,
        displayHeight: 1080,
      })),
      getPendingSeekTime: vi.fn(() => null),
      getDebugInfo: vi.fn(() => null),
      pause: vi.fn(),
      seek: vi.fn(),
    };
    const newProvider = {
      currentTime: 0,
      isPlaying: false,
      isFullMode: () => true,
      isSimpleMode: () => false,
      getCurrentFrame: vi.fn(() => ({
        timestamp: 0,
        displayWidth: 1920,
        displayHeight: 1080,
      })),
      getPendingSeekTime: vi.fn(() => 2.4),
      getDebugInfo: vi.fn(() => null),
      pause: vi.fn(),
      seek: vi.fn(),
    };

    hoisted.getRuntimeFrameProvider.mockReturnValue(null);
    hoisted.readRuntimeFrameForSource.mockReturnValue(null);

    const textureManager = {
      importVideoTexture: vi.fn(() => ({ label: 'video-texture' })),
    };

    const collector = new LayerCollector();
    const deps = {
      textureManager: textureManager as unknown as TextureManager,
      scrubbingCache: null,
      getLastVideoTime: () => undefined,
      setLastVideoTime: () => {},
      isExporting: false,
      isPlaying: true,
    };

    collector.collect([{
      id: 'layer-1',
      name: 'Video',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      source: {
        type: 'video',
        webCodecsPlayer: oldProvider,
      },
    } as unknown as Layer], deps);

    const result = collector.collect([{
      id: 'layer-1',
      name: 'Video',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      source: {
        type: 'video',
        webCodecsPlayer: newProvider,
      },
    } as unknown as Layer], deps);

    expect(result).toHaveLength(0);
    expect(newProvider.getCurrentFrame).not.toHaveBeenCalled();
  });

  it('does not reuse a pending shared-session frame after the active clip changes on the same layer', () => {
    const sharedProvider = {
      currentTime: 2,
      isPlaying: false,
      isFullMode: () => true,
      isSimpleMode: () => false,
      hasFrame: () => true,
      getCurrentFrame: vi.fn(() => ({
        timestamp: 2_000_000,
        displayWidth: 1920,
        displayHeight: 1080,
      })),
      getPendingSeekTime: vi.fn(() => null),
      getDebugInfo: vi.fn(() => null),
      pause: vi.fn(),
      seek: vi.fn(),
    };

    hoisted.getRuntimeFrameProvider.mockReturnValue(sharedProvider);
    hoisted.readRuntimeFrameForSource.mockReturnValue(null);

    const textureManager = {
      importVideoTexture: vi.fn(() => ({ label: 'video-texture' })),
    };

    const collector = new LayerCollector();
    const deps = {
      textureManager: textureManager as unknown as TextureManager,
      scrubbingCache: null,
      getLastVideoTime: () => undefined,
      setLastVideoTime: () => {},
      isExporting: false,
      isPlaying: true,
    };

    collector.collect([{
      id: 'layer-1',
      sourceClipId: 'clip-a',
      name: 'Video',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      source: {
        type: 'video',
        webCodecsPlayer: sharedProvider,
        runtimeSourceId: 'media:test',
        runtimeSessionKey: 'interactive-track:track-1:media:test',
      },
    } as unknown as Layer], deps);

    sharedProvider.getPendingSeekTime.mockReturnValue(2.4);

    const result = collector.collect([{
      id: 'layer-1',
      sourceClipId: 'clip-b',
      name: 'Video',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      source: {
        type: 'video',
        webCodecsPlayer: sharedProvider,
        runtimeSourceId: 'media:test',
        runtimeSessionKey: 'interactive-track:track-1:media:test',
      },
    } as unknown as Layer], deps);

    expect(result).toHaveLength(0);
    expect(sharedProvider.getCurrentFrame).toHaveBeenCalledTimes(1);
  });

  it('promotes a stable runtime frame once the scrub session has one, even if the cached layer still points at the clip player', () => {
    const clipProvider = {
      currentTime: 0.9,
      isPlaying: false,
      isFullMode: () => true,
      isSimpleMode: () => false,
      hasFrame: () => false,
      getCurrentFrame: vi.fn(() => null),
      getPendingSeekTime: vi.fn(() => null),
      getDebugInfo: vi.fn(() => null),
      pause: vi.fn(),
      seek: vi.fn(),
    };
    const runtimeFrame = {
      timestamp: 1_000_000,
      displayWidth: 1920,
      displayHeight: 1080,
    };
    const runtimeProvider = {
      currentTime: 1,
      isPlaying: false,
      isFullMode: () => true,
      isSimpleMode: () => false,
      hasFrame: () => true,
      getCurrentFrame: vi.fn(() => runtimeFrame),
      getPendingSeekTime: vi.fn(() => null),
      getDebugInfo: vi.fn(() => null),
      pause: vi.fn(),
      seek: vi.fn(),
    };

    hoisted.getRuntimeFrameProvider.mockReturnValue(runtimeProvider);
    hoisted.readRuntimeFrameForSource.mockReturnValue(null);

    const textureManager = {
      importVideoTexture: vi.fn(() => ({ label: 'video-texture' })),
    };

    const collector = new LayerCollector();
    const result = collector.collect([{
      id: 'layer-1',
      name: 'Video',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      source: {
        type: 'video',
        webCodecsPlayer: clipProvider,
        runtimeSourceId: 'media:test',
        runtimeSessionKey: 'interactive-scrub:track-1:media:test',
      },
    } as unknown as Layer], {
      textureManager: textureManager as unknown as TextureManager,
      scrubbingCache: null,
      getLastVideoTime: () => undefined,
      setLastVideoTime: () => {},
      isExporting: false,
      isPlaying: false,
    });

    expect(result).toHaveLength(1);
    expect(runtimeProvider.getCurrentFrame).toHaveBeenCalledTimes(1);
    expect(clipProvider.getCurrentFrame).not.toHaveBeenCalled();
  });

  it('reads the runtime session frame during scrub-settle even when the layer still points at the clip provider', () => {
    const clipProvider = {
      currentTime: 22.5,
      isPlaying: false,
      isFullMode: () => true,
      isSimpleMode: () => false,
      hasFrame: () => true,
      getCurrentFrame: vi.fn(() => ({
        timestamp: 22_500_000,
        displayWidth: 1920,
        displayHeight: 1080,
      })),
      getPendingSeekTime: vi.fn(() => null),
      getDebugInfo: vi.fn(() => null),
      pause: vi.fn(),
      seek: vi.fn(),
    };
    const runtimeProvider = {
      currentTime: 8.7,
      isPlaying: false,
      isFullMode: () => true,
      isSimpleMode: () => false,
      hasFrame: () => false,
      getCurrentFrame: vi.fn(() => null),
      getPendingSeekTime: vi.fn(() => 8.7),
      getDebugInfo: vi.fn(() => null),
      pause: vi.fn(),
      seek: vi.fn(),
    };
    const runtimeFrame = {
      timestamp: 8_700_000,
      displayWidth: 1920,
      displayHeight: 1080,
    };

    hoisted.getRuntimeFrameProvider.mockReturnValue(runtimeProvider);
    hoisted.readRuntimeFrameForSource.mockReturnValue({
      binding: { session: { currentTime: 8.7 } },
      frameHandle: {
        frame: runtimeFrame,
        timestamp: 8_700_000,
      },
    });
    scrubSettleState.begin('clip-1', 8.7, 500, 'scrub-stop');

    const textureManager = {
      importVideoTexture: vi.fn(() => ({ label: 'video-texture' })),
    };

    const collector = new LayerCollector();
    const result = collector.collect([{
      id: 'layer-1',
      sourceClipId: 'clip-1',
      name: 'Video',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      source: {
        type: 'video',
        mediaTime: 8.7,
        webCodecsPlayer: clipProvider,
        runtimeSourceId: 'media:test',
        runtimeSessionKey: 'interactive-track:track-1:media:test',
      },
    } as unknown as Layer], {
      textureManager: textureManager as unknown as TextureManager,
      scrubbingCache: null,
      getLastVideoTime: () => undefined,
      setLastVideoTime: () => {},
      isExporting: false,
      isPlaying: false,
    });

    expect(result).toHaveLength(1);
    expect(hoisted.readRuntimeFrameForSource).toHaveBeenCalledTimes(1);
    expect(clipProvider.getCurrentFrame).not.toHaveBeenCalled();
  });

  it('renders an available pending WebCodecs frame during drag scrubbing instead of dropping to black', () => {
    useTimelineStore.setState({ isDraggingPlayhead: true });

    const frame = {
      timestamp: 2_000_000,
      displayWidth: 1920,
      displayHeight: 1080,
    };

    const provider = {
      currentTime: 2,
      isPlaying: false,
      isFullMode: () => true,
      isSimpleMode: () => false,
      hasFrame: () => true,
      getCurrentFrame: vi.fn(() => frame),
      getPendingSeekTime: vi.fn(() => 2.6),
      getDebugInfo: vi.fn(() => null),
      pause: vi.fn(),
      seek: vi.fn(),
    };

    hoisted.getRuntimeFrameProvider.mockReturnValue(null);
    hoisted.readRuntimeFrameForSource.mockReturnValue(null);

    const textureManager = {
      importVideoTexture: vi.fn(() => ({ label: 'video-texture' })),
    };

    const collector = new LayerCollector();
    const result = collector.collect([{
      id: 'layer-1',
      name: 'Video',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      source: {
        type: 'video',
        webCodecsPlayer: provider,
      },
    } as unknown as Layer], {
      textureManager: textureManager as unknown as TextureManager,
      scrubbingCache: null,
      getLastVideoTime: () => undefined,
      setLastVideoTime: () => {},
      isExporting: false,
      isPlaying: false,
    });

    expect(result).toHaveLength(1);
    expect(provider.getCurrentFrame).toHaveBeenCalledTimes(1);
  });

  it('drops a wildly stale WebCodecs provider frame after playback starts', () => {
    const staleFrame = {
      timestamp: 72_506_000,
      displayWidth: 1920,
      displayHeight: 1080,
    };

    const provider = {
      currentTime: 7.623,
      isPlaying: true,
      isFullMode: () => true,
      isSimpleMode: () => false,
      hasFrame: () => true,
      getCurrentFrame: vi.fn(() => staleFrame),
      getPendingSeekTime: vi.fn(() => null),
      getDebugInfo: vi.fn(() => null),
      getFrameRate: vi.fn(() => 30),
      pause: vi.fn(),
      seek: vi.fn(),
    };

    hoisted.getRuntimeFrameProvider.mockReturnValue(null);
    hoisted.readRuntimeFrameForSource.mockReturnValue(null);

    const textureManager = {
      importVideoTexture: vi.fn(() => ({ label: 'video-texture' })),
    };

    const collector = new LayerCollector();
    const result = collector.collect([{
      id: 'layer-stale-play',
      name: 'Video',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      source: {
        type: 'video',
        mediaTime: 7.623,
        webCodecsPlayer: provider,
      },
    } as unknown as Layer], {
      textureManager: textureManager as unknown as TextureManager,
      scrubbingCache: null,
      getLastVideoTime: () => undefined,
      setLastVideoTime: () => {},
      isExporting: false,
      isPlaying: true,
    });

    expect(result).toHaveLength(0);
    expect(textureManager.importVideoTexture).not.toHaveBeenCalled();
    expect(provider.getCurrentFrame).toHaveBeenCalledTimes(1);
  });

  it('accepts a moderately stale WebCodecs provider frame during playback startup warmup', () => {
    const startupFrame = {
      timestamp: 8_380_000,
      displayWidth: 1920,
      displayHeight: 1080,
    };

    const provider = {
      currentTime: 8.02,
      isPlaying: true,
      isFullMode: () => true,
      isSimpleMode: () => false,
      hasFrame: () => true,
      getCurrentFrame: vi.fn(() => startupFrame),
      getPendingSeekTime: vi.fn(() => 8.02),
      getDebugInfo: vi.fn(() => null),
      getFrameRate: vi.fn(() => 30),
      isPlaybackStartupWarmupActive: vi.fn(() => true),
      pause: vi.fn(),
      seek: vi.fn(),
    };

    hoisted.getRuntimeFrameProvider.mockReturnValue(null);
    hoisted.readRuntimeFrameForSource.mockReturnValue(null);

    const textureManager = {
      importVideoTexture: vi.fn(() => ({ label: 'video-texture' })),
    };

    const collector = new LayerCollector();
    const result = collector.collect([{
      id: 'layer-startup-warmup',
      name: 'Video',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      source: {
        type: 'video',
        mediaTime: 8.02,
        webCodecsPlayer: provider,
      },
    } as unknown as Layer], {
      textureManager: textureManager as unknown as TextureManager,
      scrubbingCache: null,
      getLastVideoTime: () => undefined,
      setLastVideoTime: () => {},
      isExporting: false,
      isPlaying: true,
    });

    expect(result).toHaveLength(1);
    expect(textureManager.importVideoTexture).toHaveBeenCalledTimes(1);
    expect(provider.getCurrentFrame).toHaveBeenCalledTimes(1);
  });

  it('does not hold a wildly stale reused WebCodecs frame during playback startup warmup', () => {
    const staleFrame = {
      timestamp: 17_818_000,
      displayWidth: 1920,
      displayHeight: 1080,
    };

    const provider = {
      currentTime: 17.818,
      isPlaying: true,
      isFullMode: () => true,
      isSimpleMode: () => false,
      hasFrame: () => true,
      getCurrentFrame: vi.fn(() => staleFrame),
      getPendingSeekTime: vi.fn(() => null),
      getDebugInfo: vi.fn(() => null),
      getFrameRate: vi.fn(() => 30),
      isPlaybackStartupWarmupActive: vi.fn(() => false),
      pause: vi.fn(),
      seek: vi.fn(),
    };

    hoisted.getRuntimeFrameProvider.mockReturnValue(null);
    hoisted.readRuntimeFrameForSource.mockReturnValue(null);

    const textureManager = {
      importVideoTexture: vi.fn(() => ({ label: 'video-texture' })),
    };

    const collector = new LayerCollector();
    const baseLayer = {
      id: 'layer-startup-stale-hold',
      sourceClipId: 'clip-startup-stale',
      name: 'Video',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      source: {
        type: 'video',
        mediaTime: 17.818,
        webCodecsPlayer: provider,
      },
    } as unknown as Layer;

    const initialResult = collector.collect([baseLayer], {
      textureManager: textureManager as unknown as TextureManager,
      scrubbingCache: null,
      getLastVideoTime: () => undefined,
      setLastVideoTime: () => {},
      isExporting: false,
      isPlaying: true,
    });

    expect(initialResult).toHaveLength(1);

    provider.getPendingSeekTime.mockReturnValue(8.02);
    provider.isPlaybackStartupWarmupActive.mockReturnValue(true);

    const startupResult = collector.collect([{
      ...baseLayer,
      source: {
        ...baseLayer.source,
        mediaTime: 8.02,
      },
    }], {
      textureManager: textureManager as unknown as TextureManager,
      scrubbingCache: null,
      getLastVideoTime: () => undefined,
      setLastVideoTime: () => {},
      isExporting: false,
      isPlaying: true,
    });

    expect(startupResult).toHaveLength(0);
    expect(textureManager.importVideoTexture).toHaveBeenCalledTimes(1);
    expect(provider.getCurrentFrame).toHaveBeenCalledTimes(2);
  });

  it('does not hold a severely stale reused WebCodecs frame during playback even before warmup is marked active', () => {
    const staleFrame = {
      timestamp: 17_818_000,
      displayWidth: 1920,
      displayHeight: 1080,
    };

    const provider = {
      currentTime: 17.818,
      isPlaying: true,
      isFullMode: () => true,
      isSimpleMode: () => false,
      hasFrame: () => true,
      getCurrentFrame: vi.fn(() => staleFrame),
      getPendingSeekTime: vi.fn(() => null),
      getDebugInfo: vi.fn(() => null),
      getFrameRate: vi.fn(() => 30),
      isPlaybackStartupWarmupActive: vi.fn(() => false),
      pause: vi.fn(),
      seek: vi.fn(),
    };

    hoisted.getRuntimeFrameProvider.mockReturnValue(null);
    hoisted.readRuntimeFrameForSource.mockReturnValue(null);

    const textureManager = {
      importVideoTexture: vi.fn(() => ({ label: 'video-texture' })),
    };

    const collector = new LayerCollector();
    const baseLayer = {
      id: 'layer-severe-stale-hold',
      sourceClipId: 'clip-severe-stale',
      name: 'Video',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      source: {
        type: 'video',
        mediaTime: 17.818,
        webCodecsPlayer: provider,
      },
    } as unknown as Layer;

    const initialResult = collector.collect([baseLayer], {
      textureManager: textureManager as unknown as TextureManager,
      scrubbingCache: null,
      getLastVideoTime: () => undefined,
      setLastVideoTime: () => {},
      isExporting: false,
      isPlaying: true,
    });

    expect(initialResult).toHaveLength(1);

    provider.getPendingSeekTime.mockReturnValue(8.02);

    const playbackResult = collector.collect([{
      ...baseLayer,
      source: {
        ...baseLayer.source,
        mediaTime: 8.02,
      },
    }], {
      textureManager: textureManager as unknown as TextureManager,
      scrubbingCache: null,
      getLastVideoTime: () => undefined,
      setLastVideoTime: () => {},
      isExporting: false,
      isPlaying: true,
    });

    expect(playbackResult).toHaveLength(0);
    expect(textureManager.importVideoTexture).toHaveBeenCalledTimes(1);
    expect(provider.getCurrentFrame).toHaveBeenCalledTimes(2);
  });

  it('does not hold a severely stale reused WebCodecs frame during a paused teleport settle', () => {
    const staleFrame = {
      timestamp: 17_818_000,
      displayWidth: 1920,
      displayHeight: 1080,
    };

    const provider = {
      currentTime: 17.818,
      isPlaying: false,
      isFullMode: () => true,
      isSimpleMode: () => false,
      hasFrame: () => true,
      getCurrentFrame: vi.fn(() => staleFrame),
      getPendingSeekTime: vi.fn(() => null),
      getDebugInfo: vi.fn(() => null),
      getFrameRate: vi.fn(() => 30),
      isPlaybackStartupWarmupActive: vi.fn(() => false),
      pause: vi.fn(),
      seek: vi.fn(),
    };

    hoisted.getRuntimeFrameProvider.mockReturnValue(null);
    hoisted.readRuntimeFrameForSource.mockReturnValue(null);

    const textureManager = {
      importVideoTexture: vi.fn(() => ({ label: 'video-texture' })),
    };

    const collector = new LayerCollector();
    const baseLayer = {
      id: 'layer-paused-severe-stale-hold',
      sourceClipId: 'clip-paused-severe-stale',
      name: 'Video',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      source: {
        type: 'video',
        mediaTime: 17.818,
        webCodecsPlayer: provider,
      },
    } as unknown as Layer;

    const initialResult = collector.collect([baseLayer], {
      textureManager: textureManager as unknown as TextureManager,
      scrubbingCache: null,
      getLastVideoTime: () => undefined,
      setLastVideoTime: () => {},
      isExporting: false,
      isPlaying: false,
    });

    expect(initialResult).toHaveLength(1);

    provider.getPendingSeekTime.mockReturnValue(8.02);

    const pausedResult = collector.collect([{
      ...baseLayer,
      source: {
        ...baseLayer.source,
        mediaTime: 8.02,
      },
    }], {
      textureManager: textureManager as unknown as TextureManager,
      scrubbingCache: null,
      getLastVideoTime: () => undefined,
      setLastVideoTime: () => {},
      isExporting: false,
      isPlaying: false,
    });

    expect(pausedResult).toHaveLength(0);
    expect(textureManager.importVideoTexture).toHaveBeenCalledTimes(1);
    expect(provider.getCurrentFrame).toHaveBeenCalledTimes(2);
  });

  it('prefers HTML video preview when full WebCodecs playback is disabled', () => {
    flags.useFullWebCodecsPlayback = false;

    const video = {
      src: 'blob:test-video',
      currentTime: 1.25,
      readyState: 4,
      seeking: false,
      paused: false,
      videoWidth: 1920,
      videoHeight: 1080,
    } as unknown as HTMLVideoElement;

    const webCodecsPlayer = {
      isFullMode: () => true,
      getCurrentFrame: vi.fn(() => ({
        timestamp: 1_250_000,
        displayWidth: 1920,
        displayHeight: 1080,
      })),
    };

    hoisted.getRuntimeFrameProvider.mockReturnValue(null);
    hoisted.readRuntimeFrameForSource.mockReturnValue(null);

    const textureManager = {
      importVideoTexture: vi.fn(() => ({ label: 'html-video-texture' })),
    };

    const collector = new LayerCollector();
    const result = collector.collect([{
      id: 'layer-html',
      name: 'Video',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      source: {
        type: 'video',
        videoElement: video,
        webCodecsPlayer,
      },
    } as unknown as Layer], {
      textureManager: textureManager as unknown as TextureManager,
      scrubbingCache: null,
      getLastVideoTime: () => undefined,
      setLastVideoTime: () => {},
      isExporting: false,
      isPlaying: true,
    });

    expect(result).toHaveLength(1);
    expect(textureManager.importVideoTexture).toHaveBeenCalledWith(video);
    expect(webCodecsPlayer.getCurrentFrame).not.toHaveBeenCalled();
    expect(collector.getDecoder()).toBe('HTMLVideo');
  });

  it('keeps precise export videos renderable even without preview presented-frame history', () => {
    const video = {
      src: 'blob:export-video',
      currentTime: 2.5,
      readyState: 4,
      seeking: false,
      paused: true,
      videoWidth: 1920,
      videoHeight: 1080,
    } as unknown as HTMLVideoElement;

    hoisted.getRuntimeFrameProvider.mockReturnValue(null);
    hoisted.readRuntimeFrameForSource.mockReturnValue(null);

    const extTex = { label: 'export-video-texture' };
    const textureManager = {
      importVideoTexture: vi.fn(() => extTex),
    };

    const collector = new LayerCollector();
    const result = collector.collect([{
      id: 'layer-export-html',
      sourceClipId: 'clip-export-html',
      name: 'Video',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      source: {
        type: 'video',
        mediaTime: 2.5,
        videoElement: video,
      },
    } as unknown as Layer], {
      textureManager: textureManager as unknown as TextureManager,
      scrubbingCache: null,
      getLastVideoTime: () => undefined,
      setLastVideoTime: () => {},
      isExporting: true,
      isPlaying: false,
    });

    expect(result).toHaveLength(1);
    expect(textureManager.importVideoTexture).toHaveBeenCalledWith(video);
    expect(result[0]).toMatchObject({
      isVideo: true,
      externalTexture: extTex,
      textureView: null,
      sourceWidth: 1920,
      sourceHeight: 1080,
      displayedMediaTime: 2.5,
      targetMediaTime: 2.5,
      previewPath: 'live-import',
    });
    expect(collector.getDecoder()).toBe('HTMLVideo');
    expect(collector.hasActiveVideo()).toBe(true);
  });

  it('does not fall back to HTML preview when HTML preview fallback is disabled', () => {
    const video = {
      src: 'blob:test-video',
      currentTime: 1.25,
      readyState: 4,
      seeking: false,
      paused: true,
      videoWidth: 1920,
      videoHeight: 1080,
    } as unknown as HTMLVideoElement;

    const webCodecsPlayer = {
      currentTime: 1.25,
      isPlaying: false,
      isFullMode: () => true,
      isSimpleMode: () => false,
      hasFrame: () => false,
      getCurrentFrame: vi.fn(() => null),
      getPendingSeekTime: vi.fn(() => null),
      getDebugInfo: vi.fn(() => null),
      pause: vi.fn(),
      seek: vi.fn(),
    };

    hoisted.getRuntimeFrameProvider.mockReturnValue(null);
    hoisted.readRuntimeFrameForSource.mockReturnValue(null);

    const textureManager = {
      importVideoTexture: vi.fn(() => ({ label: 'html-video-texture' })),
    };

    const collector = new LayerCollector();
    const result = collector.collect([{
      id: 'layer-html-disabled',
      name: 'Video',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      source: {
        type: 'video',
        videoElement: video,
        webCodecsPlayer,
      },
    } as unknown as Layer], {
      textureManager: textureManager as unknown as TextureManager,
      scrubbingCache: null,
      getLastVideoTime: () => undefined,
      setLastVideoTime: () => {},
      isExporting: false,
      isPlaying: false,
    });

    expect(result).toHaveLength(0);
    expect(textureManager.importVideoTexture).not.toHaveBeenCalled();
    expect(webCodecsPlayer.getCurrentFrame).toHaveBeenCalledTimes(1);
    expect(collector.getDecoder()).toBe('none');
  });

  it('tracks paused HTML preview time per video element instead of per shared src', () => {
    flags.useFullWebCodecsPlayback = false;

    const sharedSrc = 'blob:shared-video';
    const firstVideo = {
      src: sharedSrc,
      currentTime: 1.25,
      readyState: 4,
      seeking: false,
      paused: false,
      videoWidth: 1920,
      videoHeight: 1080,
    } as unknown as HTMLVideoElement;
    const secondVideo = {
      src: sharedSrc,
      currentTime: 1.25,
      readyState: 4,
      seeking: false,
      paused: false,
      videoWidth: 1920,
      videoHeight: 1080,
    } as unknown as HTMLVideoElement;

    const textureManager = {
      importVideoTexture: vi.fn((video: HTMLVideoElement) => ({ label: `tex-${video === firstVideo ? 'first' : 'second'}` })),
    };
    const staleSecondFrame = { view: { label: 'stale-second-frame' }, width: 1920, height: 1080 };
    const scrubbingCache = {
      getLastFrame: vi.fn((video: HTMLVideoElement) => video === secondVideo ? staleSecondFrame : null),
      getLastFrameNearTime: vi.fn(() => null),
      getLastPresentedTime: vi.fn((video: HTMLVideoElement) => video.currentTime),
      getLastPresentedOwner: vi.fn(() => undefined),
      getCachedFrame: vi.fn(() => null),
      getLastCaptureTime: vi.fn(() => 0),
      captureVideoFrame: vi.fn(),
      setLastCaptureTime: vi.fn(),
      cacheFrameAtTime: vi.fn(),
    };
    const lastVideoTimes = new Map<string, number>();
    const deps = {
      textureManager: textureManager as unknown as TextureManager,
      scrubbingCache: scrubbingCache as unknown as ScrubbingCache,
      getLastVideoTime: (key: string) => lastVideoTimes.get(key),
      setLastVideoTime: (key: string, time: number) => {
        lastVideoTimes.set(key, time);
      },
      isExporting: false,
      isPlaying: false,
    };

    const collector = new LayerCollector();

    collector.collect([{
      id: 'layer-first',
      name: 'Video',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      source: {
        type: 'video',
        videoElement: firstVideo,
      },
    } as unknown as Layer], deps);

    const result = collector.collect([{
      id: 'layer-second',
      name: 'Video',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      source: {
        type: 'video',
        videoElement: secondVideo,
      },
    } as unknown as Layer], deps);

    expect(result).toHaveLength(1);
    expect(textureManager.importVideoTexture).toHaveBeenCalledTimes(2);
    expect(textureManager.importVideoTexture).toHaveBeenLastCalledWith(secondVideo);
    expect(result[0]?.externalTexture).toEqual({ label: 'tex-second' });
  });

  it('reports live HTML playback time instead of a stale last-presented timestamp', () => {
    flags.useFullWebCodecsPlayback = false;

    const video = {
      src: 'blob:test-video',
      currentTime: 4.5,
      readyState: 4,
      seeking: false,
      paused: false,
      videoWidth: 1920,
      videoHeight: 1080,
    } as unknown as HTMLVideoElement;

    const textureManager = {
      importVideoTexture: vi.fn(() => ({ label: 'html-video-texture' })),
    };
    const scrubbingCache = {
      getLastPresentedTime: vi.fn(() => 1.25),
      getLastPresentedOwner: vi.fn(() => undefined),
      getLastFrame: vi.fn(() => null),
      getLastFrameNearTime: vi.fn(() => null),
      getCachedFrameEntry: vi.fn(() => null),
      getNearestCachedFrameEntry: vi.fn(() => null),
      getLastCaptureTime: vi.fn(() => 0),
      captureVideoFrame: vi.fn(),
      setLastCaptureTime: vi.fn(),
      cacheFrameAtTime: vi.fn(),
      captureVideoFrameIfCloser: vi.fn(),
    };

    const collector = new LayerCollector();
    const result = collector.collect([{
      id: 'layer-live-html',
      sourceClipId: 'clip-live-html',
      name: 'Video',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      source: {
        type: 'video',
        videoElement: video,
      },
    } as unknown as Layer], {
      textureManager: textureManager as unknown as TextureManager,
      scrubbingCache: scrubbingCache as unknown as ScrubbingCache,
      getLastVideoTime: () => undefined,
      setLastVideoTime: () => {},
      isExporting: false,
      isPlaying: true,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      isVideo: true,
      externalTexture: { label: 'html-video-texture' },
      displayedMediaTime: 4.5,
      targetMediaTime: 4.5,
      previewPath: 'live-import',
    });
  });

  it('uses copied HTML video frames on Firefox instead of external textures', () => {
    flags.useFullWebCodecsPlayback = false;
    Object.defineProperty(globalThis.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0',
    });

    const video = {
      src: 'blob:test-video',
      currentTime: 1.25,
      readyState: 4,
      seeking: false,
      paused: false,
      videoWidth: 1920,
      videoHeight: 1080,
    } as unknown as HTMLVideoElement;

    const copiedFrame = { view: { label: 'copied-frame' }, width: 1920, height: 1080 };
    const textureManager = {
      importVideoTexture: vi.fn(() => ({ label: 'html-video-texture' })),
    };
    const scrubbingCache = {
      captureVideoFrame: vi.fn(() => true),
      getLastFrame: vi.fn(() => copiedFrame),
      getLastFrameNearTime: vi.fn(() => copiedFrame),
      getLastPresentedTime: vi.fn(() => 1.25),
      getLastPresentedOwner: vi.fn(() => undefined),
      getCachedFrame: vi.fn(() => null),
      getLastCaptureTime: vi.fn(() => 0),
      setLastCaptureTime: vi.fn(),
      cacheFrameAtTime: vi.fn(),
    };

    const collector = new LayerCollector();
    const result = collector.collect([{
      id: 'layer-firefox',
      name: 'Video',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      source: {
        type: 'video',
        videoElement: video,
      },
    } as unknown as Layer], {
      textureManager: textureManager as unknown as TextureManager,
      scrubbingCache: scrubbingCache as unknown as ScrubbingCache,
      getLastVideoTime: () => undefined,
      setLastVideoTime: () => {},
      isExporting: false,
      isPlaying: true,
    });

    expect(result).toHaveLength(1);
    expect(scrubbingCache.captureVideoFrame).toHaveBeenCalledWith(video, undefined);
    expect(textureManager.importVideoTexture).not.toHaveBeenCalled();
    expect(result[0]).toMatchObject({
      isVideo: false,
      externalTexture: null,
      textureView: copiedFrame.view,
      sourceWidth: copiedFrame.width,
      sourceHeight: copiedFrame.height,
    });
    expect(collector.getDecoder()).toBe('HTMLVideo');
    expect(collector.hasActiveVideo()).toBe(true);
  });

  it('keeps the last near same-clip frame during hard scrubs instead of dropping to black', () => {
    flags.useFullWebCodecsPlayback = false;
    useTimelineStore.setState({ isDraggingPlayhead: true });

    const video = {
      src: 'blob:test-video',
      currentTime: 18,
      readyState: 1,
      seeking: true,
      paused: true,
      videoWidth: 1920,
      videoHeight: 1080,
    } as unknown as HTMLVideoElement;

    const heldFrame = {
      view: { label: 'held-same-clip-frame' },
      width: 1920,
      height: 1080,
      mediaTime: 18,
    };
    const textureManager = {
      importVideoTexture: vi.fn(() => null),
    };
    const scrubbingCache = {
      getLastPresentedTime: vi.fn(() => undefined),
      getLastPresentedOwner: vi.fn(() => undefined),
      getLastFrame: vi.fn(() => heldFrame),
      getLastFrameNearTime: vi.fn(() => null),
      getCachedFrameEntry: vi.fn(() => null),
      getNearestCachedFrameEntry: vi.fn(() => null),
      getLastCaptureTime: vi.fn(() => 0),
      captureVideoFrame: vi.fn(),
      setLastCaptureTime: vi.fn(),
      cacheFrameAtTime: vi.fn(),
      captureVideoFrameIfCloser: vi.fn(),
    };

    const collector = new LayerCollector();
    const result = collector.collect([{
      id: 'layer-hard-scrub',
      sourceClipId: 'clip-hard-scrub',
      name: 'Video',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      source: {
        type: 'video',
        mediaTime: 18,
        videoElement: video,
      },
    } as unknown as Layer], {
      textureManager: textureManager as unknown as TextureManager,
      scrubbingCache: scrubbingCache as unknown as ScrubbingCache,
      getLastVideoTime: () => undefined,
      setLastVideoTime: () => {},
      isExporting: false,
      isPlaying: false,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      isVideo: false,
      externalTexture: null,
      textureView: heldFrame.view,
      sourceWidth: heldFrame.width,
      sourceHeight: heldFrame.height,
      displayedMediaTime: heldFrame.mediaTime,
      targetMediaTime: 18,
      previewPath: 'emergency-hold',
    });
  });

  it('keeps the last same-clip frame during playback warmup instead of dropping to black', () => {
    flags.useFullWebCodecsPlayback = false;
    useTimelineStore.setState({ isDraggingPlayhead: false });

    const video = {
      src: 'blob:test-video',
      currentTime: 18,
      readyState: 1,
      seeking: true,
      paused: false,
      videoWidth: 1920,
      videoHeight: 1080,
    } as unknown as HTMLVideoElement;

    const heldFrame = {
      view: { label: 'held-playback-warmup-frame' },
      width: 1920,
      height: 1080,
      mediaTime: 18,
    };
    const textureManager = {
      importVideoTexture: vi.fn(() => null),
    };
    const scrubbingCache = {
      getLastPresentedTime: vi.fn(() => undefined),
      getLastPresentedOwner: vi.fn(() => undefined),
      getLastFrame: vi.fn(() => heldFrame),
      getLastFrameNearTime: vi.fn(() => null),
      getCachedFrameEntry: vi.fn(() => null),
      getNearestCachedFrameEntry: vi.fn(() => null),
      getLastCaptureTime: vi.fn(() => 0),
      captureVideoFrame: vi.fn(),
      setLastCaptureTime: vi.fn(),
      cacheFrameAtTime: vi.fn(),
      captureVideoFrameIfCloser: vi.fn(),
    };

    const collector = new LayerCollector();
    const result = collector.collect([{
      id: 'layer-playback-warmup',
      sourceClipId: 'clip-playback-warmup',
      name: 'Video',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      source: {
        type: 'video',
        mediaTime: 18,
        videoElement: video,
      },
    } as unknown as Layer], {
      textureManager: textureManager as unknown as TextureManager,
      scrubbingCache: scrubbingCache as unknown as ScrubbingCache,
      getLastVideoTime: () => undefined,
      setLastVideoTime: () => {},
      isExporting: false,
      isPlaying: true,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      isVideo: false,
      externalTexture: null,
      textureView: heldFrame.view,
      sourceWidth: heldFrame.width,
      sourceHeight: heldFrame.height,
      displayedMediaTime: heldFrame.mediaTime,
      targetMediaTime: 18,
      previewPath: 'same-clip-hold',
    });
  });

  it('uses an ownerless cached frame during playback warmup when initial pre-cache has no clip owner', () => {
    flags.useFullWebCodecsPlayback = false;
    useTimelineStore.setState({ isDraggingPlayhead: false });

    const video = {
      src: 'blob:test-video',
      currentTime: 0,
      readyState: 1,
      seeking: false,
      paused: false,
      videoWidth: 1920,
      videoHeight: 1080,
    } as unknown as HTMLVideoElement;

    const heldFrame = {
      view: { label: 'ownerless-precache-frame' },
      width: 1920,
      height: 1080,
      mediaTime: 0,
    };
    const textureManager = {
      importVideoTexture: vi.fn(() => null),
    };
    const scrubbingCache = {
      getLastPresentedTime: vi.fn(() => undefined),
      getLastPresentedOwner: vi.fn(() => undefined),
      getLastFrameOwner: vi.fn(() => undefined),
      getLastFrame: vi.fn((_: HTMLVideoElement, ownerId?: string) => ownerId ? null : heldFrame),
      getLastFrameNearTime: vi.fn(() => null),
      getCachedFrameEntry: vi.fn(() => null),
      getNearestCachedFrameEntry: vi.fn(() => null),
      getLastCaptureTime: vi.fn(() => 0),
      captureVideoFrame: vi.fn(),
      setLastCaptureTime: vi.fn(),
      cacheFrameAtTime: vi.fn(),
      captureVideoFrameIfCloser: vi.fn(),
    };

    const collector = new LayerCollector();
    const result = collector.collect([{
      id: 'layer-ownerless-precache',
      sourceClipId: 'clip-ownerless-precache',
      name: 'Video',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      source: {
        type: 'video',
        mediaTime: 0,
        videoElement: video,
      },
    } as unknown as Layer], {
      textureManager: textureManager as unknown as TextureManager,
      scrubbingCache: scrubbingCache as unknown as ScrubbingCache,
      getLastVideoTime: () => undefined,
      setLastVideoTime: () => {},
      isExporting: false,
      isPlaying: true,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      isVideo: false,
      externalTexture: null,
      textureView: heldFrame.view,
      sourceWidth: heldFrame.width,
      sourceHeight: heldFrame.height,
      displayedMediaTime: heldFrame.mediaTime,
      targetMediaTime: 0,
      previewPath: 'playback-stall-hold',
    });
  });

  it('uses a near seeking cache fallback when a seeked HTML frame cannot import', () => {
    flags.useFullWebCodecsPlayback = false;
    useTimelineStore.setState({ isDraggingPlayhead: true });

    const video = {
      src: 'blob:test-video',
      currentTime: 25,
      readyState: 4,
      seeking: true,
      paused: true,
      videoWidth: 1920,
      videoHeight: 1080,
    } as unknown as HTMLVideoElement;

    const heldFrame = {
      view: { label: 'held-seeking-frame' },
      width: 1920,
      height: 1080,
      mediaTime: 25,
    };
    const textureManager = {
      importVideoTexture: vi.fn(() => null),
    };
    const scrubbingCache = {
      getLastPresentedTime: vi.fn(() => undefined),
      getLastPresentedOwner: vi.fn(() => undefined),
      getLastFrame: vi.fn(() => heldFrame),
      getLastFrameNearTime: vi.fn(() => null),
      getCachedFrameEntry: vi.fn(() => null),
      getNearestCachedFrameEntry: vi.fn(() => null),
      getLastCaptureTime: vi.fn(() => 0),
      captureVideoFrame: vi.fn(),
      setLastCaptureTime: vi.fn(),
      cacheFrameAtTime: vi.fn(),
      captureVideoFrameIfCloser: vi.fn(),
    };

    const collector = new LayerCollector();
    const result = collector.collect([{
      id: 'layer-seek-fallback',
      sourceClipId: 'clip-seek-fallback',
      name: 'Video',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      source: {
        type: 'video',
        mediaTime: 25,
        videoElement: video,
      },
    } as unknown as Layer], {
      textureManager: textureManager as unknown as TextureManager,
      scrubbingCache: scrubbingCache as unknown as ScrubbingCache,
      getLastVideoTime: () => undefined,
      setLastVideoTime: () => {},
      isExporting: false,
      isPlaying: false,
    });

    expect(result).toHaveLength(1);
    expect(textureManager.importVideoTexture).not.toHaveBeenCalled();
    expect(result[0]).toMatchObject({
      isVideo: false,
      externalTexture: null,
      textureView: heldFrame.view,
      sourceWidth: heldFrame.width,
      sourceHeight: heldFrame.height,
      displayedMediaTime: heldFrame.mediaTime,
      targetMediaTime: 25,
      previewPath: 'seeking-cache',
    });
  });

  it('keeps a short same-clip hold window before returning to live HTML imports', () => {
    vi.useFakeTimers();
    flags.useFullWebCodecsPlayback = false;
    useTimelineStore.setState({ isDraggingPlayhead: true });

    const video = {
      src: 'blob:test-video',
      currentTime: 12,
      readyState: 1,
      seeking: true,
      paused: true,
      videoWidth: 1920,
      videoHeight: 1080,
    } as unknown as HTMLVideoElement;

    const heldFrame = {
      view: { label: 'held-frame' },
      width: 1920,
      height: 1080,
      mediaTime: 12,
    };
    const extTex = { label: 'live-texture' };
    const textureManager = {
      importVideoTexture: vi.fn(() => extTex),
    };
    const scrubbingCache = {
      getLastPresentedTime: vi.fn(() => undefined),
      getLastPresentedOwner: vi.fn(() => undefined),
      getLastFrame: vi.fn(() => heldFrame),
      getLastFrameNearTime: vi.fn(() => null),
      getCachedFrameEntry: vi.fn(() => null),
      getNearestCachedFrameEntry: vi.fn(() => null),
      getLastCaptureTime: vi.fn(() => 0),
      captureVideoFrame: vi.fn(),
      setLastCaptureTime: vi.fn(),
      cacheFrameAtTime: vi.fn(),
      captureVideoFrameIfCloser: vi.fn(),
    };
    const deps = {
      textureManager: textureManager as unknown as TextureManager,
      scrubbingCache: scrubbingCache as unknown as ScrubbingCache,
      getLastVideoTime: () => undefined,
      setLastVideoTime: () => {},
      isExporting: false,
      isPlaying: false,
    };

    const collector = new LayerCollector();
    const layer = {
      id: 'layer-stable-hold',
      sourceClipId: 'clip-stable-hold',
      name: 'Video',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      source: {
        type: 'video',
        mediaTime: 12,
        videoElement: video,
      },
    } as unknown as Layer;

    const first = collector.collect([layer], deps);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      isVideo: false,
      textureView: heldFrame.view,
      previewPath: 'emergency-hold',
    });

    video.readyState = 4;
    video.seeking = false;

    const second = collector.collect([layer], deps);
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({
      isVideo: false,
      textureView: heldFrame.view,
    });
    expect(second[0]?.previewPath).not.toBe('live-import');
    expect(textureManager.importVideoTexture).not.toHaveBeenCalled();

    vi.advanceTimersByTime(130);
    video.paused = false;

    const third = collector.collect([layer], {
      ...deps,
      isPlaying: true,
    });
    expect(third).toHaveLength(1);
    expect(third[0]).toMatchObject({
      isVideo: true,
      externalTexture: extTex,
      previewPath: 'live-import',
    });
    expect(textureManager.importVideoTexture).toHaveBeenCalledTimes(1);
  });
});
