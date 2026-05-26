import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClipSpectrogram } from '../../src/components/timeline/components/ClipSpectrogram';
import type { TimelineSpectrogramTileSet } from '../../src/services/audio/timelineSpectrogramCache';

const originalRequestAnimationFrame = window.requestAnimationFrame;
const originalCancelAnimationFrame = window.cancelAnimationFrame;

function createTileSet(): TimelineSpectrogramTileSet {
  return {
    sampleRate: 48_000,
    duration: 2,
    fftSize: 1024,
    hopSize: 512,
    minDb: -96,
    maxDb: 0,
    frameCount: 8,
    frequencyBinCount: 4,
    channels: [{
      channelIndex: 0,
      values: new Float32Array(8 * 4).fill(0.25),
    }],
  };
}

describe('ClipSpectrogram', () => {
  let scheduledFrames: Map<number, FrameRequestCallback>;
  let nextFrameId: number;
  let putImageData: ReturnType<typeof vi.fn>;
  let getContextSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    scheduledFrames = new Map();
    nextFrameId = 1;
    putImageData = vi.fn();

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      const id = nextFrameId;
      nextFrameId += 1;
      scheduledFrames.set(id, callback);
      return id;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id: number) => {
      scheduledFrames.delete(id);
    });

    getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      createImageData: (width: number, height: number) => ({
        width,
        height,
        data: new Uint8ClampedArray(width * height * 4),
        colorSpace: 'srgb',
      }),
      putImageData,
      save: vi.fn(),
      restore: vi.fn(),
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      globalCompositeOperation: 'source-over',
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
    } as unknown as CanvasRenderingContext2D));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it('cancels stale scheduled draws during rapid zoom updates', () => {
    const tileSet = createTileSet();
    const { rerender } = render(
      <ClipSpectrogram
        tileSet={tileSet}
        width={800}
        height={80}
        inPoint={0}
        outPoint={2}
        naturalDuration={2}
        renderStartPx={0}
        renderWidth={300}
      />,
    );

    rerender(
      <ClipSpectrogram
        tileSet={tileSet}
        width={1600}
        height={80}
        inPoint={0}
        outPoint={2}
        naturalDuration={2}
        renderStartPx={200}
        renderWidth={300}
      />,
    );

    expect(window.cancelAnimationFrame).toHaveBeenCalledWith(1);
    expect(scheduledFrames.has(1)).toBe(false);
    expect(scheduledFrames.has(2)).toBe(true);

    const pending = Array.from(scheduledFrames.values());
    scheduledFrames.clear();
    pending.forEach((callback) => callback(0));

    expect(getContextSpy).toHaveBeenCalledTimes(1);
    expect(putImageData).toHaveBeenCalledTimes(1);
  });
});
