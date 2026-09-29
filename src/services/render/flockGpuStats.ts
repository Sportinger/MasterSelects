import type { FlockGpuTimingSnapshot } from '../../engine/flock/gpu/FlockGpuTimings';
import type { RenderHostTelemetry } from './renderHostTypes';
import type { WorkerFlockStatusSnapshot } from './workerFlockStatus';

/** Select the renderer that owns Flock, including an empty result before its first frame. */
export function collectFlockGpuStats(
  host: RenderHostTelemetry,
  compositionId: string | null,
  mainSnapshot: () => FlockGpuTimingSnapshot,
): FlockGpuTimingSnapshot & { source: 'worker' | 'main'; capturedAt: number | null } {
  if (host.selection.selectedRole === 'primary' && host.presentationStrategy === 'worker-webgpu-present') {
    const status = host.diagnostics?.flockStatus as WorkerFlockStatusSnapshot | null | undefined;
    const snapshot = status?.compositionId === compositionId ? status.gpuTimings : undefined;
    return { ...(snapshot ?? { supported: false, samples: {}, draws: [], capturedAt: null }), source: 'worker' };
  }
  return { ...mainSnapshot(), source: 'main', capturedAt: Date.now() };
}
