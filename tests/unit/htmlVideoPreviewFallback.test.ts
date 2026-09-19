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

  it('copies paused Android Chrome frames before WebGPU presentation', () => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        userAgent: 'Mozilla/5.0 (Linux; Android 16; Pixel 10 Pro) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36',
        userAgentData: { platform: 'Android' },
      },
    });

    const copiedFrame = {
      view: {} as GPUTextureView,
      width: 1920,
      height: 1080,
      mediaTime: 1.25,
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
      currentTime: 1.25,
      paused: true,
      seeking: false,
    } as HTMLVideoElement;

    expect(getCopiedHtmlVideoPreviewFrame(
      video,
      scrubbingCache as never,
      1.25,
      'clip-a',
      'clip-a',
    )).toBe(copiedFrame);
    expect(scrubbingCache.captureVideoFrame).toHaveBeenCalledWith(video, 'clip-a');
  });
});
