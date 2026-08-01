import { afterEach, describe, expect, it, vi } from 'vitest';

import { getCopiedHtmlVideoPreviewFrame } from '../../src/engine/render/htmlVideoPreviewFallback';

describe('getCopiedHtmlVideoPreviewFrame', () => {
  const originalNavigator = globalThis.navigator;

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: originalNavigator,
    });
  });

  it('forces a persistent frame copy on Chrome for nested seek recovery', () => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { userAgent: 'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36' },
    });

    const copiedFrame = {
      view: {} as GPUTextureView,
      width: 1920,
      height: 1080,
      mediaTime: 0.75,
    };
    const scrubbingCache = {
      getLastFrameNearTime: vi.fn()
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(copiedFrame),
      captureVideoFrame: vi.fn(() => true),
    };
    const video = {
      readyState: 4,
      videoWidth: 1920,
      videoHeight: 1080,
      currentTime: 0.75,
    } as HTMLVideoElement;

    expect(getCopiedHtmlVideoPreviewFrame(
      video,
      scrubbingCache as never,
      0.75,
      'clip-a',
      'clip-a',
      true,
    )).toBe(copiedFrame);
    expect(scrubbingCache.captureVideoFrame).toHaveBeenCalledWith(video, 'clip-a');
  });
});
