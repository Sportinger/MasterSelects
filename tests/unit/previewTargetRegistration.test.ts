import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RenderSource } from '../../src/types/renderTarget';

const mocks = vi.hoisted(() => {
  const gpuContext = { label: 'gpu-context' };
  const renderTargetState = {
    registerTarget: vi.fn(),
    unregisterTarget: vi.fn(),
    setTargetTransparencyGrid: vi.fn(),
  };
  const timelineState = { isPlaying: false };
  const renderHostPort = {
    registerTargetCanvas: vi.fn(() => gpuContext),
    unregisterTargetCanvas: vi.fn(),
    clearVideoCache: vi.fn(),
    clearScrubbingCache: vi.fn(),
    clearCompositeCache: vi.fn(),
    requestRender: vi.fn(),
  };
  const renderScheduler = {
    register: vi.fn(),
    unregister: vi.fn(),
  };

  return {
    gpuContext,
    renderHostPort,
    renderScheduler,
    renderTargetState,
    timelineState,
    useRenderTargetStore: { getState: vi.fn(() => renderTargetState) },
    useTimelineStore: { getState: vi.fn(() => timelineState) },
  };
});

vi.mock('../../src/services/render/renderHostPort', () => ({ renderHostPort: mocks.renderHostPort }));
vi.mock('../../src/services/renderScheduler', () => ({ renderScheduler: mocks.renderScheduler }));
vi.mock('../../src/stores/renderTargetStore', () => ({ useRenderTargetStore: mocks.useRenderTargetStore }));
vi.mock('../../src/stores/timeline', () => ({ useTimelineStore: mocks.useTimelineStore }));

import {
  registerPreviewTarget,
  setPreviewTargetTransparency,
  unregisterPreviewTarget,
} from '../../src/services/render/previewTargetRegistration';

type MockFn = ReturnType<typeof vi.fn>;

function firstCallOrder(fn: MockFn): number {
  const order = fn.mock.invocationCallOrder[0];
  expect(order).toBeDefined();
  return order ?? 0;
}

function expectOrdered(...fns: MockFn[]): void {
  for (let index = 1; index < fns.length; index += 1) {
    expect(firstCallOrder(fns[index - 1])).toBeLessThan(firstCallOrder(fns[index]));
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.timelineState.isPlaying = false;
  mocks.renderHostPort.registerTargetCanvas.mockReturnValue(mocks.gpuContext);
});

describe('preview target registration', () => {
  it('registers an independent preview target with the Preview.tsx operation order', () => {
    const canvas = { label: 'canvas' } as unknown as HTMLCanvasElement;
    const source: RenderSource = { type: 'composition', compositionId: 'comp-a' };
    const onIndependentRegistered = vi.fn();
    mocks.timelineState.isPlaying = true;

    const registered = registerPreviewTarget({
      id: 'preview-a',
      name: 'Preview',
      source,
      showTransparencyGrid: true,
      canvas,
      onIndependentRegistered,
    });

    expect(registered).toBe(true);
    expect(mocks.renderHostPort.registerTargetCanvas).toHaveBeenCalledWith('preview-a', canvas);
    expect(mocks.renderTargetState.registerTarget).toHaveBeenCalledWith({
      id: 'preview-a',
      name: 'Preview',
      source,
      destinationType: 'canvas',
      enabled: true,
      showTransparencyGrid: true,
      canvas,
      context: mocks.gpuContext,
      window: null,
      isFullscreen: false,
    });
    expect(mocks.renderScheduler.register).toHaveBeenCalledWith('preview-a');
    expect(onIndependentRegistered).toHaveBeenCalledTimes(1);
    expectOrdered(
      mocks.renderHostPort.registerTargetCanvas,
      mocks.renderTargetState.registerTarget,
      mocks.renderHostPort.clearVideoCache,
      mocks.renderHostPort.clearScrubbingCache,
      mocks.renderHostPort.clearCompositeCache,
      mocks.renderHostPort.requestRender,
      mocks.renderScheduler.register,
      onIndependentRegistered,
    );
  });

  it('keeps active-comp registration out of the independent scheduler', () => {
    const canvas = { label: 'canvas' } as unknown as HTMLCanvasElement;
    const source: RenderSource = { type: 'activeComp' };
    const onIndependentRegistered = vi.fn();

    const registered = registerPreviewTarget({
      id: 'preview-active',
      name: 'Preview',
      source,
      showTransparencyGrid: false,
      canvas,
      onIndependentRegistered,
    });

    expect(registered).toBe(true);
    expect(mocks.renderTargetState.registerTarget).toHaveBeenCalledWith(expect.objectContaining({
      id: 'preview-active',
      source,
      showTransparencyGrid: false,
    }));
    expect(mocks.renderScheduler.register).not.toHaveBeenCalled();
    expect(onIndependentRegistered).not.toHaveBeenCalled();
    expect(mocks.renderHostPort.clearVideoCache).not.toHaveBeenCalled();
    expect(mocks.renderHostPort.requestRender).not.toHaveBeenCalled();
  });

  it('preserves the early return when engine canvas registration fails', () => {
    const canvas = { label: 'canvas' } as unknown as HTMLCanvasElement;
    const source: RenderSource = { type: 'composition', compositionId: 'comp-a' };
    mocks.renderHostPort.registerTargetCanvas.mockReturnValueOnce(null);

    const registered = registerPreviewTarget({
      id: 'preview-a',
      name: 'Preview',
      source,
      showTransparencyGrid: true,
      canvas,
    });

    expect(registered).toBe(false);
    expect(mocks.renderTargetState.registerTarget).not.toHaveBeenCalled();
    expect(mocks.useTimelineStore.getState).not.toHaveBeenCalled();
    expect(mocks.renderScheduler.register).not.toHaveBeenCalled();
  });

  it('unregisters an independent preview target in scheduler-store-engine order', () => {
    const source: RenderSource = { type: 'composition', compositionId: 'comp-a' };

    unregisterPreviewTarget('preview-a', source);

    expect(mocks.renderScheduler.unregister).toHaveBeenCalledWith('preview-a');
    expect(mocks.renderTargetState.unregisterTarget).toHaveBeenCalledWith('preview-a');
    expect(mocks.renderHostPort.unregisterTargetCanvas).toHaveBeenCalledWith('preview-a');
    expectOrdered(
      mocks.renderScheduler.unregister,
      mocks.renderTargetState.unregisterTarget,
      mocks.renderHostPort.unregisterTargetCanvas,
    );
  });

  it('updates transparency through the store before requesting a render', () => {
    setPreviewTargetTransparency('preview-a', true);

    expect(mocks.renderTargetState.setTargetTransparencyGrid).toHaveBeenCalledWith('preview-a', true);
    expect(mocks.renderHostPort.clearVideoCache).not.toHaveBeenCalled();
    expect(mocks.renderHostPort.clearScrubbingCache).not.toHaveBeenCalled();
    expect(mocks.renderHostPort.clearCompositeCache).not.toHaveBeenCalled();
    expect(mocks.renderHostPort.requestRender).toHaveBeenCalledTimes(1);
    expectOrdered(
      mocks.renderTargetState.setTargetTransparencyGrid,
      mocks.renderHostPort.requestRender,
    );
  });
});
