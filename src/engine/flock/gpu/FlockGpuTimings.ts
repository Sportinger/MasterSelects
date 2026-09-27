/** Optional GPU timestamps. Readback is bounded and never stalls rendering. */
const QUERY_COUNT = 512;
const SLOT_COUNT = 3;

export interface FlockGpuTimingSample {
  sequence: number;
  updatedAt: number;
  milliseconds: Record<string, number>;
  passes: Record<string, number>;
  truncated: boolean;
}

export interface FlockDrawDiagnostics {
  clipId: string;
  viewport: { width: number; height: number };
  simulated: number;
  points: number;
  shadowPoints: number;
  children: number[];
  requestedChildren: number[];
  updatedAt: number;
}

interface Slot {
  queries: GPUQuerySet;
  resolve: GPUBuffer;
  readback: GPUBuffer;
  busy: boolean;
}

interface Batch {
  slot: Slot;
  labels: string[];
  truncated: boolean;
}

export class FlockGpuTimings {
  readonly supported: boolean;
  private readonly slots: Slot[] = [];
  private readonly batches = new WeakMap<GPUCommandEncoder, Batch | null>();
  private readonly samples = new Map<string, FlockGpuTimingSample>();
  private readonly draws = new Map<string, FlockDrawDiagnostics>();
  private sequence = 0;
  private disposed = false;
  private readonly device: GPUDevice;

  constructor(device: GPUDevice) {
    this.device = device;
    this.supported = device.features?.has('timestamp-query') ?? false;
    void device.lost?.then(() => this.dispose());
  }

  writes(encoder: GPUCommandEncoder, label: string): GPUComputePassTimestampWrites | undefined {
    if (!this.supported || this.disposed) return undefined;
    let batch = this.batches.get(encoder);
    if (batch === undefined) {
      let slot = this.slots.find((item) => !item.busy);
      if (!slot && this.slots.length < SLOT_COUNT) {
        slot = {
          queries: this.device.createQuerySet({ type: 'timestamp', count: QUERY_COUNT, label: 'flock-timestamps' }),
          resolve: this.device.createBuffer({ size: QUERY_COUNT * 8, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }),
          readback: this.device.createBuffer({ size: QUERY_COUNT * 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }),
          busy: false,
        };
        this.slots.push(slot);
      }
      batch = slot ? { slot, labels: [], truncated: false } : null;
      if (slot) slot.busy = true;
      this.batches.set(encoder, batch);
    }
    if (!batch) return undefined;
    if (batch.labels.length * 2 >= QUERY_COUNT) {
      batch.truncated = true;
      return undefined;
    }
    const index = batch.labels.length * 2;
    batch.labels.push(label);
    return { querySet: batch.slot.queries, beginningOfPassWriteIndex: index, endOfPassWriteIndex: index + 1 };
  }

  /** Encode before submit; call returned readback starter immediately after submit. */
  resolve(encoder: GPUCommandEncoder, scope: string): () => void {
    const batch = this.batches.get(encoder);
    this.batches.delete(encoder);
    if (!batch || this.disposed) return () => {};
    const { slot, labels, truncated } = batch;
    const count = labels.length * 2;
    const sequence = ++this.sequence;
    encoder.resolveQuerySet(slot.queries, 0, count, slot.resolve, 0);
    encoder.copyBufferToBuffer(slot.resolve, 0, slot.readback, 0, count * 8);
    return () => {
      void slot.readback.mapAsync(GPUMapMode.READ, 0, count * 8).then(() => {
        if (this.disposed) return;
        const times = new BigUint64Array(slot.readback.getMappedRange(0, count * 8));
        const milliseconds: Record<string, number> = {};
        const passes: Record<string, number> = {};
        labels.forEach((label, i) => {
          const elapsed = Number(times[i * 2 + 1] - times[i * 2]) / 1e6;
          milliseconds[label] = (milliseconds[label] ?? 0) + Math.max(0, elapsed);
          passes[label] = (passes[label] ?? 0) + 1;
        });
        slot.readback.unmap();
        if ((this.samples.get(scope)?.sequence ?? -1) < sequence) {
          this.samples.delete(scope);
          this.samples.set(scope, { sequence, updatedAt: Date.now(), milliseconds, passes, truncated });
          if (this.samples.size > 16) this.samples.delete(this.samples.keys().next().value!);
        }
      }).catch(() => { /* Device loss must not interrupt playback. */ }).finally(() => { slot.busy = false; });
    };
  }

  recordDraw(value: FlockDrawDiagnostics): void {
    const key = `${value.clipId}:${value.viewport.width}x${value.viewport.height}`;
    this.draws.delete(key);
    this.draws.set(key, value);
    if (this.draws.size > 16) this.draws.delete(this.draws.keys().next().value!);
  }

  snapshot() {
    return { supported: this.supported && !this.disposed, samples: Object.fromEntries(this.samples), draws: [...this.draws.values()] };
  }

  cancel(encoder: GPUCommandEncoder): void {
    const batch = this.batches.get(encoder);
    if (batch) batch.slot.busy = false;
    this.batches.delete(encoder);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const slot of this.slots) {
      slot.queries.destroy();
      slot.resolve.destroy();
      slot.readback.destroy();
    }
    this.samples.clear();
    this.draws.clear();
  }
}

const owners: WeakMap<GPUDevice, FlockGpuTimings> = import.meta.hot?.data?.flockGpuTimings ?? new WeakMap();
let current: FlockGpuTimings | undefined = import.meta.hot?.data?.currentFlockGpuTimings;
if (import.meta.hot?.dispose) import.meta.hot.dispose((data) => {
  data.flockGpuTimings = owners;
  data.currentFlockGpuTimings = current;
});

export function flockGpuTimings(device: GPUDevice): FlockGpuTimings {
  let owner = owners.get(device);
  if (!owner) { owner = new FlockGpuTimings(device); owners.set(device, owner); }
  current = owner;
  return owner;
}

export function getFlockGpuTimingSnapshot() {
  return current?.snapshot() ?? { supported: false, samples: {}, draws: [] };
}
