interface Checkpoint {
  state: GPUBuffer;
  auxiliary: GPUBuffer[];
  rings: GPUBuffer[];
  bytes: number;
}

export interface FlockCheckpointBytes { state: ArrayBuffer; rings: ArrayBuffer[] }

/** Small scenes keep several snapshots; large scenes retain at most a few. */
export function flockCheckpointBudget(snapshotBytes: number): number {
  return Math.max(snapshotBytes, Math.min(256 * 1024 * 1024, Math.max(16 * 1024 * 1024, snapshotBytes * 2)));
}

/**
 * Owns restart snapshots, independent of simulation scheduling and pipelines.
 * Particle bytes are canonical (identity ordered). Persistent auxiliary buffers
 * must already be identity ordered and are packed after the particles for disk
 * persistence. GPU snapshots keep those sections separate, so adding state never
 * increases the size of a storage binding used by the canonicalization shader.
 * Grid/pressure scratch is deliberately excluded: it is rebuilt every step.
 */
export class FlockGpuCheckpoints {
  private budget = 0;
  private readonly checkpoints = new Map<number, Checkpoint>();
  private readonly retired: GPUBuffer[] = [];
  private readonly device: GPUDevice;
  private readonly particleBytes: number;
  private readonly auxiliary: readonly GPUBuffer[];
  private readonly rings: readonly GPUBuffer[];
  private readonly changed: (bytes: number, steps: number[]) => void;

  constructor(
    device: GPUDevice,
    particleBytes: number,
    auxiliary: readonly GPUBuffer[],
    rings: readonly GPUBuffer[],
    changed: (bytes: number, steps: number[]) => void,
  ) {
    this.device = device;
    this.particleBytes = particleBytes;
    this.auxiliary = auxiliary;
    this.rings = rings;
    this.changed = changed;
    this.budget = flockCheckpointBudget(this.stateBytes + rings.reduce((sum, ring) => sum + ring.size, 0));
  }

  get maxBytes(): number { return this.budget; }
  set maxBytes(bytes: number) {
    this.budget = Math.max(0, Number.isFinite(bytes) ? bytes : 0);
    while (this.bytesTotal() > this.budget && this.checkpoints.size > 0) this.thin();
    this.notify();
  }

  get stateBytes(): number { return this.particleBytes + this.auxiliary.reduce((sum, buffer) => sum + buffer.size, 0); }
  has(step: number): boolean { return this.checkpoints.has(step); }
  steps(): number[] { return [...this.checkpoints.keys()].toSorted((a, b) => a - b); }

  atOrBefore(step: number): number {
    let best = 0;
    for (const key of this.checkpoints.keys()) if (key <= step && key > best) best = key;
    return best;
  }

  invalidateFrom(fromStep: number): void {
    for (const [step, checkpoint] of this.checkpoints) {
      if (step <= fromStep) continue;
      this.destroy(checkpoint);
      this.checkpoints.delete(step);
    }
    this.releaseRetired();
    this.notify();
  }

  capture(encoder: GPUCommandEncoder, step: number, copyParticles: (destination: GPUBuffer) => void): void {
    if (this.has(step)) return;
    const bytes = this.stateBytes + this.rings.reduce((sum, ring) => sum + ring.size, 0);
    if (!this.makeRoom(bytes)) return;
    const state = this.buffer(this.particleBytes, `flock-checkpoint-${step}`, true);
    copyParticles(state);
    const copy = (source: GPUBuffer) => {
      const destination = this.buffer(source.size, 'flock-checkpoint-section');
      encoder.copyBufferToBuffer(source, 0, destination, 0, source.size);
      return destination;
    };
    this.checkpoints.set(step, { state, auxiliary: this.auxiliary.map(copy), rings: this.rings.map(copy), bytes });
    this.notify();
  }

  import(step: number, state: ArrayBuffer, rings: ArrayBuffer[]): boolean {
    if (state.byteLength !== this.stateBytes || rings.length !== this.rings.length) return false;
    if (rings.some((ring, index) => ring.byteLength !== this.rings[index].size)) return false;
    if (this.has(step)) return true;
    const bytes = state.byteLength + rings.reduce((sum, ring) => sum + ring.byteLength, 0);
    if (!this.makeRoom(bytes)) return false;
    const write = (data: ArrayBuffer, offset: number, size: number) => {
      const buffer = this.buffer(size, 'flock-imported-checkpoint');
      this.device.queue.writeBuffer(buffer, 0, data, offset, size);
      return buffer;
    };
    let offset = this.particleBytes;
    const auxiliary = this.auxiliary.map(source => {
      const buffer = write(state, offset, source.size);
      offset += source.size;
      return buffer;
    });
    this.checkpoints.set(step, {
      state: write(state, 0, this.particleBytes), auxiliary,
      rings: rings.map(ring => write(ring, 0, ring.byteLength)),
      bytes,
    });
    this.releaseRetired();
    this.notify();
    return true;
  }

  async read(step: number): Promise<FlockCheckpointBytes | null> {
    const checkpoint = this.checkpoints.get(step);
    if (!checkpoint) return null;
    // Queue all copies before awaiting mapping, so eviction while awaiting the
    // readback cannot destroy a source that has not yet been submitted.
    const sections = [checkpoint.state, ...checkpoint.auxiliary, ...checkpoint.rings];
    const staging = sections.map(source => this.device.createBuffer({
      size: source.size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST, label: 'flock-checkpoint-readback',
    }));
    const encoder = this.device.createCommandEncoder();
    sections.forEach((source, index) => encoder.copyBufferToBuffer(source, 0, staging[index], 0, source.size));
    this.device.queue.submit([encoder.finish()]);
    try {
      const data = await Promise.all(staging.map(async buffer => {
        await buffer.mapAsync(GPUMapMode.READ);
        return buffer.getMappedRange().slice(0);
      }));
      const state = new Uint8Array(this.stateBytes);
      let offset = 0;
      data.slice(0, 1 + this.auxiliary.length).forEach(section => {
        state.set(new Uint8Array(section), offset); offset += section.byteLength;
      });
      return { state: state.buffer, rings: data.slice(1 + this.auxiliary.length) };
    } finally {
      for (const buffer of staging) buffer.destroy();
    }
  }

  /** Caller also resets its particle permutation after restoring canonical data. */
  restore(encoder: GPUCommandEncoder, step: number, particles: readonly GPUBuffer[]): boolean {
    const checkpoint = this.checkpoints.get(step);
    if (!checkpoint) return false;
    particles.forEach(target => encoder.copyBufferToBuffer(checkpoint.state, 0, target, 0, this.particleBytes));
    checkpoint.auxiliary.forEach((source, index) => encoder.copyBufferToBuffer(source, 0, this.auxiliary[index], 0, source.size));
    checkpoint.rings.forEach((source, index) => encoder.copyBufferToBuffer(source, 0, this.rings[index], 0, source.size));
    return true;
  }

  /** Program/cache-key compatibility remains the caller's responsibility. */
  adopt(source: FlockGpuCheckpoints, steps: number[]): number {
    if (source.device !== this.device || source.particleBytes !== this.particleBytes) return 0;
    const sameSizes = (a: readonly GPUBuffer[], b: readonly GPUBuffer[]) => a.length === b.length && a.every((buffer, i) => buffer.size === b[i].size);
    if (!sameSizes(source.auxiliary, this.auxiliary) || !sameSizes(source.rings, this.rings)) return 0;
    const encoder = this.device.createCommandEncoder({ label: 'flock-adopt-checkpoints' });
    const copy = (from: GPUBuffer) => {
      const to = this.buffer(from.size, 'flock-adopted-checkpoint');
      encoder.copyBufferToBuffer(from, 0, to, 0, from.size);
      return to;
    };
    let adopted = 0;
    for (const step of steps) {
      const from = source.checkpoints.get(step);
      if (!from || this.has(step)) continue;
      if (!this.makeRoom(from.bytes)) continue;
      this.checkpoints.set(step, { state: copy(from.state), auxiliary: from.auxiliary.map(copy), rings: from.rings.map(copy), bytes: from.bytes });
      adopted += 1;
    }
    this.device.queue.submit([encoder.finish()]);
    this.releaseRetired();
    this.notify();
    return adopted;
  }

  clear(): void {
    for (const checkpoint of this.checkpoints.values()) this.destroy(checkpoint);
    this.checkpoints.clear();
    this.releaseRetired();
    this.notify();
  }

  /** Call after submitting captures: evicted snapshots may occur in that batch. */
  releaseRetired(): void {
    for (const buffer of this.retired) buffer.destroy();
    this.retired.length = 0;
  }

  private buffer(size: number, label: string, storage = false): GPUBuffer {
    return this.device.createBuffer({ size, label, usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST | (storage ? GPUBufferUsage.STORAGE : 0) });
  }

  private bytesTotal(): number {
    let total = 0;
    for (const checkpoint of this.checkpoints.values()) total += checkpoint.bytes;
    return total;
  }

  private thin(): void {
    const steps = this.steps();
    steps.forEach((step, index) => {
      if (steps.length > 1 && index % 2 === 0) return;
      this.destroy(this.checkpoints.get(step)!);
      this.checkpoints.delete(step);
    });
  }

  private makeRoom(bytes: number): boolean {
    if (bytes > this.budget) return false;
    while (this.bytesTotal() + bytes > this.budget && this.checkpoints.size > 0) this.thin();
    return true;
  }

  private destroy(checkpoint: Checkpoint): void {
    this.retired.push(checkpoint.state, ...checkpoint.auxiliary, ...checkpoint.rings);
  }

  private notify(): void { this.changed(this.bytesTotal(), this.steps()); }
}
