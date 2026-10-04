import type { FlockSimulationRuntime } from '../../flock/runtime/FlockSimulationRuntime';

/** Environment state supplied by the scene owner, never read from UI stores in GPU passes. */
export interface NativeSceneHost {
  flockRuntime(): FlockSimulationRuntime;
  isRealtime(): boolean;
  /** Undefined means the source is unavailable; an empty hash is a valid known source. */
  sourceFingerprint(sourceId: string): string | undefined;
  /** Asks for another frame (the path tracer converging in a paused preview); absent: frames come from the caller only. */
  requestRender?(): void;
}
