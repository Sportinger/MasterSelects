/**
 * Splits the integrator's work into short dispatches and sizes it from measured GPU time.
 *
 * One dispatch that runs longer than about two seconds makes Windows reset the GPU (TDR), which
 * loses the WebGPU device of every tab. The integrator therefore runs in horizontal bands, each in
 * its own compute pass, small enough to stay far below that limit; the cost per pixel sample is
 * measured with timestamp queries (or the submission wall time without them) and sets both the band
 * height and how many samples a frame may add within its time budget.
 */

/** Bytes between the band uniforms (minUniformBufferOffsetAlignment is at most 256). */
export const PT_BAND_STRIDE = 256;
/** Upper bound of bands per frame (the band uniform buffer holds this many). */
export const PT_MAX_BANDS = 128;

/** GPU time one band dispatch may take. */
// Short enough that the desktop compositor, video in other tabs and other apps get the GPU between
// bands: Chrome runs every tab's GPU work on one GPU, so a long pass stalls them all.
const DISPATCH_BUDGET_MS = 6;
/** Before the first measurement: a conservative guess (fiber-heavy scenes on a mid-range GPU). */
const INITIAL_NS_PER_PIXEL_SAMPLE = 400;
/**
 * Planning never assumes less than this: a cost learned on a nearly empty scene (yarn not revealed
 * yet) must not size the first dispatch of a heavy one, which would run for seconds and reset the GPU.
 */
const MIN_PLANNED_NS_PER_PIXEL_SAMPLE = 100;
/** Hard cap of one dispatch whatever was measured: even at 2 µs per pixel sample it ends within about half a second. */
const MAX_PIXEL_SAMPLES_PER_DISPATCH = 1 << 18;

export interface PtBand {
  firstRow: number;
  rows: number;
}

export interface PtDispatchPlan {
  samples: number;
  bands: PtBand[];
}

export class PtDispatchBudget {
  private nsPerPixelSample = INITIAL_NS_PER_PIXEL_SAMPLE;
  private measured = false;
  private querySet: GPUQuerySet | null = null;
  private resolveBuffer: GPUBuffer | null = null;
  private readback: GPUBuffer | null = null;
  private readbackBusy = false;
  private pendingWork = 0;
  private wallStart = 0;
  private device: GPUDevice | null = null;

  /** Measured (or estimated) GPU nanoseconds per pixel sample of the current scene. */
  get costNs(): number { return this.nsPerPixelSample; }
  get hasMeasurement(): boolean { return this.measured; }

  /** Forget the measurement (the scene changed substantially). */
  reset(): void {
    this.measured = false;
    this.nsPerPixelSample = Math.max(this.nsPerPixelSample, INITIAL_NS_PER_PIXEL_SAMPLE);
  }

  /**
   * Samples for this frame (at least 1 when any remain, at most `remaining`) within `frameBudgetMs`,
   * and the bands that cover `rows` rows of `width` pixels.
   */
  plan(width: number, rows: number, remaining: number, frameBudgetMs: number, maxSamples: number): PtDispatchPlan {
    const pixels = Math.max(1, width * rows);
    const cost = Math.max(this.nsPerPixelSample, MIN_PLANNED_NS_PER_PIXEL_SAMPLE);
    const perSampleMs = pixels * cost / 1e6;
    const samples = Math.max(1, Math.min(remaining, maxSamples, Math.floor(frameBudgetMs / Math.max(perSampleMs, 1e-3))));
    const rowMs = width * samples * cost / 1e6;
    let bandRows = Math.max(1, Math.floor(DISPATCH_BUDGET_MS / Math.max(rowMs, 1e-6)));
    bandRows = Math.min(bandRows, Math.max(1, Math.floor(MAX_PIXEL_SAMPLES_PER_DISPATCH / Math.max(1, width * samples))));
    // Whole 8-row workgroups where possible, but never more bands than the band uniforms hold.
    if (bandRows >= 8) bandRows -= bandRows % 8;
    bandRows = Math.max(bandRows, Math.ceil(rows / PT_MAX_BANDS));
    const bands: PtBand[] = [];
    for (let firstRow = 0; firstRow < rows; firstRow += bandRows) bands.push({ firstRow, rows: Math.min(bandRows, rows - firstRow) });
    return { samples, bands };
  }

  /** A preview may cover only part of one sample; export keeps whole, deterministic batches. */
  planPreview(width: number, rows: number, remaining: number, frameBudgetMs: number, maxSamples: number,
    firstRow = 0): PtDispatchPlan & { nextRow: number } {
    const cost = Math.max(this.nsPerPixelSample, MIN_PLANNED_NS_PER_PIXEL_SAMPLE);
    const affordableRows = Math.max(1, Math.floor(frameBudgetMs * 1e6 / (Math.max(1, width) * cost)));
    const count = Math.min(rows - firstRow, affordableRows);
    // Once part of a sample was submitted, every remaining row must use that SAME sample count.
    const plan = this.plan(width, count, remaining, frameBudgetMs, firstRow > 0 || count < rows ? 1 : maxSamples);
    return { samples: plan.samples, bands: plan.bands.map(band => ({ ...band, firstRow: band.firstRow + firstRow })),
      nextRow: firstRow + count < rows ? firstRow + count : 0 };
  }

  /** Realtime must produce a whole image: reduce its pixel count instead of overrunning the budget. */
  previewSize(width: number, height: number, frameBudgetMs: number): { width: number; height: number } {
    const pixels = frameBudgetMs * 1e6 / Math.max(this.nsPerPixelSample, MIN_PLANNED_NS_PER_PIXEL_SAMPLE);
    const scale = Math.min(1, Math.sqrt(pixels / Math.max(1, width * height)));
    // Quantize to workgroups so small timing changes do not resize histories every frame.
    const dimension = (size: number) => Math.max(1, Math.min(size, Math.max(8, Math.floor(size * scale / 8) * 8)));
    return { width: dimension(width), height: dimension(height) };
  }

  /** Timestamp writes for band pass `index` of `count` (null without timestamp queries or while a readback is busy). */
  timestampWrites(device: GPUDevice, index: number, count: number): GPUComputePassTimestampWrites | undefined {
    if (!device.features.has('timestamp-query') || this.readbackBusy) return undefined;
    this.ensure(device);
    if (count === 1) return { querySet: this.querySet!, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 };
    if (index === 0) return { querySet: this.querySet!, beginningOfPassWriteIndex: 0 };
    if (index === count - 1) return { querySet: this.querySet!, endOfPassWriteIndex: 1 };
    return undefined;
  }

  /** After the band passes: resolve the timestamps of `pixelSamples` work (call once per measured frame). */
  encodeResolve(device: GPUDevice, encoder: GPUCommandEncoder, pixelSamples: number): void {
    // Only work measured in this very frame counts (a busy readback skipped its timestamps).
    this.pendingWork = this.readbackBusy ? 0 : pixelSamples;
    if (!device.features.has('timestamp-query') || this.readbackBusy) return;
    this.ensure(device);
    encoder.resolveQuerySet(this.querySet!, 0, 2, this.resolveBuffer!, 0);
    encoder.copyBufferToBuffer(this.resolveBuffer!, 0, this.readback!, 0, 16);
  }

  /** After submission: read the GPU time (or wait for the queue without timestamps) and update the cost. */
  afterSubmit(device: GPUDevice): void {
    const work = this.pendingWork;
    this.pendingWork = 0;
    if (!work || this.readbackBusy) return;
    this.readbackBusy = true;
    if (device.features.has('timestamp-query') && this.readback) {
      const readback = this.readback;
      void readback.mapAsync(GPUMapMode.READ).then(() => {
        const [begin, end] = new BigUint64Array(readback.getMappedRange());
        readback.unmap();
        if (end > begin) this.update(Number(end - begin) / work);
      }).catch(() => undefined).finally(() => { this.readbackBusy = false; });
      return;
    }
    this.wallStart = performance.now();
    void device.queue.onSubmittedWorkDone().then(() => this.update((performance.now() - this.wallStart) * 1e6 / work))
      .finally(() => { this.readbackBusy = false; });
  }

  private update(ns: number): void {
    if (!Number.isFinite(ns) || ns <= 0) return;
    // Rise fast (never overrun the watchdog), settle slowly.
    this.nsPerPixelSample = !this.measured || ns > this.nsPerPixelSample ? ns : this.nsPerPixelSample * 0.7 + ns * 0.3;
    this.measured = true;
  }

  private ensure(device: GPUDevice): void {
    if (this.device === device && this.querySet) return;
    this.dispose();
    this.device = device;
    this.querySet = device.createQuerySet({ label: 'pt-integrate-time', type: 'timestamp', count: 2 });
    this.resolveBuffer = device.createBuffer({ label: 'pt-integrate-time-resolve', size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
    this.readback = device.createBuffer({ label: 'pt-integrate-time-readback', size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  }

  dispose(): void {
    this.querySet?.destroy(); this.resolveBuffer?.destroy(); this.readback?.destroy();
    this.querySet = null; this.resolveBuffer = null; this.readback = null;
    this.readbackBusy = false;
    this.device = null;
  }
}
