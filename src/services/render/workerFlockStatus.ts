import type { FlockHostCapabilities, FlockRuntimeStatus } from '../../engine/flock/runtime/flockRuntimeApi';
import type { FlockGpuTimingSnapshot } from '../../engine/flock/gpu/FlockGpuTimings';

/** Value-only diagnostics for every scene occurrence in one presented frame. */
export interface WorkerFlockStatusSnapshot {
  readonly compositionId: string;
  readonly capabilities: FlockHostCapabilities | null;
  readonly gpuTimings?: FlockGpuTimingSnapshot & { capturedAt: number };
  readonly occurrences: readonly {
    readonly occurrenceNamespace: string;
    readonly compositionId: string;
    readonly statuses: readonly FlockRuntimeStatus[];
  }[];
}

/** The inspector addresses clips in the active composition, not nested occurrences. */
export class WorkerFlockStatusMirror {
  private snapshot: WorkerFlockStatusSnapshot | null = null;

  accept(snapshot: WorkerFlockStatusSnapshot | undefined): void {
    this.snapshot = snapshot ?? null;
  }

  clear(): void { this.snapshot = null; }

  statuses(compositionId: string | null): FlockRuntimeStatus[] {
    if (!this.snapshot || this.snapshot.compositionId !== compositionId) return [];
    // Root is first; nested copies of the same composition must not overwrite it.
    return [...(this.snapshot.occurrences[0]?.statuses ?? [])];
  }

  diagnostics(): WorkerFlockStatusSnapshot | null { return this.snapshot; }
}
