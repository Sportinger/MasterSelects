import { afterEach, describe, expect, it, vi } from 'vitest';

import { LayerCache } from '../../src/services/layerBuilder/LayerCache';
import type { FrameContext } from '../../src/services/layerBuilder/types';
import { getLazyImageElementForClip, getLazyImageStatusRevision, releaseAllLazyTimelineImageElements } from '../../src/services/timeline/lazyImageElements';
import type { Layer } from '../../src/types/layers';
import type { TimelineClip } from '../../src/types/timeline';

// Editor root fix found by the phone overlay journey: a photo added under a paused playhead stayed
// invisible until the next seek, because the layer cache was built while the image was still
// loading and nothing in the frame changed when it arrived. Image readiness now invalidates it.

class FakeImage {
  static created: FakeImage[] = [];
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  crossOrigin = '';
  src = '';
  constructor() { FakeImage.created.push(this); }
  removeAttribute(): void {}
}

const context = (clips: TimelineClip[]) => ({
  clips, tracks: [], frameNumber: 15, activeCompId: 'comp', isPlaying: false, playbackSpeed: 1, proxyEnabled: false,
  layerTransformPreview: null, now: 0, mediaFileById: new Map(), mediaFileByName: new Map(),
}) as unknown as FrameContext;

describe('layer cache and lazy images', () => {
  afterEach(() => {
    releaseAllLazyTimelineImageElements();
    vi.unstubAllGlobals();
    FakeImage.created = [];
  });

  it('rebuilds the cached layers once a lazy image finished loading', () => {
    vi.stubGlobal('Image', FakeImage);
    const clip = { id: 'photo', trackId: 'v2', name: 'photo.png', source: { type: 'image', imageUrl: 'blob:photo' } } as unknown as TimelineClip;
    const ctx = context([clip]);
    const cache = new LayerCache();

    expect(cache.checkCache(ctx).useCache).toBe(false);
    // The first build sees the image still loading and leaves it out.
    expect(getLazyImageElementForClip(ctx, clip)).toBeNull();
    cache.setCachedLayers([{ id: 'main' } as Layer]);
    expect(cache.checkCache(ctx).useCache).toBe(true);

    const revision = getLazyImageStatusRevision();
    expect(FakeImage.created).toHaveLength(1);
    FakeImage.created[0].onload?.();
    expect(getLazyImageStatusRevision()).toBe(revision + 1);
    expect(cache.checkCache(ctx).useCache, 'the image arrival invalidates the cached layer list').toBe(false);
    expect(getLazyImageElementForClip(ctx, clip)).toBe(FakeImage.created[0]);
  });

  it('a failed image also invalidates, so the frame stops waiting for it', () => {
    vi.stubGlobal('Image', FakeImage);
    const clip = { id: 'broken', trackId: 'v2', name: 'broken.png', source: { type: 'image', imageUrl: 'blob:broken' } } as unknown as TimelineClip;
    const ctx = context([clip]);
    const cache = new LayerCache();
    cache.checkCache(ctx);
    getLazyImageElementForClip(ctx, clip);
    cache.setCachedLayers([{ id: 'main' } as Layer]);
    expect(cache.checkCache(ctx).useCache).toBe(true);
    FakeImage.created[0].onerror?.();
    expect(cache.checkCache(ctx).useCache).toBe(false);
  });
});
