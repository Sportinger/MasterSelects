import { FLOCK_POINT_CACHE_WORKGROUP } from '../shaders/flockPointsWgsl';
import type { FlockGpuPipelines } from './FlockGpuPipelines';

/** Bytes per cached point: vec3f position + packed rgba8 (color, shadow visibility). */
export const FLOCK_POINT_RECORD_BYTES = 16;
/**
 * Largest cache: one 1D dispatch (65535 workgroups), about 16.7 million points
 * and 268 MB. Larger branches keep the direct per-vertex path.
 */
export const FLOCK_POINT_CACHE_MAX_POINTS = 65535 * FLOCK_POINT_CACHE_WORKGROUP;

/** Caches unused for this many prepared frames are freed (covers multiple render targets per frame). */
const UNUSED_FRAMES_BEFORE_FREE = 120;

interface CacheEntry {
  total: number;
  lastUsedFrame: number;
  buffer: GPUBuffer;
  params: GPUBuffer;
  computeGroup: GPUBindGroup;
  renderGroup: GPUBindGroup;
}

/**
 * Per-branch point records written once per frame by a compute prepass, so
 * the six vertices of each sprite (and the shadow pass) read one record
 * instead of re-evaluating sub-particle interpolation, pigment, relief and
 * shadow lookups per vertex.
 */
export class FlockPointCache {
  private readonly device: GPUDevice;
  private readonly pipelines: FlockGpuPipelines;
  private readonly entries = new Map<string, CacheEntry>();
  private frame = 0;

  constructor(device: GPUDevice, pipelines: FlockGpuPipelines) {
    this.device = device;
    this.pipelines = pipelines;
  }

  /** Returns the cache for `key` sized for `total` points, or null when over budget. */
  ensure(key: string, total: number): CacheEntry | null {
    if (total <= 0 || total > FLOCK_POINT_CACHE_MAX_POINTS) return null;
    const existing = this.entries.get(key);
    if (existing && existing.total === total) {
      existing.lastUsedFrame = this.frame;
      return existing;
    }
    if (existing) this.destroy(key, existing);
    const buffer = this.device.createBuffer({ size: total * FLOCK_POINT_RECORD_BYTES, usage: GPUBufferUsage.STORAGE, label: `flock-point-cache-${key}` });
    const params = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, label: 'flock-point-cache-params' });
    this.device.queue.writeBuffer(params, 0, new Uint32Array([total, 0, 0, 0]));
    const entry: CacheEntry = {
      total,
      lastUsedFrame: this.frame,
      buffer,
      params,
      computeGroup: this.device.createBindGroup({
        layout: this.pipelines.pointCacheComputeLayout,
        entries: [{ binding: 0, resource: { buffer } }, { binding: 1, resource: { buffer: params } }],
        label: 'flock-point-cache-compute',
      }),
      renderGroup: this.device.createBindGroup({
        layout: this.pipelines.pointCacheRenderLayout,
        entries: [{ binding: 0, resource: { buffer } }],
        label: 'flock-point-cache-render',
      }),
    };
    this.entries.set(key, entry);
    return entry;
  }

  renderGroup(key: string): GPUBindGroup | null {
    return this.entries.get(key)?.renderGroup ?? null;
  }

  encode(
    encoder: GPUCommandEncoder,
    entryPoint: 'cachePoints' | 'cacheVisibility',
    entry: CacheEntry,
    frameGroup: GPUBindGroup,
    branchGroup: GPUBindGroup,
  ): void {
    const pass = encoder.beginComputePass({ label: `flock-${entryPoint}` });
    pass.setPipeline(this.pipelines.getPointCachePipeline(entryPoint));
    pass.setBindGroup(0, frameGroup);
    pass.setBindGroup(1, branchGroup);
    pass.setBindGroup(2, entry.computeGroup);
    pass.dispatchWorkgroups(Math.ceil(entry.total / FLOCK_POINT_CACHE_WORKGROUP));
    pass.end();
  }

  beginFrame(): void {
    this.frame += 1;
  }

  /** Frees caches of branches that have not been drawn for a while. */
  pruneUnused(): void {
    for (const [key, entry] of this.entries) {
      if (this.frame - entry.lastUsedFrame > UNUSED_FRAMES_BEFORE_FREE) this.destroy(key, entry);
    }
  }

  dispose(): void {
    for (const [key, entry] of this.entries) this.destroy(key, entry);
  }

  private destroy(key: string, entry: CacheEntry): void {
    entry.buffer.destroy();
    entry.params.destroy();
    this.entries.delete(key);
  }
}
