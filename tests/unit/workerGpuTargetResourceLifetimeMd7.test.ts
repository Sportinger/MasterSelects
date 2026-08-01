import { afterEach, describe, expect, it, vi } from 'vitest';

const resourceMocks = vi.hoisted(() => ({
  releaseCompositor: vi.fn(),
  releaseLayerPresenter: vi.fn(),
  createSurface: vi.fn(),
}));

vi.mock('../../src/services/render/workerGpuVideoFrameCompositor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/render/workerGpuVideoFrameCompositor')>()),
  releaseWorkerGpuVideoFrameCompositorResources: resourceMocks.releaseCompositor,
}));

vi.mock('../../src/services/render/workerGpuVideoFrameLayerPresenter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/render/workerGpuVideoFrameLayerPresenter')>()),
  releaseWorkerGpuVideoFrameLayerPresenterResources: resourceMocks.releaseLayerPresenter,
}));

vi.mock('../../src/services/render/workerGpuTargetSurface', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/render/workerGpuTargetSurface')>()),
  createWorkerGpuTargetSurface: resourceMocks.createSurface,
}));

import {
  workerRenderHostRuntimeHandler,
  type WorkerRenderHostRuntimeJobInput,
} from '../../src/services/render/workerRenderHostRuntimeHandlers';

function context() {
  return {
    signal: new AbortController().signal,
    log: vi.fn(),
    progress: vi.fn(),
    diagnostic: vi.fn(),
  } as unknown as Parameters<typeof workerRenderHostRuntimeHandler>[1];
}

async function send(command: WorkerRenderHostRuntimeJobInput['command']) {
  return workerRenderHostRuntimeHandler({ command, sentAtMs: 1, nowMs: 2 }, context());
}

describe('MD7 Worker GPU target resource lifetime', () => {
  afterEach(async () => {
    await send({ type: 'dispose', reason: 'test cleanup' });
    vi.clearAllMocks();
  });

  it('releases compositor and layer-presenter GPU resources before target detach', async () => {
    const canvas = { width: 320, height: 180 } as OffscreenCanvas;
    resourceMocks.createSurface.mockResolvedValue({
      ok: true,
      surface: {
        kind: 'worker-gpu-target-surface',
        canvas,
        context: {},
        adapter: null,
        device: {},
        format: 'rgba8unorm',
        alphaMode: 'premultiplied',
        colorSpace: 'srgb',
        deviceDiagnostics: null,
        diagnostics: {},
        frameSequence: 0,
      },
      diagnostics: { status: 'ready', error: null },
    });

    await send({
      type: 'initialize',
      rendererId: 'md7-resource-lifetime',
      strategy: 'worker-webgpu-present',
    });
    await send({
      type: 'attachTargetSurface',
      surface: {
        targetId: 'preview',
        canvas,
        presentation: 'main-canvas',
      },
    });
    await send({ type: 'detachTargetSurface', targetId: 'preview' });

    expect(resourceMocks.releaseCompositor).toHaveBeenCalledOnce();
    expect(resourceMocks.releaseLayerPresenter).toHaveBeenCalledOnce();
    expect(resourceMocks.releaseCompositor.mock.calls[0]?.[0]).toMatchObject({
      kind: 'worker-gpu-target-surface',
      canvas,
    });
    expect(resourceMocks.releaseLayerPresenter.mock.calls[0]?.[0])
      .toBe(resourceMocks.releaseCompositor.mock.calls[0]?.[0]);
  });

  it('releases attached GPU target resources during runtime disposal', async () => {
    const canvas = { width: 640, height: 360 } as OffscreenCanvas;
    resourceMocks.createSurface.mockResolvedValue({
      ok: true,
      surface: {
        kind: 'worker-gpu-target-surface',
        canvas,
        context: {},
        adapter: null,
        device: {},
        format: 'rgba8unorm',
        alphaMode: 'premultiplied',
        colorSpace: 'srgb',
        deviceDiagnostics: null,
        diagnostics: {},
        frameSequence: 0,
      },
      diagnostics: { status: 'ready', error: null },
    });

    await send({
      type: 'initialize',
      rendererId: 'md7-resource-dispose',
      strategy: 'worker-webgpu-present',
    });
    await send({
      type: 'attachTargetSurface',
      surface: {
        targetId: 'preview',
        canvas,
        presentation: 'main-canvas',
      },
    });
    await send({ type: 'dispose', reason: 'runtime disposal' });

    expect(resourceMocks.releaseCompositor).toHaveBeenCalledOnce();
    expect(resourceMocks.releaseLayerPresenter).toHaveBeenCalledOnce();
  });

  it('releases the previous GPU target before replacing the same target id', async () => {
    const firstCanvas = { width: 320, height: 180 } as OffscreenCanvas;
    const secondCanvas = { width: 1280, height: 720 } as OffscreenCanvas;
    const surface = (canvas: OffscreenCanvas) => ({
      kind: 'worker-gpu-target-surface' as const,
      canvas,
      context: {} as GPUCanvasContext,
      adapter: null,
      device: {} as GPUDevice,
      format: 'rgba8unorm' as GPUTextureFormat,
      alphaMode: 'premultiplied' as GPUCanvasAlphaMode,
      colorSpace: 'srgb' as PredefinedColorSpace,
      deviceDiagnostics: null,
      diagnostics: {},
      frameSequence: 0,
    });
    resourceMocks.createSurface
      .mockResolvedValueOnce({
        ok: true,
        surface: surface(firstCanvas),
        diagnostics: { status: 'ready', error: null },
      })
      .mockResolvedValueOnce({
        ok: true,
        surface: surface(secondCanvas),
        diagnostics: { status: 'ready', error: null },
      });

    await send({
      type: 'initialize',
      rendererId: 'md7-resource-replace',
      strategy: 'worker-webgpu-present',
    });
    await send({
      type: 'attachTargetSurface',
      surface: { targetId: 'preview', canvas: firstCanvas, presentation: 'main-canvas' },
    });
    await send({
      type: 'attachTargetSurface',
      surface: { targetId: 'preview', canvas: secondCanvas, presentation: 'main-canvas' },
    });

    expect(resourceMocks.releaseCompositor).toHaveBeenCalledOnce();
    expect(resourceMocks.releaseLayerPresenter).toHaveBeenCalledOnce();
    expect(resourceMocks.releaseCompositor.mock.calls[0]?.[0]).toMatchObject({
      canvas: firstCanvas,
    });
  });
});
