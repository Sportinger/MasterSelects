import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RamPreviewEngine } from '../../src/services/ramPreviewEngine';
import { mediaRuntimeRegistry } from '../../src/services/mediaRuntime/registry';
import {
  releaseRamPreviewRunResources,
  reserveRamPreviewImageElement,
} from '../../src/services/timeline/ramPreviewRuntimeReporting';
import { timelineRuntimeCoordinator } from '../../src/services/timeline/timelineRuntimeCoordinator';
import type { RuntimeFrameProvider } from '../../src/services/mediaRuntime/types';
import type { TimelineClip, TimelineTrack } from '../../src/types';

function createProvider(): RuntimeFrameProvider {
  return {
    currentTime: 0,
    isPlaying: false,
    isFullMode: () => true,
    isSimpleMode: () => false,
    getCurrentFrame: () => null,
    seek(timeSeconds: number) {
      this.currentTime = timeSeconds;
    },
    pause: vi.fn(),
  };
}

function createVideoClip(
  sourceId: string,
  provider: RuntimeFrameProvider,
  options: {
    id?: string;
    trackId?: string;
    name?: string;
    mediaFileId?: string;
  } = {}
): TimelineClip {
  const id = options.id ?? 'clip-video';
  const trackId = options.trackId ?? 'track-video';
  const name = options.name ?? 'clip.mp4';
  const mediaFileId = options.mediaFileId ?? 'media-video';

  return {
    id,
    trackId,
    name,
    file: new File(['video'], name, { type: 'video/mp4' }),
    startTime: 0,
    duration: 1,
    inPoint: 0,
    outPoint: 1,
    source: {
      type: 'video',
      videoElement: document.createElement('video'),
      webCodecsPlayer: provider,
      runtimeSourceId: sourceId,
      runtimeSessionKey: `interactive:${id}:${sourceId}`,
      mediaFileId,
      naturalDuration: 1,
    },
    mediaFileId,
    transform: {
      opacity: 1,
      blendMode: 'normal',
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    },
    effects: [],
  } as TimelineClip;
}

describe('RamPreviewEngine runtime reporting', () => {
  beforeEach(() => {
    timelineRuntimeCoordinator.clearResources();
    mediaRuntimeRegistry.clear();
  });

  afterEach(() => {
    releaseRamPreviewRunResources('run-engine');
    timelineRuntimeCoordinator.clearResources();
    mediaRuntimeRegistry.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reports run video resources and releases ram-preview runtime sessions after generation', async () => {
    const runtime = mediaRuntimeRegistry.retainRuntime(
      {
        kind: 'video',
        mediaFileId: 'media-video',
        file: new File(['video'], 'clip.mp4', { type: 'video/mp4' }),
      },
      'clip-video'
    );
    expect(runtime).toBeTruthy();

    const provider = createProvider();
    const clip = createVideoClip(runtime!.sourceId, provider);
    const track: TimelineTrack = {
      id: 'track-video',
      name: 'Video 1',
      type: 'video',
      height: 60,
      muted: false,
      visible: true,
      solo: false,
    };
    const renderEngine = {
      render: vi.fn(),
      cacheCompositeFrame: vi.fn().mockResolvedValue(undefined),
    };
    const preview = new RamPreviewEngine(renderEngine);

    const result = await preview.generate(
      {
        start: 0,
        end: 1 / 30,
        centerTime: 0,
        clips: [clip],
        tracks: [track],
        runId: 'run-engine',
      },
      {
        isCancelled: () => false,
        isFrameCached: () => false,
        getSourceTimeForClip: () => 0,
        getInterpolatedSpeed: () => 1,
        getCompositionDimensions: () => ({ width: 1920, height: 1080 }),
        onFrameCached: vi.fn(),
        onProgress: vi.fn(),
      }
    );

    expect(result.completed).toBe(true);
    expect(renderEngine.render).toHaveBeenCalled();
    expect(renderEngine.cacheCompositeFrame).toHaveBeenCalledWith(0);

    const stats = timelineRuntimeCoordinator.getBridgeStats().policies['ram-preview'];
    expect(stats.budgetReport.usage).toMatchObject({
      resources: 3,
      sessions: 1,
      frameProviders: 1,
      htmlMediaElements: 1,
    });

    expect(runtime!.peekSession(`ram-preview:clip-video:${runtime!.sourceId}`)).toBeNull();
  });

  it('renders data-only image clips from imageUrl without mutating clip source', async () => {
    const createdImages: HTMLImageElement[] = [];
    vi.stubGlobal('Image', vi.fn(function ImageMock() {
      const image = document.createElement('img');
      createdImages.push(image);
      queueMicrotask(() => image.dispatchEvent(new Event('load')));
      return image;
    }));
    const clip: TimelineClip = {
      id: 'clip-image',
      trackId: 'track-video',
      name: 'Still.png',
      file: new File([], 'pending.png', { type: 'image/png' }),
      startTime: 0,
      duration: 1,
      inPoint: 0,
      outPoint: 1,
      source: {
        type: 'image',
        mediaFileId: 'media-image',
        naturalDuration: 1,
        imageUrl: 'blob:ram-preview-image',
      },
      mediaFileId: 'media-image',
      transform: {
        opacity: 1,
        blendMode: 'normal',
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: { x: 0, y: 0, z: 0 },
      },
      effects: [],
    } as TimelineClip;
    const track: TimelineTrack = {
      id: 'track-video',
      name: 'Video 1',
      type: 'video',
      height: 60,
      muted: false,
      visible: true,
      solo: false,
    };
    const renderEngine = {
      render: vi.fn(),
      cacheCompositeFrame: vi.fn().mockResolvedValue(undefined),
    };
    const preview = new RamPreviewEngine(renderEngine);

    const result = await preview.generate(
      {
        start: 0,
        end: 1 / 30,
        centerTime: 0,
        clips: [clip],
        tracks: [track],
        runId: 'run-engine',
      },
      {
        isCancelled: () => false,
        isFrameCached: () => false,
        getSourceTimeForClip: () => 0,
        getInterpolatedSpeed: () => 1,
        getCompositionDimensions: () => ({ width: 1920, height: 1080 }),
        onFrameCached: vi.fn(),
        onProgress: vi.fn(),
      }
    );

    expect(result.completed).toBe(true);
    expect(createdImages[0]?.src).toBe('blob:ram-preview-image');
    expect(renderEngine.render).toHaveBeenCalledWith([
      expect.objectContaining({
        source: {
          type: 'image',
          imageElement: createdImages[0],
          mediaFileId: 'media-image',
        },
      }),
    ]);
    expect(clip.source?.imageElement).toBeUndefined();
  });

  it('skips RAM-preview image allocation when the run image budget is full', async () => {
    const ImageCtor = vi.fn(function ImageMock() {
      return document.createElement('img');
    });
    vi.stubGlobal('Image', ImageCtor);
    for (let index = 0; index < 96; index += 1) {
      reserveRamPreviewImageElement({
        runId: `existing-run-${index}`,
        clip: {
          id: `existing-image-${index}`,
          trackId: 'track-video',
          mediaFileId: `media-image-${index}`,
          duration: 1,
        },
      });
    }
    const clip: TimelineClip = {
      id: 'clip-image',
      trackId: 'track-video',
      name: 'Still.png',
      file: new File([], 'pending.png', { type: 'image/png' }),
      startTime: 0,
      duration: 1,
      inPoint: 0,
      outPoint: 1,
      source: {
        type: 'image',
        mediaFileId: 'media-image',
        naturalDuration: 1,
        imageUrl: 'blob:ram-preview-image',
      },
      mediaFileId: 'media-image',
      transform: {
        opacity: 1,
        blendMode: 'normal',
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: { x: 0, y: 0, z: 0 },
      },
      effects: [],
    } as TimelineClip;
    const track: TimelineTrack = {
      id: 'track-video',
      name: 'Video 1',
      type: 'video',
      height: 60,
      muted: false,
      visible: true,
      solo: false,
    };
    const renderEngine = {
      render: vi.fn(),
      cacheCompositeFrame: vi.fn().mockResolvedValue(undefined),
    };
    const preview = new RamPreviewEngine(renderEngine);

    const result = await preview.generate(
      {
        start: 0,
        end: 1 / 30,
        centerTime: 0,
        clips: [clip],
        tracks: [track],
        runId: 'run-engine',
      },
      {
        isCancelled: () => false,
        isFrameCached: () => false,
        getSourceTimeForClip: () => 0,
        getInterpolatedSpeed: () => 1,
        getCompositionDimensions: () => ({ width: 1920, height: 1080 }),
        onFrameCached: vi.fn(),
        onProgress: vi.fn(),
      }
    );

    expect(result.completed).toBe(false);
    expect(ImageCtor).not.toHaveBeenCalled();
    expect(renderEngine.render).not.toHaveBeenCalled();
    expect(renderEngine.cacheCompositeFrame).not.toHaveBeenCalled();
    expect(timelineRuntimeCoordinator.getBridgeStats().policies['ram-preview'].budgetReport.usage.resources).toBe(96);
  });

  it('skips RAM-preview video allocation without creating a runtime session when the run budget is full', async () => {
    for (let index = 0; index < 96; index += 1) {
      reserveRamPreviewImageElement({
        runId: `existing-video-run-${index}`,
        clip: {
          id: `existing-video-budget-${index}`,
          trackId: 'track-video',
          mediaFileId: `media-video-budget-${index}`,
          duration: 1,
        },
      });
    }

    const runtime = mediaRuntimeRegistry.retainRuntime(
      {
        kind: 'video',
        mediaFileId: 'media-video',
        file: new File(['video'], 'clip.mp4', { type: 'video/mp4' }),
      },
      'clip-video'
    );
    expect(runtime).toBeTruthy();

    const provider = createProvider();
    const clip = createVideoClip(runtime!.sourceId, provider);
    const track: TimelineTrack = {
      id: 'track-video',
      name: 'Video 1',
      type: 'video',
      height: 60,
      muted: false,
      visible: true,
      solo: false,
    };
    const renderEngine = {
      render: vi.fn(),
      cacheCompositeFrame: vi.fn().mockResolvedValue(undefined),
    };
    const preview = new RamPreviewEngine(renderEngine);

    const result = await preview.generate(
      {
        start: 0,
        end: 1 / 30,
        centerTime: 0,
        clips: [clip],
        tracks: [track],
        runId: 'run-engine',
      },
      {
        isCancelled: () => false,
        isFrameCached: () => false,
        getSourceTimeForClip: () => 0,
        getInterpolatedSpeed: () => 1,
        getCompositionDimensions: () => ({ width: 1920, height: 1080 }),
        onFrameCached: vi.fn(),
        onProgress: vi.fn(),
      }
    );

    expect(result.completed).toBe(false);
    expect(provider.currentTime).toBe(0);
    expect(runtime!.peekSession(`ram-preview:clip-video:${runtime!.sourceId}`)).toBeNull();
    expect(renderEngine.render).not.toHaveBeenCalled();
    expect(renderEngine.cacheCompositeFrame).not.toHaveBeenCalled();
    expect(timelineRuntimeCoordinator.getBridgeStats().policies['ram-preview'].budgetReport.usage.resources).toBe(96);
  });

  it('does not create ram-preview sessions while verifying hidden video clips', async () => {
    const visibleRuntime = mediaRuntimeRegistry.retainRuntime(
      {
        kind: 'video',
        mediaFileId: 'media-visible',
        file: new File(['visible'], 'visible.mp4', { type: 'video/mp4' }),
      },
      'clip-visible'
    );
    const hiddenRuntime = mediaRuntimeRegistry.retainRuntime(
      {
        kind: 'video',
        mediaFileId: 'media-hidden',
        file: new File(['hidden'], 'hidden.mp4', { type: 'video/mp4' }),
      },
      'clip-hidden'
    );
    expect(visibleRuntime).toBeTruthy();
    expect(hiddenRuntime).toBeTruthy();

    const visibleProvider = createProvider();
    const hiddenProvider = createProvider();
    hiddenProvider.currentTime = 0.5;
    const visibleClip = createVideoClip(visibleRuntime!.sourceId, visibleProvider, {
      id: 'clip-visible',
      trackId: 'track-visible',
      name: 'visible.mp4',
      mediaFileId: 'media-visible',
    });
    const hiddenClip = createVideoClip(hiddenRuntime!.sourceId, hiddenProvider, {
      id: 'clip-hidden',
      trackId: 'track-hidden',
      name: 'hidden.mp4',
      mediaFileId: 'media-hidden',
    });
    const tracks: TimelineTrack[] = [
      {
        id: 'track-visible',
        name: 'Visible',
        type: 'video',
        height: 60,
        muted: false,
        visible: true,
        solo: false,
      },
      {
        id: 'track-hidden',
        name: 'Hidden',
        type: 'video',
        height: 60,
        muted: false,
        visible: false,
        solo: false,
      },
    ];
    const renderEngine = {
      render: vi.fn(),
      cacheCompositeFrame: vi.fn().mockResolvedValue(undefined),
    };
    const preview = new RamPreviewEngine(renderEngine);

    const result = await preview.generate(
      {
        start: 0.5,
        end: 0.5,
        centerTime: 0.5,
        clips: [visibleClip, hiddenClip],
        tracks,
        runId: 'run-engine',
      },
      {
        isCancelled: () => false,
        isFrameCached: () => false,
        getSourceTimeForClip: (_clipId, localTime) => localTime,
        getInterpolatedSpeed: () => 1,
        getCompositionDimensions: () => ({ width: 1920, height: 1080 }),
        onFrameCached: vi.fn(),
        onProgress: vi.fn(),
      }
    );

    expect(result.completed).toBe(true);
    expect(renderEngine.render).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'clip-visible' }),
    ]);
    expect(hiddenRuntime!.peekSession(`ram-preview:clip-hidden:${hiddenRuntime!.sourceId}`)).toBeNull();
  });
});
