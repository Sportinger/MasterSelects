/**
 * Optional GPU time per realtime stage (integrator, ReSTIR shading, cache resolve, denoiser and
 * upscaler), for the preview overlay and performance work. Off unless `setPtProfiling(true)`; the
 * latest milliseconds are read with `getPtProfile()`.
 */
export const PT_PROFILE_STAGES = ['build', 'integrate', 'restir', 'cache', 'denoise'] as const;
export type PtProfileStage = typeof PT_PROFILE_STAGES[number];

let enabled = false;
let latest: Partial<Record<PtProfileStage, number>> = {};

export function setPtProfiling(on: boolean): void { enabled = on; }
export function getPtProfile(): Partial<Record<PtProfileStage, number>> { return latest; }

// Console access in the editor (like window.__WC_PIPELINE__): __PT_PROFILE__.set(true), then __PT_PROFILE__.get().
if (typeof window !== 'undefined') {
  (window as unknown as { __PT_PROFILE__: unknown }).__PT_PROFILE__ = { set: setPtProfiling, get: getPtProfile };
}

const SLOTS = PT_PROFILE_STAGES.length * 2;

export class PtPassProfiler {
  private querySet: GPUQuerySet | null = null;
  private resolveBuffer: GPUBuffer | null = null;
  private readback: GPUBuffer | null = null;
  private busy = false;
  private written = new Set<number>();
  private pending = false;

  /** Whether this frame is measured (profiling on, timestamps supported, last readback done); repeated calls in a frame agree. */
  begin(device: GPUDevice): boolean {
    if (this.pending) return true;
    this.written.clear();
    if (!enabled || this.busy || !device.features.has('timestamp-query')) return false;
    if (!this.querySet) {
      this.querySet = device.createQuerySet({ type: 'timestamp', count: SLOTS });
      this.resolveBuffer = device.createBuffer({ size: SLOTS * 8, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
      this.readback = device.createBuffer({ size: SLOTS * 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    }
    this.pending = true;
    return true;
  }

  /** An empty pass that only writes the start (or end) timestamp of `stage`, around work encoded elsewhere. */
  mark(encoder: GPUCommandEncoder, stage: PtProfileStage, end: boolean): void {
    const writes = this.writes(stage, !end, end);
    if (writes) encoder.beginComputePass({ label: `pt-profile-${stage}`, timestampWrites: writes }).end();
  }

  /** Timestamp writes for the first and last pass of `stage` (either may be the same pass). */
  writes(stage: PtProfileStage, first: boolean, last: boolean): GPUComputePassTimestampWrites | undefined {
    if (!this.pending || !this.querySet) return undefined;
    const index = PT_PROFILE_STAGES.indexOf(stage) * 2;
    const writes: GPUComputePassTimestampWrites = { querySet: this.querySet };
    if (first) { writes.beginningOfPassWriteIndex = index; this.written.add(index); }
    if (last) { writes.endOfPassWriteIndex = index + 1; this.written.add(index + 1); }
    return first || last ? writes : undefined;
  }

  resolve(encoder: GPUCommandEncoder): void {
    if (!this.pending || !this.querySet) return;
    encoder.resolveQuerySet(this.querySet, 0, SLOTS, this.resolveBuffer!, 0);
    encoder.copyBufferToBuffer(this.resolveBuffer!, 0, this.readback!, 0, SLOTS * 8);
  }

  afterSubmit(): void {
    if (!this.pending || !this.readback) return;
    this.pending = false;
    this.busy = true;
    const readback = this.readback, written = new Set(this.written);
    void readback.mapAsync(GPUMapMode.READ).then(() => {
      const stamps = new BigUint64Array(readback.getMappedRange().slice(0));
      readback.unmap();
      const result: Partial<Record<PtProfileStage, number>> = {};
      PT_PROFILE_STAGES.forEach((stage, i) => {
        if (written.has(i * 2) && written.has(i * 2 + 1) && stamps[i * 2 + 1] > stamps[i * 2]) {
          result[stage] = Number(stamps[i * 2 + 1] - stamps[i * 2]) / 1e6;
        }
      });
      latest = result;
    }).catch(() => undefined).finally(() => { this.busy = false; });
  }

  dispose(): void {
    this.querySet?.destroy(); this.resolveBuffer?.destroy(); this.readback?.destroy();
    this.querySet = null; this.resolveBuffer = null; this.readback = null;
    this.pending = false;
    this.busy = false;
    this.written.clear();
  }
}
