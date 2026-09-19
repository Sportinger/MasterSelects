import type { FlockDiagnostic } from '../../../types/flock';

/**
 * Stable façade between flock runtime owners (GPU sessions, caches) and UI /
 * automation surfaces. Surfaces read bounded status snapshots and request
 * precompute; they never touch GPU buffers or per-particle arrays.
 */

export type FlockRuntimeState =
  | 'idle'
  | 'compiling'
  | 'computing'
  | 'ready'
  | 'stale'
  | 'invalid'
  | 'missing-asset'
  | 'unsupported';

export interface FlockHostCapabilities {
  webgpu: boolean;
  gpuCompute: boolean;
  /** 'cpu-limited' = explicitly reduced reference path; never used for export. */
  fallback: 'none' | 'cpu-limited';
  cpuFallbackMaxParticles: number;
  maxStorageBufferBindingSize: number;
  maxBufferSize: number;
  maxStorageBuffersPerShaderStage: number;
  maxComputeWorkgroupsPerDimension: number;
}

export interface FlockCacheStatus {
  checkpointCount: number;
  checkpointBytes: number;
  coveredSourceRange: [number, number] | null;
  persistedCheckpointCount: number;
  precomputeProgress: number | null;
  precomputeRange: [number, number] | null;
  current: boolean;
}

export interface FlockRuntimeStatus {
  clipId: string;
  state: FlockRuntimeState;
  message?: string;
  requestedCount: number;
  simulatedCount: number;
  aliveCount: number;
  drawnInstances: number;
  linkCapacity: number;
  trailSamples: number;
  neighborSaturatedCells: number;
  step: number;
  targetStep: number;
  sourceTime: number;
  stepRate: number;
  memoryBytes: number;
  estimatedMemoryBytes: number;
  phaseTimingsMs: Record<string, number>;
  cache: FlockCacheStatus;
  hashes: { topology: string; behavior: string } | null;
  diagnostics: FlockDiagnostic[];
  updatedAt: number;
}

export interface FlockParticleSample {
  clipId: string;
  step: number;
  sourceTime: number;
  count: number;
  /** Bounded, opt-in sample: [x, y, z, vx, vy, vz, age, group] per particle. */
  values: number[];
}

export interface FlockPrecomputeResult {
  ok: boolean;
  message?: string;
  steps?: number;
}

export interface FlockRuntimeBackend {
  requestPrecompute(clipId: string, range: { start: number; end: number }, options: { persist: boolean }): Promise<FlockPrecomputeResult>;
  cancelPrecompute(clipId: string): void;
  sampleParticles(clipId: string, options: { maxCount: number }): Promise<FlockParticleSample | null>;
  getCapabilities(): FlockHostCapabilities;
  clearCache(clipId: string): Promise<void>;
}

type Listener = () => void;

const DEFAULT_CAPABILITIES: FlockHostCapabilities = {
  webgpu: typeof navigator !== 'undefined' && 'gpu' in navigator,
  gpuCompute: false,
  fallback: 'cpu-limited',
  cpuFallbackMaxParticles: 6000,
  maxStorageBufferBindingSize: 0,
  maxBufferSize: 0,
  maxStorageBuffersPerShaderStage: 0,
  maxComputeWorkgroupsPerDimension: 0,
};

class FlockRuntimeApi {
  private readonly statuses = new Map<string, FlockRuntimeStatus>();
  private readonly listeners = new Set<Listener>();
  private backend: FlockRuntimeBackend | null = null;
  private notifyScheduled = false;

  setBackend(backend: FlockRuntimeBackend | null): void {
    this.backend = backend;
    this.emit();
  }

  getStatus(clipId: string): FlockRuntimeStatus | null {
    return this.statuses.get(clipId) ?? null;
  }

  listStatuses(): FlockRuntimeStatus[] {
    return [...this.statuses.values()];
  }

  publishStatus(status: FlockRuntimeStatus): void {
    this.statuses.set(status.clipId, status);
    this.emit();
  }

  clearStatus(clipId: string): void {
    if (this.statuses.delete(clipId)) this.emit();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getCapabilities(): FlockHostCapabilities {
    return this.backend?.getCapabilities() ?? DEFAULT_CAPABILITIES;
  }

  requestPrecompute(clipId: string, range: { start: number; end: number }, options: { persist?: boolean } = {}): Promise<FlockPrecomputeResult> {
    if (!this.backend) return Promise.resolve({ ok: false, message: 'Flock runtime is not initialized yet (no GPU device).' });
    return this.backend.requestPrecompute(clipId, range, { persist: options.persist === true });
  }

  cancelPrecompute(clipId: string): void {
    this.backend?.cancelPrecompute(clipId);
  }

  sampleParticles(clipId: string, maxCount = 64): Promise<FlockParticleSample | null> {
    if (!this.backend) return Promise.resolve(null);
    return this.backend.sampleParticles(clipId, { maxCount: Math.max(1, Math.min(1024, Math.round(maxCount))) });
  }

  clearCache(clipId: string): Promise<void> {
    return this.backend?.clearCache(clipId) ?? Promise.resolve();
  }

  private emit(): void {
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    queueMicrotask(() => {
      this.notifyScheduled = false;
      for (const listener of this.listeners) listener();
    });
  }
}

export const flockRuntime = new FlockRuntimeApi();
