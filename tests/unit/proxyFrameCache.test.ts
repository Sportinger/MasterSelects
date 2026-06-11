import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RenderResourceDescriptor } from '../../src/services/timeline/runtimeCoordinatorTypes';
import { timelineRuntimeCoordinator } from '../../src/services/timeline/timelineRuntimeCoordinator';
import { projectFileService } from '../../src/services/projectFileService';
import { useMediaStore } from '../../src/stores/mediaStore';

vi.unmock('../../src/services/proxyFrameCache');

import { proxyFrameCache } from '../../src/services/proxyFrameCache';
import { mediaRuntimeObjectUrlLeaseOwner } from '../../src/services/mediaRuntime/objectUrlLeases';
import { mediaRuntimeScrubAudioLeaseOwner } from '../../src/services/mediaRuntime/scrubAudioLeases';
import { MAX_AUDIO_BUFFER_CACHE_ENTRIES } from '../../src/services/proxyFrame/audioBufferLoader';

type ProxyFrameCacheInternals = typeof proxyFrameCache & {
  cache: Map<string, {
    mediaFileId: string;
    frameIndex: number;
    image: HTMLImageElement;
    timestamp: number;
  }>;
  videoFrameCache: Map<string, {
    mediaFileId: string;
    frameIndex: number;
    frame: VideoFrame;
    timestamp: number;
  }>;
  audioCache: Map<string, HTMLAudioElement>;
  audioLoadingPromises: Map<string, Promise<HTMLAudioElement | null>>;
  audioBufferCache: Map<string, AudioBuffer>;
  preloadQueue: string[];
  isPreloading: boolean;
  isScrubbing: boolean;
  lastScrubFrame: number;
  scrubDirection: number;
  scrubPreloadQueueDrops: number;
  scrubIsActive: boolean;
  addToCache(mediaFileId: string, frameIndex: number, image: HTMLImageElement): boolean;
  addVideoFrameToCache(mediaFileId: string, frameIndex: number, frame: VideoFrame): boolean;
  cacheDecodedAudioBuffer(mediaFileId: string, buffer: AudioBuffer): boolean;
  evictOldest(): void;
  evictOldestVideoFrame(): void;
  schedulePreload(mediaFileId: string, currentFrameIndex: number, fps: number): void;
};

const cache = proxyFrameCache as ProxyFrameCacheInternals;

function getInteractivePolicyBudget() {
  const budget = timelineRuntimeCoordinator.getPolicy('interactive')?.defaultBudget;
  if (!budget) throw new Error('Missing interactive runtime policy budget');
  return budget;
}

function resetProxyFrameCacheInternals(): void {
  cache.disposeAudioContext();
  for (const mediaFileId of Array.from(cache.audioCache.keys())) {
    proxyFrameCache.releaseAudioProxy(mediaFileId);
  }
  cache.audioCache.clear();
  cache.audioLoadingPromises.clear();
  // Owned-audio object URLs moved behind the mediaRuntime lease owners
  // (packet 193); reset them through the new seam instead of an internal set.
  mediaRuntimeObjectUrlLeaseOwner.clear();
  mediaRuntimeScrubAudioLeaseOwner.clear();
  cache.cache.clear();
  for (const entry of cache.videoFrameCache.values()) {
    entry.frame.close();
  }
  cache.videoFrameCache.clear();
  cache.audioBufferCache.clear();
  timelineRuntimeCoordinator.clearResources();
  cache.preloadQueue = [];
  cache.isPreloading = true;
  cache.isScrubbing = false;
  cache.lastScrubFrame = -1;
  cache.scrubDirection = 0;
  cache.scrubPreloadQueueDrops = 0;
  cache.resetPerformanceCounters();
  useMediaStore.setState({ files: [] });
}

function createMockImage(width = 320, height = 180): HTMLImageElement {
  return {
    naturalWidth: width,
    naturalHeight: height,
    width,
    height,
  } as HTMLImageElement;
}

function createRetainedThumbnailResource(heapBytes: number): RenderResourceDescriptor {
  return {
    id: 'retained-thumbnail-budget',
    kind: 'image-canvas',
    policyId: 'thumbnail',
    owner: {
      ownerId: 'retained-thumbnail-owner',
      ownerType: 'thumbnail',
    },
    imageKind: 'html-image',
    imageId: 'retained-thumbnail-image',
    memoryCost: {
      heapBytes,
    },
  };
}

function createRetainedInteractiveAudioResource(heapBytes: number): RenderResourceDescriptor {
  return {
    id: 'retained-audio-budget',
    kind: 'audio-source-clock',
    policyId: 'interactive',
    owner: {
      ownerId: 'retained-audio-owner',
      ownerType: 'timeline',
      mediaFileId: 'retained-audio-media',
    },
    audioSourceId: 'retained-audio-media',
    memoryCost: {
      heapBytes,
    },
  };
}

function createRetainedInteractiveHtmlAudioResource(index: number): RenderResourceDescriptor {
  return {
    id: `retained-html-audio-${index}`,
    kind: 'html-media',
    policyId: 'interactive',
    owner: {
      ownerId: `retained-html-audio-${index}`,
      ownerType: 'timeline',
      mediaFileId: `retained-html-audio-media-${index}`,
    },
    mediaElementKind: 'audio',
    elementId: `retained-html-audio-${index}`,
    srcKind: 'blob-url',
  };
}

type MockAudioElement = EventTarget & Pick<
  HTMLAudioElement,
  | 'src'
  | 'currentSrc'
  | 'preload'
  | 'readyState'
  | 'networkState'
  | 'paused'
  | 'seeking'
  | 'currentTime'
  | 'error'
  | 'load'
  | 'pause'
  | 'removeAttribute'
>;

function createMockAudioElement(): MockAudioElement {
  const audio = new EventTarget() as MockAudioElement;
  audio.src = '';
  Object.defineProperty(audio, 'currentSrc', {
    get: () => audio.src,
    configurable: true,
  });
  audio.preload = '';
  audio.readyState = HTMLMediaElement.HAVE_ENOUGH_DATA;
  audio.networkState = HTMLMediaElement.NETWORK_IDLE;
  audio.paused = true;
  audio.seeking = false;
  audio.currentTime = 0;
  audio.error = null;
  audio.pause = vi.fn();
  audio.removeAttribute = vi.fn((name: string) => {
    if (name === 'src') {
      audio.src = '';
    }
  });
  audio.load = vi.fn(() => {
    audio.dispatchEvent(new Event('canplaythrough'));
  });
  return audio;
}

type MockVideoFrame = VideoFrame & {
  close: ReturnType<typeof vi.fn>;
};

function createMockVideoFrame(width = 320, height = 180): MockVideoFrame {
  return {
    codedWidth: width,
    codedHeight: height,
    displayWidth: width,
    displayHeight: height,
    close: vi.fn(),
  } as unknown as MockVideoFrame;
}

function createRetainedInteractiveVideoProviderResource(heapBytes: number): RenderResourceDescriptor {
  return {
    id: 'retained-video-frame-budget',
    kind: 'video-frame-provider',
    policyId: 'interactive',
    owner: {
      ownerId: 'retained-video-frame-owner',
      ownerType: 'timeline',
      mediaFileId: 'retained-video-frame-media',
    },
    providerId: 'retained-video-frame-provider',
    providerKind: 'webcodecs',
    frameFormat: 'video-frame',
    memoryCost: {
      heapBytes,
    },
  };
}

type MockAudioSourceNode = AudioBufferSourceNode & {
  playbackRate: { value: number };
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
};

function createAudioNodeMock(): AudioNode {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
  } as unknown as AudioNode;
}

function createAudioParamMock(value = 0): AudioParam {
  return {
    value,
    cancelScheduledValues: vi.fn(),
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
  } as unknown as AudioParam;
}

function createMockAudioBuffer(duration = 10, sampleRate = 48_000): AudioBuffer {
  const length = Math.round(duration * sampleRate);
  const channelData = [
    Float32Array.from({ length }, (_value, index) => index / length),
    Float32Array.from({ length }, (_value, index) => 1 - index / length),
  ];

  return {
    duration,
    numberOfChannels: 2,
    sampleRate,
    length,
    getChannelData: vi.fn((channel: number) => channelData[channel] ?? channelData[0]),
  } as unknown as AudioBuffer;
}

function installScrubAudioContextMock() {
  const originalAudioContext = globalThis.AudioContext;
  const sources: MockAudioSourceNode[] = [];
  const contexts: ScrubAudioContextMock[] = [];

  class ScrubAudioContextMock {
    currentTime = 0;
    sampleRate = 48_000;
    state: AudioContextState = 'running';
    destination = createAudioNodeMock();

    createGain(): GainNode {
      return {
        ...createAudioNodeMock(),
        gain: createAudioParamMock(1),
      } as unknown as GainNode;
    }

    createAnalyser(): AnalyserNode {
      return {
        ...createAudioNodeMock(),
        fftSize: 1024,
        frequencyBinCount: 512,
        smoothingTimeConstant: 0,
        getFloatTimeDomainData: vi.fn(),
        getFloatFrequencyData: vi.fn(),
      } as unknown as AnalyserNode;
    }

    createBufferSource(): AudioBufferSourceNode {
      const source = {
        ...createAudioNodeMock(),
        buffer: null,
        playbackRate: createAudioParamMock(1),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null,
      } as unknown as MockAudioSourceNode;
      sources.push(source);
      return source;
    }

    createStereoPanner(): StereoPannerNode {
      return {
        ...createAudioNodeMock(),
        pan: createAudioParamMock(0),
      } as unknown as StereoPannerNode;
    }

    createChannelSplitter(): ChannelSplitterNode {
      return createAudioNodeMock() as unknown as ChannelSplitterNode;
    }

    createBiquadFilter(): BiquadFilterNode {
      return {
        ...createAudioNodeMock(),
        type: 'peaking',
        frequency: createAudioParamMock(1000),
        Q: createAudioParamMock(1),
        gain: createAudioParamMock(0),
      } as unknown as BiquadFilterNode;
    }

    createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBuffer {
      const duration = length / sampleRate;
      return createMockAudioBuffer(duration, sampleRate);
    }

    resume = vi.fn().mockResolvedValue(undefined);
    close = vi.fn().mockResolvedValue(undefined);

    constructor() {
      contexts.push(this);
    }
  }

  Object.defineProperty(globalThis, 'AudioContext', {
    value: ScrubAudioContextMock,
    writable: true,
    configurable: true,
  });

  return {
    contexts,
    sources,
    restore: () => {
      Object.defineProperty(globalThis, 'AudioContext', {
        value: originalAudioContext,
        writable: true,
        configurable: true,
      });
    },
  };
}

describe('proxyFrameCache legacy image runtime reporting', () => {
  beforeEach(() => {
    resetProxyFrameCacheInternals();
  });

  afterEach(() => {
    resetProxyFrameCacheInternals();
    vi.restoreAllMocks();
  });

  it('reports retained JPEG proxy frames as one aggregate thumbnail resource per media file', () => {
    expect(cache.addToCache('media-1', 0, createMockImage(320, 180))).toBe(true);
    expect(cache.addToCache('media-1', 1, createMockImage(320, 180))).toBe(true);

    const resourceId = 'proxy-frame-cache:media-1:legacy-images';
    const stats = timelineRuntimeCoordinator.getBridgeStats();
    const resource = stats.policies.thumbnail.resources.find((entry) => entry.id === resourceId);

    expect(resource).toMatchObject({
      id: resourceId,
      kind: 'image-canvas',
      policyId: 'thumbnail',
      imageKind: 'html-image',
      owner: {
        ownerId: 'proxy-frame-cache:media-1',
        ownerType: 'timeline',
        mediaFileId: 'media-1',
      },
      dimensions: {
        width: 320,
        height: 180,
      },
      memoryCost: {
        heapBytes: 320 * 180 * 4 * 2,
      },
    });
    expect(resource?.tags).toEqual(expect.arrayContaining([
      'runtime-provider-demand',
      'background-cache',
      'proxy-frame-cache',
      'jpeg-proxy-frame',
    ]));
    expect(stats.policies.thumbnail.budgetReport.usage.resources).toBe(1);
    expect(stats.policies.thumbnail.budgetReport.usage.imageBitmaps).toBe(1);

    proxyFrameCache.clearForMedia('media-1');

    expect(timelineRuntimeCoordinator.getBridgeStats().policies.thumbnail.resources)
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ id: resourceId })]));
  });

  it('updates the aggregate resource when the oldest JPEG proxy frame is evicted', () => {
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1)
      .mockReturnValueOnce(2);

    expect(cache.addToCache('media-1', 0, createMockImage(10, 10))).toBe(true);
    expect(cache.addToCache('media-1', 1, createMockImage(20, 10))).toBe(true);

    cache.evictOldest();

    const resource = timelineRuntimeCoordinator.getBridgeStats()
      .policies.thumbnail.resources.find((entry) => entry.id === 'proxy-frame-cache:media-1:legacy-images');

    expect(cache.cache.has('media-1_0')).toBe(false);
    expect(cache.cache.has('media-1_1')).toBe(true);
    expect(resource).toMatchObject({
      memoryCost: {
        heapBytes: 20 * 10 * 4,
      },
      label: 'JPEG proxy frame cache (1 frames)',
    });
  });

  it('denies JPEG proxy frame retention before inserting into the cache when the thumbnail heap budget is full', () => {
    timelineRuntimeCoordinator.retainResource(createRetainedThumbnailResource(256 * 1024 * 1024));

    expect(cache.addToCache('denied-media', 0, createMockImage(1, 1))).toBe(false);

    expect(cache.cache.has('denied-media_0')).toBe(false);
    const resources = timelineRuntimeCoordinator.getBridgeStats().policies.thumbnail.resources;
    expect(resources).toHaveLength(1);
    expect(resources[0]).toMatchObject({ id: 'retained-thumbnail-budget' });
  });
});

describe('proxyFrameCache decoded audio buffer runtime reporting', () => {
  beforeEach(() => {
    resetProxyFrameCacheInternals();
  });

  afterEach(() => {
    resetProxyFrameCacheInternals();
    vi.restoreAllMocks();
  });

  it('reports retained decoded audio buffers and releases them on cache clear', () => {
    const buffer = createMockAudioBuffer(2);

    expect(cache.cacheDecodedAudioBuffer('media-audio', buffer)).toBe(true);

    const resourceId = 'proxy-frame-cache:media-audio:audio-buffer';
    const resource = timelineRuntimeCoordinator.getBridgeStats()
      .policies.interactive.resources.find((entry) => entry.id === resourceId);

    expect(resource).toMatchObject({
      id: resourceId,
      kind: 'audio-source-clock',
      policyId: 'interactive',
      audioSourceId: 'media-audio',
      owner: {
        ownerId: 'proxy-frame-cache:media-audio',
        ownerType: 'timeline',
        mediaFileId: 'media-audio',
      },
      dimensions: {
        durationSeconds: 2,
        sampleRate: 48_000,
        channelCount: 2,
      },
      memoryCost: {
        heapBytes: 2 * 48_000 * 2 * 4,
      },
    });
    expect(resource?.tags).toEqual(expect.arrayContaining([
      'runtime-provider-demand',
      'background-cache',
      'proxy-frame-cache',
      'decoded-audio-buffer',
    ]));

    proxyFrameCache.clearAudioBufferCache();

    expect(cache.audioBufferCache.has('media-audio')).toBe(false);
    expect(timelineRuntimeCoordinator.getBridgeStats().policies.interactive.resources)
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ id: resourceId })]));
  });

  it('releases decoded audio buffer resources when the cache evicts old entries', () => {
    for (let index = 0; index < MAX_AUDIO_BUFFER_CACHE_ENTRIES + 1; index += 1) {
      expect(cache.cacheDecodedAudioBuffer(`audio-${index}`, createMockAudioBuffer(1))).toBe(true);
    }

    const resources = timelineRuntimeCoordinator.getBridgeStats().policies.interactive.resources;

    expect(cache.audioBufferCache.has('audio-0')).toBe(false);
    expect(resources).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'proxy-frame-cache:audio-0:audio-buffer' }),
    ]));
    expect(resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'proxy-frame-cache:audio-1:audio-buffer' }),
      expect.objectContaining({ id: 'proxy-frame-cache:audio-2:audio-buffer' }),
      expect.objectContaining({
        id: `proxy-frame-cache:audio-${MAX_AUDIO_BUFFER_CACHE_ENTRIES}:audio-buffer`,
      }),
    ]));
  });

  it('denies decoded audio buffer cache retention before inserting when the interactive heap budget is full', () => {
    timelineRuntimeCoordinator.retainResource(
      createRetainedInteractiveAudioResource(getInteractivePolicyBudget().maxHeapBytes ?? 0)
    );

    expect(cache.cacheDecodedAudioBuffer('denied-audio', createMockAudioBuffer(1))).toBe(false);

    expect(cache.audioBufferCache.has('denied-audio')).toBe(false);
    const resources = timelineRuntimeCoordinator.getBridgeStats().policies.interactive.resources;
    expect(resources).toHaveLength(1);
    expect(resources[0]).toMatchObject({ id: 'retained-audio-budget' });
  });
});

describe('proxyFrameCache audio proxy element runtime reporting', () => {
  beforeEach(() => {
    resetProxyFrameCacheInternals();
  });

  afterEach(() => {
    resetProxyFrameCacheInternals();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('reports retained audio proxy elements and releases object URLs on proxy release', async () => {
    const audioElement = createMockAudioElement();
    const AudioMock = vi.fn(function AudioConstructor() {
      return audioElement;
    });
    vi.stubGlobal('Audio', AudioMock);
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:audio-proxy');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(projectFileService, 'getProxyAudio').mockResolvedValue(new Blob(['audio-proxy']));
    useMediaStore.setState({
      files: [{
        id: 'media-proxy',
        fileHash: 'media-proxy-hash',
        type: 'video',
        audioProxyStatus: 'ready',
        hasProxyAudio: true,
      }],
    });

    const loaded = await proxyFrameCache.getAudioProxy('media-proxy');

    expect(loaded).toBe(audioElement);
    expect(AudioMock).toHaveBeenCalledOnce();
    expect(createObjectURL).toHaveBeenCalledOnce();

    const resourceId = 'proxy-frame-cache:media-proxy:audio-proxy-element';
    const resource = timelineRuntimeCoordinator.getBridgeStats()
      .policies.interactive.resources.find((entry) => entry.id === resourceId);

    expect(resource).toMatchObject({
      id: resourceId,
      kind: 'html-media',
      policyId: 'interactive',
      mediaElementKind: 'audio',
      srcKind: 'blob-url',
      owner: {
        ownerId: 'proxy-frame-cache:media-proxy',
        ownerType: 'timeline',
        mediaFileId: 'media-proxy',
      },
      diagnostics: {
        status: 'ok',
        provider: {
          providerId: resourceId,
          providerKind: 'html-audio',
          status: 'ok',
          isReady: true,
        },
      },
    });
    expect(resource?.tags).toEqual(expect.arrayContaining([
      'runtime-provider-demand',
      'lease-visible',
      'proxy-frame-cache',
      'audio-proxy',
    ]));

    proxyFrameCache.releaseAudioProxy('media-proxy');

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:audio-proxy');
    expect(timelineRuntimeCoordinator.getBridgeStats().policies.interactive.resources)
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ id: resourceId })]));
  });

  it('revokes owned proxy URLs and skips Audio construction when html-media admission is denied', async () => {
    const maxHtmlMediaElements = getInteractivePolicyBudget().maxHtmlMediaElements ?? 0;
    for (let index = 0; index < maxHtmlMediaElements; index += 1) {
      timelineRuntimeCoordinator.retainResource(createRetainedInteractiveHtmlAudioResource(index));
    }
    const AudioMock = vi.fn(function AudioConstructor() {
      return createMockAudioElement();
    });
    vi.stubGlobal('Audio', AudioMock);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:denied-audio-proxy');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(projectFileService, 'getProxyAudio').mockResolvedValue(new Blob(['audio-proxy']));
    useMediaStore.setState({
      files: [{
        id: 'denied-media-proxy',
        fileHash: 'denied-media-proxy-hash',
        type: 'video',
        audioProxyStatus: 'ready',
        hasProxyAudio: true,
      }],
    });

    const loaded = await proxyFrameCache.getAudioProxy('denied-media-proxy');

    expect(loaded).toBeNull();
    expect(AudioMock).not.toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:denied-audio-proxy');
    expect(cache.audioCache.has('denied-media-proxy')).toBe(false);
    expect(timelineRuntimeCoordinator.getBridgeStats().policies.interactive.resources)
      .not.toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'proxy-frame-cache:denied-media-proxy:audio-proxy-element' }),
      ]));
  });
});

describe('proxyFrameCache WebCodecs VideoFrame runtime reporting', () => {
  beforeEach(() => {
    resetProxyFrameCacheInternals();
  });

  afterEach(() => {
    resetProxyFrameCacheInternals();
    vi.restoreAllMocks();
  });

  it('reports retained proxy VideoFrames as one aggregate provider resource per media file', () => {
    expect(cache.addVideoFrameToCache('video-media', 0, createMockVideoFrame(160, 90))).toBe(true);
    expect(cache.addVideoFrameToCache('video-media', 1, createMockVideoFrame(160, 90))).toBe(true);

    const resourceId = 'proxy-frame-cache:video-media:video-frames';
    const stats = timelineRuntimeCoordinator.getBridgeStats();
    const resource = stats.policies.interactive.resources.find((entry) => entry.id === resourceId);

    expect(resource).toMatchObject({
      id: resourceId,
      kind: 'video-frame-provider',
      policyId: 'interactive',
      providerId: resourceId,
      providerKind: 'webcodecs',
      frameFormat: 'video-frame',
      owner: {
        ownerId: 'proxy-frame-cache:video-media',
        ownerType: 'timeline',
        mediaFileId: 'video-media',
      },
      dimensions: {
        width: 160,
        height: 90,
      },
      memoryCost: {
        heapBytes: 160 * 90 * 4 * 2,
        decodedFrameBytes: 160 * 90 * 4 * 2,
      },
    });
    expect(resource?.tags).toEqual(expect.arrayContaining([
      'runtime-provider-demand',
      'background-cache',
      'proxy-frame-cache',
      'webcodecs-video-frame',
    ]));
    expect(stats.policies.interactive.budgetReport.usage.frameProviders).toBe(1);

    proxyFrameCache.clearForMedia('video-media');

    expect(timelineRuntimeCoordinator.getBridgeStats().policies.interactive.resources)
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ id: resourceId })]));
  });

  it('updates the aggregate provider resource and closes the oldest VideoFrame on eviction', () => {
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1)
      .mockReturnValueOnce(2);

    const firstFrame = createMockVideoFrame(10, 10);
    const secondFrame = createMockVideoFrame(20, 10);
    expect(cache.addVideoFrameToCache('video-media', 0, firstFrame)).toBe(true);
    expect(cache.addVideoFrameToCache('video-media', 1, secondFrame)).toBe(true);

    cache.evictOldestVideoFrame();

    const resource = timelineRuntimeCoordinator.getBridgeStats()
      .policies.interactive.resources.find((entry) => entry.id === 'proxy-frame-cache:video-media:video-frames');

    expect(firstFrame.close).toHaveBeenCalledTimes(1);
    expect(cache.videoFrameCache.has('video-media_0')).toBe(false);
    expect(cache.videoFrameCache.has('video-media_1')).toBe(true);
    expect(resource).toMatchObject({
      memoryCost: {
        heapBytes: 20 * 10 * 4,
        decodedFrameBytes: 20 * 10 * 4,
      },
      label: 'Proxy WebCodecs frame cache (1 frames)',
    });
  });

  it('denies proxy VideoFrame retention before inserting when the interactive heap budget is full', () => {
    timelineRuntimeCoordinator.retainResource(
      createRetainedInteractiveVideoProviderResource(getInteractivePolicyBudget().maxHeapBytes ?? 0)
    );
    const deniedFrame = createMockVideoFrame(1, 1);

    expect(cache.addVideoFrameToCache('denied-video', 0, deniedFrame)).toBe(false);

    expect(cache.videoFrameCache.has('denied-video_0')).toBe(false);
    expect(deniedFrame.close).toHaveBeenCalledTimes(1);
    const resources = timelineRuntimeCoordinator.getBridgeStats().policies.interactive.resources;
    expect(resources).toHaveLength(1);
    expect(resources[0]).toMatchObject({ id: 'retained-video-frame-budget' });
  });
});

describe('proxyFrameCache scrub preloading', () => {
  beforeEach(() => {
    resetProxyFrameCacheInternals();
  });

  afterEach(() => {
    resetProxyFrameCacheInternals();
    vi.restoreAllMocks();
  });

  it('drops stale queued preloads for the same media after a large scrub jump', () => {
    cache.preloadQueue = [
      'media_with_under_score_580',
      'media_with_under_score_581',
      'other-media_10',
    ];
    cache.lastScrubFrame = 600;
    cache.isScrubbing = true;
    cache.scrubDirection = 1;

    cache.schedulePreload('media_with_under_score', 120, 30);

    expect(cache.preloadQueue).not.toContain('media_with_under_score_580');
    expect(cache.preloadQueue).not.toContain('media_with_under_score_581');
    expect(cache.preloadQueue).toContain('other-media_10');
    expect(cache.preloadQueue[0]).toBe('media_with_under_score_120');
    expect(cache.scrubDirection).toBe(-1);
    expect(cache.isScrubbing).toBe(true);
    expect(proxyFrameCache.getStats().scrubPreloadQueueDrops).toBe(2);
  });

  it('keeps nearby queued preloads during continuous scrub movement', () => {
    cache.preloadQueue = ['media-1_95'];
    cache.lastScrubFrame = 100;
    cache.isScrubbing = true;
    cache.scrubDirection = 1;

    cache.schedulePreload('media-1', 104, 30);

    expect(cache.preloadQueue).toContain('media-1_95');
    expect(cache.scrubDirection).toBe(1);
    expect(proxyFrameCache.getStats().scrubPreloadQueueDrops).toBe(0);
  });

  it('stops scheduling granular scrub audio while the playhead is parked', () => {
    vi.useFakeTimers();
    const audioContextMock = installScrubAudioContextMock();
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);

    try {
      cache.audioBufferCache.set('media-1', createMockAudioBuffer());

      proxyFrameCache.playScrubAudio('media-1', 5);
      expect(audioContextMock.sources).toHaveLength(1);
      expect(audioContextMock.sources[0].start).toHaveBeenCalledWith(0, 5, 0.09);
      const scheduledCount = audioContextMock.sources.length;

      now += 40;
      vi.advanceTimersByTime(40);
      expect(audioContextMock.sources).toHaveLength(scheduledCount);

      now += 50;
      vi.advanceTimersByTime(50);
      expect(audioContextMock.sources).toHaveLength(scheduledCount);

      now += 40;
      proxyFrameCache.playScrubAudio('media-1', 5);
      expect(audioContextMock.sources).toHaveLength(scheduledCount);

      now += 20;
      audioContextMock.contexts[0].currentTime = 0.12;
      proxyFrameCache.playScrubAudio('media-1', 5.25);
      expect(audioContextMock.sources.length).toBeGreaterThan(scheduledCount);
      expect(audioContextMock.sources[scheduledCount].start).toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        0.09
      );
    } finally {
      audioContextMock.restore();
      vi.useRealTimers();
    }
  });

  it('uses reversed audio grains when scrub direction moves backward', () => {
    const audioContextMock = installScrubAudioContextMock();
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);

    try {
      const buffer = createMockAudioBuffer();
      cache.audioBufferCache.set('media-1', buffer);

      proxyFrameCache.playScrubAudio('media-1', 5);
      const initialSourceCount = audioContextMock.sources.length;

      now += 40;
      audioContextMock.contexts[0].currentTime = 0.04;
      proxyFrameCache.playScrubAudio('media-1', 4.5);

      expect(audioContextMock.sources.length).toBeGreaterThan(initialSourceCount);
      const reverseSource = audioContextMock.sources[initialSourceCount];
      expect(reverseSource.buffer).not.toBe(buffer);
      expect(reverseSource.buffer?.duration).toBeCloseTo(0.09, 3);
      expect(reverseSource.start).toHaveBeenCalledWith(
        expect.any(Number),
        0,
        expect.closeTo(0.09, 3)
      );
    } finally {
      audioContextMock.restore();
    }
  });

  it('keeps scrub grains pitch-stable during fast movement', () => {
    const audioContextMock = installScrubAudioContextMock();
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);

    try {
      cache.audioBufferCache.set('media-1', createMockAudioBuffer());

      proxyFrameCache.playScrubAudio('media-1', 2);
      const initialSourceCount = audioContextMock.sources.length;

      now += 20;
      audioContextMock.contexts[0].currentTime = 0.02;
      proxyFrameCache.playScrubAudio('media-1', 2.4);

      expect(audioContextMock.sources.length).toBeGreaterThan(initialSourceCount);
      for (const source of audioContextMock.sources) {
        expect(source.playbackRate.value).toBe(1);
      }
    } finally {
      audioContextMock.restore();
    }
  });

  it('fades out the previous scrub grain during fast jumps before scheduling the new position', () => {
    const audioContextMock = installScrubAudioContextMock();
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);

    try {
      cache.audioBufferCache.set('media-1', createMockAudioBuffer());

      proxyFrameCache.playScrubAudio('media-1', 1);
      const firstSource = audioContextMock.sources[0];

      now += 20;
      audioContextMock.contexts[0].currentTime = 0.02;
      proxyFrameCache.playScrubAudio('media-1', 2);

      expect(firstSource.stop).toHaveBeenCalledWith(expect.closeTo(0.032, 3));
      expect(audioContextMock.sources.length).toBeGreaterThan(1);
      expect(audioContextMock.sources[1].start).toHaveBeenCalledWith(
        0.02,
        expect.any(Number),
        0.09
      );
    } finally {
      audioContextMock.restore();
    }
  });
});
