import { describe, expect, it, vi } from 'vitest';
import { collectFlockGpuStats } from '../../src/services/render/flockGpuStats';
import type { RenderHostTelemetry } from '../../src/services/render/renderHostTypes';
import type { WorkerFlockStatusSnapshot } from '../../src/services/render/workerFlockStatus';

const status: WorkerFlockStatusSnapshot = {
  compositionId: 'scene', capabilities: null, occurrences: [],
  gpuTimings: { supported: true, capturedAt: 200, draws: [], samples: {
    'simulation:fluid': { sequence: 12, updatedAt: 180, milliseconds: { p2g: 1.4 }, passes: { p2g: 2 }, truncated: false },
  } },
};
const host = (snapshot: WorkerFlockStatusSnapshot | null = status): RenderHostTelemetry => ({
  mode: 'worker-gpu-only', presentationStrategy: 'worker-webgpu-present', lifecycleOwner: 'renderHostPort',
  statsOwner: 'renderHostPort', watchdogOwner: 'renderHostPort',
  selection: { selectedId: 'worker-primary', selectedRole: 'primary', workerPrimaryRequested: true,
    workerPrimaryRegistered: true, workerPrimaryAvailable: true, blockers: [], reason: 'worker' },
  diagnostics: { flockStatus: snapshot },
});

describe('Flock GPU stats owner', () => {
  it('returns transported Worker measurements and their actual sample age', () => {
    const main = vi.fn();
    const result = collectFlockGpuStats(host(structuredClone(status)), 'scene', main);
    expect(result).toEqual({ ...status.gpuTimings, source: 'worker' });
    expect(result.samples['simulation:fluid'].updatedAt).toBeLessThan(result.capturedAt!);
    expect(main).not.toHaveBeenCalled();
  });

  it.each([null, { ...status, compositionId: 'previous' }, { ...status, gpuTimings: undefined }])(
    'never substitutes dormant Main measurements for unavailable Worker measurements', (snapshot) => {
      const main = vi.fn();
      expect(collectFlockGpuStats(host(snapshot), 'scene', main)).toEqual({
        source: 'worker', supported: false, samples: {}, draws: [], capturedAt: null,
      });
      expect(main).not.toHaveBeenCalled();
    },
  );

  it('uses Main measurements when Main owns the scene', () => {
    const main = vi.fn(() => ({ supported: false, samples: {}, draws: [] }));
    const fallback = host();
    expect(collectFlockGpuStats({ ...fallback,
      selection: { ...fallback.selection, selectedRole: 'fallback', selectedId: 'main-fallback' },
    }, 'scene', main).source).toBe('main');
    expect(main).toHaveBeenCalledOnce();
  });
});
