import { afterEach, describe, expect, it, vi } from 'vitest';

import { extractVideoFrame } from '../../src/services/clipAnalysis/frameExtractor';

describe('extractVideoFrame', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('accepts a decoded seek when Chromium omits the seeked event', async () => {
    vi.useFakeTimers();
    const video = new EventTarget() as HTMLVideoElement;
    let currentTime = 0;
    let seeking = false;
    Object.defineProperties(video, {
      currentTime: {
        configurable: true,
        get: () => currentTime,
        set: (value: number) => {
          currentTime = value;
          seeking = true;
          setTimeout(() => {
            seeking = false;
          }, 75);
        },
      },
      duration: { configurable: true, value: 30 },
      readyState: { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA },
      seeking: { configurable: true, get: () => seeking },
    });
    const imageData = { data: new Uint8ClampedArray(4), height: 1, width: 1 } as ImageData;
    const context = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => imageData),
    } as unknown as CanvasRenderingContext2D;
    const canvas = { height: 216, width: 360 } as HTMLCanvasElement;

    const extraction = extractVideoFrame(video, 15, canvas, context);
    await vi.advanceTimersByTimeAsync(100);

    await expect(extraction).resolves.toBe(imageData);
    expect(context.drawImage).toHaveBeenCalledWith(video, 0, 0, 360, 216);
  });
});
