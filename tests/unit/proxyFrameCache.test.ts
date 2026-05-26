import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('../../src/services/proxyFrameCache');

import { proxyFrameCache } from '../../src/services/proxyFrameCache';

type ProxyFrameCacheInternals = typeof proxyFrameCache & {
  cache: Map<string, unknown>;
  preloadQueue: string[];
  isPreloading: boolean;
  isScrubbing: boolean;
  lastScrubFrame: number;
  scrubDirection: number;
  scrubPreloadQueueDrops: number;
  schedulePreload(mediaFileId: string, currentFrameIndex: number, fps: number): void;
};

const cache = proxyFrameCache as ProxyFrameCacheInternals;

function resetProxyFrameCacheInternals(): void {
  cache.cache.clear();
  cache.preloadQueue = [];
  cache.isPreloading = true;
  cache.isScrubbing = false;
  cache.lastScrubFrame = -1;
  cache.scrubDirection = 0;
  cache.scrubPreloadQueueDrops = 0;
  cache.resetPerformanceCounters();
}

describe('proxyFrameCache scrub preloading', () => {
  beforeEach(() => {
    resetProxyFrameCacheInternals();
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
});
