import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClipWaveform } from '../../src/components/timeline/components/ClipWaveform';
import type { TimelineWaveformPyramid } from '../../src/components/timeline/utils/waveformLod';

const originalRequestAnimationFrame = window.requestAnimationFrame;
const originalCancelAnimationFrame = window.cancelAnimationFrame;

describe('ClipWaveform', () => {
  let scheduledFrames: Map<number, FrameRequestCallback>;
  let nextFrameId: number;
  let getContextSpy: ReturnType<typeof vi.spyOn>;
  let canvasContext: CanvasRenderingContext2D & {
    translate: ReturnType<typeof vi.fn>;
    fillText: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    scheduledFrames = new Map();
    nextFrameId = 1;

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      const id = nextFrameId;
      nextFrameId += 1;
      scheduledFrames.set(id, callback);
      return id;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id: number) => {
      scheduledFrames.delete(id);
    });

    canvasContext = {
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      fillText: vi.fn(),
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      font: '',
    } as unknown as typeof canvasContext;
    getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => canvasContext);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it('cancels stale scheduled draws during rapid zoom updates', () => {
    const waveform = [0, 0.15, 0.75, 0.2, 0.9, 0.1];
    const { rerender } = render(
      <ClipWaveform
        waveform={waveform}
        width={800}
        height={80}
        inPoint={0}
        outPoint={2}
        naturalDuration={2}
        displayMode="compact"
        pixelsPerSecond={400}
        renderStartPx={0}
        renderWidth={300}
      />,
    );

    rerender(
      <ClipWaveform
        waveform={waveform}
        width={1600}
        height={80}
        inPoint={0}
        outPoint={2}
        naturalDuration={2}
        displayMode="compact"
        pixelsPerSecond={800}
        renderStartPx={200}
        renderWidth={300}
      />,
    );

    expect(window.cancelAnimationFrame).toHaveBeenCalledWith(1);
    expect(scheduledFrames.has(1)).toBe(false);
    expect(scheduledFrames.has(2)).toBe(true);

    const pending = Array.from(scheduledFrames.values());
    scheduledFrames.clear();
    act(() => {
      pending.forEach((callback) => callback(0));
    });

    expect(getContextSpy).toHaveBeenCalledTimes(1);
  });

  it('renders stereo pyramid channels as separate waveform lanes', () => {
    const createChannel = (channelIndex: number, values: number[]) => ({
      channelIndex,
      min: values.map(value => -value),
      max: values,
      rms: values.map(value => value * 0.5),
      peak: values,
    });
    const pyramid: TimelineWaveformPyramid = {
      sampleRate: 48_000,
      duration: 2,
      levels: [{
        samplesPerBucket: 128,
        bucketDuration: 128 / 48_000,
        bucketCount: 4,
        channels: [
          createChannel(0, [0.1, 0.2, 0.3, 0.2]),
          createChannel(1, [0.4, 0.6, 0.5, 0.3]),
        ],
      }],
    };

    const { container } = render(
      <ClipWaveform
        waveform={[]}
        pyramid={pyramid}
        width={640}
        height={80}
        inPoint={0}
        outPoint={2}
        naturalDuration={2}
        displayMode="detailed"
        pixelsPerSecond={320}
      />,
    );

    const canvas = container.querySelector('canvas');
    expect(canvas).toHaveAttribute('data-waveform-channels', '2');
    expect(canvas).toHaveClass('waveform-canvas-multichannel');

    const pending = Array.from(scheduledFrames.values());
    scheduledFrames.clear();
    act(() => {
      pending.forEach((callback) => callback(0));
    });

    expect(canvasContext.translate).toHaveBeenCalledWith(0, 0);
    expect(canvasContext.translate).toHaveBeenCalledWith(0, 41);
    expect(canvasContext.fillText).toHaveBeenCalledWith('L', 5, 11);
    expect(canvasContext.fillText).toHaveBeenCalledWith('R', 5, 52);
  });
});
