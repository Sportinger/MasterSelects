import { afterEach, describe, expect, it, vi } from 'vitest';
import { flockRuntime, type FlockRuntimeBackend } from '../../src/engine/flock/runtime/flockRuntimeApi';
import { buildFlockRuntimeStatus } from '../../src/engine/flock/runtime/flockRuntimeStatus';
import { WorkerFlockStatusMirror, type WorkerFlockStatusSnapshot } from '../../src/services/render/workerFlockStatus';

const status = (step: number) => ({ ...buildFlockRuntimeStatus({ clipId: 'particles', state: 'ready' }), step });
const snapshot = (): WorkerFlockStatusSnapshot => ({ compositionId: 'root', capabilities: {
  webgpu: true, gpuCompute: true, fallback: 'none', cpuFallbackMaxParticles: 0,
  maxStorageBufferBindingSize: 1024, maxBufferSize: 2048, maxStorageBuffersPerShaderStage: 8,
  maxComputeWorkgroupsPerDimension: 65535,
}, occurrences: [
  { occurrenceNamespace: 'root', compositionId: 'root', statuses: [status(120)] },
  { occurrenceNamespace: 'root/nested', compositionId: 'child', statuses: [status(30)] },
] });

afterEach(() => {
  flockRuntime.setStatusSource(null);
  flockRuntime.setBackend(null);
  flockRuntime.clearStatus('particles');
});

describe('Worker Flock status ownership', () => {
  it('keeps nested occurrences for diagnostics without replacing the active inspector clip', () => {
    const mirror = new WorkerFlockStatusMirror();
    mirror.accept(structuredClone(snapshot()));
    expect(mirror.statuses('root').map(s => s.step)).toEqual([120]);
    expect(mirror.diagnostics()?.occurrences[1].statuses[0].step).toBe(30);
    expect(mirror.statuses('child')).toEqual([]);
    expect(mirror.statuses(null)).toEqual([]);
  });

  it('drops removed clips on an empty frame or detached target', () => {
    const mirror = new WorkerFlockStatusMirror();
    mirror.accept(snapshot());
    mirror.accept({ ...snapshot(), occurrences: [] });
    expect(mirror.statuses('root')).toEqual([]);
    mirror.accept(snapshot());
    mirror.clear();
    expect(mirror.statuses('root')).toEqual([]);
    mirror.accept(snapshot());
    mirror.accept(undefined);
    expect(mirror.diagnostics()).toBeNull();
  });

  it('uses Worker status and capabilities only while that owner is selected', () => {
    const mirror = new WorkerFlockStatusMirror();
    mirror.accept(snapshot());
    flockRuntime.publishStatus(status(1));
    let selected = true;
    flockRuntime.setStatusSource(() => selected
      ? { statuses: mirror.statuses('root'), capabilities: mirror.diagnostics()!.capabilities } : null);
    expect(flockRuntime.getStatus('particles')?.step).toBe(120);
    expect(flockRuntime.listStatuses().map(s => s.step)).toEqual([120]);
    expect(flockRuntime.getCapabilities().maxBufferSize).toBe(2048);
    selected = false;
    expect(flockRuntime.getStatus('particles')?.step).toBe(1);
    expect(flockRuntime.listStatuses().map(s => s.step)).toEqual([1]);
  });

  it('never falls back to stale Main status while a Worker frame is missing', () => {
    flockRuntime.publishStatus(status(1));
    flockRuntime.setStatusSource(() => ({ statuses: [], capabilities: null }));
    expect(flockRuntime.getStatus('particles')).toBeNull();
    expect(flockRuntime.listStatuses()).toEqual([]);
  });

  it('does not send Worker cache, precompute, or sample requests to a dormant Main backend', async () => {
    const backend = {
      requestPrecompute: vi.fn().mockResolvedValue({ ok: true }), cancelPrecompute: vi.fn(),
      sampleParticles: vi.fn().mockResolvedValue(null), clearCache: vi.fn().mockResolvedValue(undefined),
      getCapabilities: vi.fn().mockReturnValue(snapshot().capabilities),
    } satisfies FlockRuntimeBackend;
    flockRuntime.setBackend(backend);
    flockRuntime.setStatusSource(() => ({ statuses: [], capabilities: snapshot().capabilities }));
    expect((await flockRuntime.requestPrecompute('particles', { start: 0, end: 2 })).ok).toBe(false);
    flockRuntime.cancelPrecompute('particles');
    expect(await flockRuntime.sampleParticles('particles')).toBeNull();
    await expect(flockRuntime.clearCache('particles')).rejects.toThrow('Worker');
    for (const callback of Object.values(backend)) expect(callback).not.toHaveBeenCalled();
    flockRuntime.setStatusSource(null);
    expect((await flockRuntime.requestPrecompute('particles', { start: 0, end: 2 })).ok).toBe(true);
    expect(backend.requestPrecompute).toHaveBeenCalledOnce();
  });
});
