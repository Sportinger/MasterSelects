import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('../../src/services/proxyFrameCache');

import { proxyFrameCache } from '../../src/services/proxyFrameCache';

type ProxyFrameCacheInternals = typeof proxyFrameCache & {
  cache: Map<string, unknown>;
  audioBufferCache: Map<string, AudioBuffer>;
  preloadQueue: string[];
  isPreloading: boolean;
  isScrubbing: boolean;
  lastScrubFrame: number;
  scrubDirection: number;
  scrubPreloadQueueDrops: number;
  scrubIsActive: boolean;
  schedulePreload(mediaFileId: string, currentFrameIndex: number, fps: number): void;
};

const cache = proxyFrameCache as ProxyFrameCacheInternals;

function resetProxyFrameCacheInternals(): void {
  cache.disposeAudioContext();
  cache.cache.clear();
  cache.audioBufferCache.clear();
  cache.preloadQueue = [];
  cache.isPreloading = true;
  cache.isScrubbing = false;
  cache.lastScrubFrame = -1;
  cache.scrubDirection = 0;
  cache.scrubPreloadQueueDrops = 0;
  cache.resetPerformanceCounters();
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
      expect(audioContextMock.sources.length).toBeGreaterThan(1);
      expect(audioContextMock.sources[0].start).toHaveBeenCalledWith(0, 5, 0.065);
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
        0.065
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
      expect(reverseSource.buffer?.duration).toBeCloseTo(0.065, 3);
      expect(reverseSource.start).toHaveBeenCalledWith(
        expect.any(Number),
        0,
        expect.closeTo(0.065, 3)
      );
    } finally {
      audioContextMock.restore();
    }
  });
});
