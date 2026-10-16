import { describe, expect, it, vi } from 'vitest';
import {
  getDragHoldFrame,
  getPlaybackStallHoldFrame,
} from '../../src/engine/render/layerCollector/htmlVideoFrameCache';
import type { Layer } from '../../src/engine/core/types';
import type { LayerCollectorDeps } from '../../src/engine/render/LayerCollector';

const layer = { sourceClipId: 'clip-a' } as Layer;
const video = { src: 'blob:4k', videoWidth: 2160, videoHeight: 3840 } as HTMLVideoElement;
const liveView = { label: 'live' } as unknown as GPUTextureView;
const cachedView = { label: 'cached' } as unknown as GPUTextureView;

function deps(lastFrameTime: number, cachedTime: number | null): LayerCollectorDeps {
  return {
    scrubbingCache: {
      getLastFrame: vi.fn(() => ({ view: liveView, width: 1080, height: 1920, mediaTime: lastFrameTime })),
      getLastFrameOwner: vi.fn(() => 'clip-a'),
      getNearestCachedFrameEntry: vi.fn(() => cachedTime === null ? null : { view: cachedView, mediaTime: cachedTime }),
    },
  } as unknown as LayerCollectorDeps;
}

describe('HTML video hold frames', () => {
  it('holds the scrub-cache frame nearest the target instead of an older live capture', () => {
    // Last live capture 8.5 s, scrub cache already showed 9.2 s, target 9.667 s.
    const hold = getDragHoldFrame(layer, video, deps(8.5, 9.2), 9.667);
    expect(hold?.view).toBe(cachedView);
    expect(hold?.mediaTime).toBe(9.2);
    expect(hold?.width).toBe(2160);

    const stall = getPlaybackStallHoldFrame(layer, video, deps(7.24, 8.0), 8.067);
    expect(stall?.view).toBe(cachedView);
    expect(stall?.mediaTime).toBe(8.0);
  });

  it('keeps the live capture when it is nearer than any cached frame', () => {
    expect(getDragHoldFrame(layer, video, deps(9.6, 9.2), 9.667)?.view).toBe(liveView);
    expect(getPlaybackStallHoldFrame(layer, video, deps(8.0, null), 8.067)?.view).toBe(liveView);
    // Without a target the hold stays the plain last frame.
    expect(getDragHoldFrame(layer, video, deps(8.5, 9.2))?.view).toBe(liveView);
  });
});
