import { act, cleanup, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const scopeMocks = vi.hoisted(() => ({
  renderWaveform: vi.fn(),
}));

vi.mock('../../src/stores/engineStore', () => ({
  useEngineStore: (selector: (state: { isEngineReady: boolean }) => unknown) => (
    selector({ isEngineReady: true })
  ),
}));

vi.mock('../../src/engine/analysis/ScopeRenderer', () => ({
  ScopeRenderer: class {
    destroy = vi.fn();
    renderHistogram = vi.fn();
    renderVectorscope = vi.fn();
    renderWaveform = scopeMocks.renderWaveform;
  },
}));

vi.mock('../../src/services/render/renderHostPort', () => ({
  renderHostPort: {
    getDevice: vi.fn(() => ({})),
    getLastRenderedTexture: vi.fn(() => ({ width: 1920, height: 1080 })),
    getRenderLoop: vi.fn(() => ({ getLastSuccessfulRenderTime: () => 42 })),
  },
}));

import { useGpuScope } from '../../src/components/panels/scopes/useScopeAnalysis';

function ScopeHarness() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useGpuScope(canvasRef, 'waveform', true);
  return <div><canvas ref={canvasRef} /></div>;
}

describe('useGpuScope resize refresh', () => {
  let resizeCallback: ResizeObserverCallback;
  let nextFrameId: number;
  let frameCallbacks: Map<number, FrameRequestCallback>;

  beforeEach(() => {
    vi.useFakeTimers();
    scopeMocks.renderWaveform.mockClear();
    nextFrameId = 0;
    frameCallbacks = new Map();

    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      const id = ++nextFrameId;
      frameCallbacks.set(id, callback);
      return id;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frameCallbacks.delete(id)));
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }
      disconnect() {}
      observe() {}
      unobserve() {}
    });

    Object.defineProperty(navigator, 'gpu', {
      configurable: true,
      value: { getPreferredCanvasFormat: () => 'rgba8unorm' },
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      configure: vi.fn(),
    } as unknown as RenderingContext);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const runNextFrame = async (time: number) => {
    const [id, callback] = frameCallbacks.entries().next().value as [number, FrameRequestCallback];
    frameCallbacks.delete(id);
    await act(async () => callback(time));
  };

  it('redraws a paused frame once after panel resizing settles', async () => {
    render(<ScopeHarness />);

    await runNextFrame(100);
    expect(scopeMocks.renderWaveform).toHaveBeenCalledTimes(1);

    act(() => {
      resizeCallback([{
        contentRect: { width: 600, height: 300 },
      } as unknown as ResizeObserverEntry], {} as ResizeObserver);
      vi.advanceTimersByTime(100);
    });
    await runNextFrame(200);
    expect(scopeMocks.renderWaveform).toHaveBeenCalledTimes(2);

    await runNextFrame(300);
    expect(scopeMocks.renderWaveform).toHaveBeenCalledTimes(2);
  });
});
