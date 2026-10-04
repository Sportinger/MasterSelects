import type { PtStatus } from '../../engine/native3d/pathtrace/contracts/ptTypes';

/**
 * Path tracer state a worker frame reports back to the main thread: its status for the preview
 * toolbar, and whether the worker's path tracer wants another frame (a still image still
 * converging, a denoise that finished). Plain data, structured-clone safe.
 */
export interface WorkerPathTraceReport {
  readonly status: PtStatus | null;
  readonly needsFrame: boolean;
}
