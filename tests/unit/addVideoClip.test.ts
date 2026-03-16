import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/engine/WebGPUEngine', () => ({
  engine: {
    preCacheVideoFrame: vi.fn(),
  },
}));

import { engine } from '../../src/engine/WebGPUEngine';
import { primeImportedVideoFrame } from '../../src/stores/timeline/clip/addVideoClip';

describe('primeImportedVideoFrame', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pre-caches immediately when the video already has frame data', () => {
    const video = {
      readyState: 2,
      preload: 'metadata',
      addEventListener: vi.fn(),
    } as unknown as HTMLVideoElement;

    primeImportedVideoFrame(video, 'clip-ready');

    expect(video.preload).toBe('auto');
    expect(engine.preCacheVideoFrame).toHaveBeenCalledWith(video, 'clip-ready');
    expect(video.addEventListener).not.toHaveBeenCalled();
  });

  it('waits for loadeddata before pre-caching when the video is still metadata-only', () => {
    let onLoadedData: (() => void) | undefined;
    const video = {
      readyState: 1,
      preload: 'metadata',
      addEventListener: vi.fn((event: string, listener: () => void) => {
        if (event === 'loadeddata') {
          onLoadedData = listener;
        }
      }),
    } as unknown as HTMLVideoElement;

    primeImportedVideoFrame(video, 'clip-pending');

    expect(video.preload).toBe('auto');
    expect(engine.preCacheVideoFrame).not.toHaveBeenCalled();
    expect(video.addEventListener).toHaveBeenCalledWith('loadeddata', expect.any(Function), { once: true });

    onLoadedData?.();

    expect(engine.preCacheVideoFrame).toHaveBeenCalledWith(video, 'clip-pending');
  });
});
