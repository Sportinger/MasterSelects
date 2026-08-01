import { describe, expect, it, vi } from 'vitest';
import {
  clearWorkerFirstCounterSourcesForTests,
  getWorkerFirstCounterSourceSnapshot,
} from '../../src/services/aiTools/workerFirstCounterSources';
import type { RenderHostPort } from '../../src/services/render/renderHostTypes';
import { createWorkerShadowRenderHostPort } from '../../src/services/render/workerShadowRenderHostPort';
import type { WorkerRenderHostRuntimeBridge } from '../../src/services/render/workerRenderHostRuntimeBridge';
import type { WorkerRenderHostRuntimeJobOutput } from '../../src/services/render/workerRenderHostRuntimeHandlers';

function createFallback(): RenderHostPort {
  return {
    getTelemetry: vi.fn(),
    initialize: vi.fn().mockResolvedValue(true),
    registerTargetCanvas: vi.fn(() => ({ label: 'context' }) as unknown as GPUCanvasContext),
    unregisterTargetCanvas: vi.fn(),
    renderToPreviewCanvas: vi.fn(),
    requestRender: vi.fn(),
    requestNewFrameRender: vi.fn(),
    render: vi.fn(),
  } as unknown as RenderHostPort;
}

function output(overrides: Partial<WorkerRenderHostRuntimeJobOutput> = {}): WorkerRenderHostRuntimeJobOutput {
  return {
    accepted: true,
    commandType: 'RenderNow',
    initialized: true,
    rendererId: 'worker-shadow-render-host',
    strategy: 'worker-cpu-present',
    targetIds: ['preview'],
    scheduler: {
      queueDepth: 0,
      byPriority: { critical: 0, high: 0, normal: 0, low: 0, idle: 0 },
      byType: {
        'live-playback': 0,
        scrub: 0,
        'independent-preview': 0,
        'ram-preview': 0,
        thumbnail: 0,
        'clip-bake': 0,
        'composition-bake': 0,
        export: 0,
      },
      oldestCommandAgeMs: 0,
      counters: {
        admitted: 1,
        enqueued: 1,
        started: 1,
        completed: 1,
        canceled: 0,
        coalesced: 0,
        dropped: 0,
        expired: 0,
        late: 0,
        staleResponses: 0,
        resizeCoalesced: 0,
        priorityInversions: 0,
      },
    },
    cache: {
      entries: 1,
      bytes: 0,
      bytesByOwner: {
        'source-frame': 0,
        'hold-frame': 0,
        'composite-frame': 0,
        'subcomp-output': 0,
        'mask-texture': 0,
        'effect-plan': 0,
        'target-surface': 0,
        'bake-artifact': 0,
        thumbnail: 0,
        'export-frame': 0,
      },
      counters: {
        allocations: 1,
        reuses: 1,
        evictions: 0,
        transfers: 0,
        releases: 0,
        leakChecks: 0,
      },
    },
    statusEvents: [],
    transferLatencyMs: 7,
    providerWaitMs: null,
    presentedFrameId: null,
    ...overrides,
  };
}

function createBridge() {
  return {
    initialize: vi.fn().mockResolvedValue(output({ commandType: 'initialize' })),
    registerTarget: vi.fn().mockResolvedValue(output({ commandType: 'registerTarget' })),
    renderNow: vi.fn().mockResolvedValue(output({ commandType: 'RenderNow' })),
    sendCommand: vi.fn().mockResolvedValue(output({ commandType: 'unregisterTarget' })),
    dispose: vi.fn(),
  } as unknown as WorkerRenderHostRuntimeBridge;
}

describe('worker shadow render host port', () => {
  beforeEach(() => {
    clearWorkerFirstCounterSourcesForTests();
  });

  afterEach(() => {
    clearWorkerFirstCounterSourcesForTests();
  });

  it('reports worker-shadow telemetry without claiming worker presentation', () => {
    const fallback = createFallback();
    const host = createWorkerShadowRenderHostPort({
      fallback,
      getSelectionTelemetry: () => ({
        selectedId: 'worker-primary',
        selectedRole: 'primary',
        workerPrimaryRequested: true,
        workerPrimaryRegistered: true,
        workerPrimaryAvailable: true,
        blockers: [],
        reason: 'using worker primary render host',
      }),
      createBridge,
    });

    expect(host.getTelemetry()).toMatchObject({
      mode: 'worker-shadow',
      presentationStrategy: 'worker-cpu-present',
      selection: {
        selectedId: 'worker-primary',
      },
    });
  });

  it('mirrors render wake commands to the worker runtime and delegates presentation to fallback', async () => {
    const fallback = createFallback();
    const bridge = createBridge();
    const host = createWorkerShadowRenderHostPort({
      fallback,
      getSelectionTelemetry: () => ({
        selectedId: 'worker-primary',
        selectedRole: 'primary',
        workerPrimaryRequested: true,
        workerPrimaryRegistered: true,
        workerPrimaryAvailable: true,
        blockers: [],
        reason: 'using worker primary render host',
      }),
      createBridge: () => bridge,
    });
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;

    await expect(host.initialize()).resolves.toBe(true);
    const context = host.registerTargetCanvas('preview', canvas);
    host.requestRender();
    host.renderToPreviewCanvas('preview', []);

    expect(context).toEqual({ label: 'context' });
    expect(fallback.initialize).toHaveBeenCalledTimes(1);
    expect(fallback.registerTargetCanvas).toHaveBeenCalledWith('preview', canvas);
    expect(fallback.requestRender).toHaveBeenCalledTimes(1);
    expect(fallback.renderToPreviewCanvas).toHaveBeenCalledWith('preview', [], undefined);
    await vi.waitFor(() => {
      expect(bridge.initialize).toHaveBeenCalledWith('worker-shadow-render-host', 'worker-cpu-present');
      expect(bridge.registerTarget).toHaveBeenCalledWith(expect.objectContaining({
        id: 'preview',
        size: { x: 640, y: 360 },
        presentation: 'main-canvas',
      }));
      expect(bridge.renderNow).toHaveBeenCalledWith(
        expect.stringContaining('worker-shadow:request-render'),
        'preview',
        0,
      );
      expect(bridge.renderNow).toHaveBeenCalledWith(
        expect.stringContaining('worker-shadow:render-to-preview-canvas'),
        'preview',
        0,
      );
    });
  });

  it('publishes worker runtime scheduler, cache, and timing counters for stats snapshots', async () => {
    const fallback = createFallback();
    const bridge = createBridge();
    const host = createWorkerShadowRenderHostPort({
      fallback,
      getSelectionTelemetry: () => ({
        selectedId: 'worker-primary',
        selectedRole: 'primary',
        workerPrimaryRequested: true,
        workerPrimaryRegistered: true,
        workerPrimaryAvailable: true,
        blockers: [],
        reason: 'using worker primary render host',
      }),
      createBridge: () => bridge,
    });

    host.requestRender();

    await vi.waitFor(() => {
      const counters = getWorkerFirstCounterSourceSnapshot();
      expect(counters.scheduler?.counters.completed).toBe(1);
      expect(counters.cache?.entries).toBe(1);
      expect(counters.transferLatencyMs).toBe(7);
      expect(counters.presentedFrameId).toBeNull();
      expect(counters.updatedAt).not.toBeNull();
    });
  });
});
