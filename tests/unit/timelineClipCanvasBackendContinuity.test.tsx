import { useEffect, useRef } from 'react';
import { act, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flags } from '../../src/engine/featureFlags';
import { useTimelineClipCanvasWorkerRuntime } from '../../src/components/timeline/hooks/useTimelineClipCanvasWorkerRuntime';

vi.mock('../../src/components/timeline/utils/timelineCanvasPlatform', () => ({
  prefersSoftwareTimelineCanvas: () => false,
}));
vi.mock('../../src/components/timeline/utils/timelineClipCanvasThumbnailResource', () => ({
  createTimelineClipCanvasWorkerThumbnailResourcesByClipId: () => undefined,
}));
vi.mock('../../src/components/timeline/utils/timelineClipCanvasWorkerModel', () => ({
  buildTimelineClipCanvasWorkerDrawMessage: ({ requestId }: { requestId: number }) => ({
    message: { type: 'draw', requestId, paintPayloads: { thumbnailStrips: [], compositionVisuals: [] } },
    transferables: [], inputClipCount: 1, visibleClipCount: 1,
  }),
}));

const originalFlag = flags.timelineCanvasWorker;
const originalTransfer = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'transferControlToOffscreen');
const sharedInput = {
  trackId: 'audio-track', height: 60, cssWidth: 800, canvasOffsetX: 0,
  timeToPixel: (time: number) => time * 10, selectedClipIds: new Set<string>(),
  trackColor: '#334455', selectionBorderColor: '#abcdef', waveformsEnabled: true,
  workerPaintClips: [], workerThumbnailPreparation: { plansByClipId: new Map(), handledClipIds: new Set<string>() },
  passiveDecorationClipIds: new Set<string>(), hasPassiveDecorations: false, hasClipTrim: false,
};

function LoadingTrack({ ready }: { ready: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const runtime = useTimelineClipCanvasWorkerRuntime({ ...sharedInput, canvasRef,
    workerEligibility: { eligible: ready, reasons: ready ? [] : ['waveform-pending'] },
  });
  useEffect(() => {
    if (!runtime.workerMode && canvasRef.current?.getContext('2d')) {
      runtime.markMainThreadCanvasContextInitialized();
    }
  }, [runtime.workerMode, runtime.markMainThreadCanvasContextInitialized]);
  return <canvas ref={canvasRef} key={runtime.workerCanvasGeneration} data-worker={runtime.workerMode} />;
}

describe('timeline canvas backend continuity', () => {
  beforeEach(() => {
    flags.timelineCanvasWorker = true;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D);
    Object.defineProperty(HTMLCanvasElement.prototype, 'transferControlToOffscreen', {
      configurable: true, value: vi.fn(() => ({})),
    });
    vi.stubGlobal('Worker', vi.fn(function () {
      return { postMessage: vi.fn(), terminate: vi.fn() };
    }));
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });
  afterEach(() => {
    flags.timelineCanvasWorker = originalFlag;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (originalTransfer) Object.defineProperty(HTMLCanvasElement.prototype, 'transferControlToOffscreen', originalTransfer);
    else delete (HTMLCanvasElement.prototype as Partial<HTMLCanvasElement>).transferControlToOffscreen;
  });

  it('retains the painted canvas when the final waveform arrives and eligibility changes again', () => {
    const { container, rerender } = render(<LoadingTrack ready={false} />);
    const canvas = container.querySelector('canvas');
    rerender(<LoadingTrack ready />);
    expect(container.querySelector('canvas')).toBe(canvas);
    expect(canvas).toHaveAttribute('data-worker', 'false');
    expect(Worker).not.toHaveBeenCalled();
    expect(HTMLCanvasElement.prototype.transferControlToOffscreen).not.toHaveBeenCalled();
    rerender(<LoadingTrack ready={false} />);
    rerender(<LoadingTrack ready />);
    expect(container.querySelector('canvas')).toBe(canvas);
    expect(Worker).not.toHaveBeenCalled();
  });

  it('starts a worker for an initially eligible canvas and retains software fallback after failure', () => {
    const canvasRef = { current: document.createElement('canvas') };
    const { result, rerender } = renderHook(({ eligible }) => useTimelineClipCanvasWorkerRuntime({
      ...sharedInput, canvasRef, workerEligibility: { eligible, reasons: eligible ? [] : ['waveform-pending'] },
    }), { initialProps: { eligible: true } });
    expect(result.current.workerMode).toBe(true);
    expect(Worker).toHaveBeenCalledTimes(1);
    const worker = vi.mocked(Worker).mock.results[0].value as Worker;
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'init', canvas: expect.any(Object) }, [expect.any(Object)]);
    act(() => worker.onmessageerror?.({ data: null } as MessageEvent));
    expect(result.current.workerMode).toBe(false);
    expect(result.current.workerCanvasGeneration).toBe(1);
    act(() => result.current.markMainThreadCanvasContextInitialized());
    rerender({ eligible: false });
    rerender({ eligible: true });
    expect(result.current.workerMode).toBe(false);
    expect(result.current.workerCanvasGeneration).toBe(1);
    expect(Worker).toHaveBeenCalledTimes(1);
  });
});
