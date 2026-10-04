/** A scene does not fit the device; the runtime falls back to the raster and shows this reason. */
export class PtSceneLimitError extends Error {}

export interface PtPagedRegion {
  /** Index of the region's first record in the global numbering (page 1 starts at `page1Start`). */
  global: number;
  page: 0 | 1;
  /** First record inside its page. */
  local: number;
  count: number;
}

const GROWTH = 1.25;

/**
 * Records split over up to two storage buffers ("pages", plan 4.11): regions fill page 0 in order
 * and continue in page 1 when page 0 reaches the device's storage binding size. A region never
 * straddles pages. Shaders map a global index with `page1Start` (PtSceneBindings.wgsl).
 */
export class PtPagedBuffer {
  readonly pages: [GPUBuffer | null, GPUBuffer | null] = [null, null];
  page1Start = 0;
  private placeholder: GPUBuffer | null = null;
  private device: GPUDevice | null = null;

  private readonly label: string;
  private readonly recordBytes: number;

  constructor(label: string, recordBytes: number) {
    this.label = label;
    this.recordBytes = recordBytes;
  }

  /** Records one page can hold on `device`. */
  pageCapacity(device: GPUDevice): number {
    return Math.floor(Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize) / this.recordBytes);
  }

  /**
   * Places regions of `counts` records; reallocates (returns true) when a page is too small. Old
   * buffers go to `retire`, so work already encoded with them stays valid until submission.
   */
  layout(device: GPUDevice, counts: readonly number[], retire: GPUBuffer[]): { regions: PtPagedRegion[]; reallocated: boolean } {
    // Only a real device change drops the pages; the placeholder may already be bound in this frame's encoder.
    if (this.device && this.device !== device) this.destroy();
    this.device = device;
    const limit = this.pageCapacity(device);
    const used = [0, 0];
    const placed = counts.map(count => {
      if (count > limit) throw new PtSceneLimitError(`${this.label}: one layer needs ${count.toLocaleString('en-US')} records, the device allows ${limit.toLocaleString('en-US')} per buffer`);
      const page: 0 | 1 = used[1] > 0 || used[0] + count > limit ? 1 : 0;
      if (page === 1 && used[1] + count > limit) throw new PtSceneLimitError(`${this.label}: the scene exceeds two storage buffers of ${limit.toLocaleString('en-US')} records`);
      const local = used[page];
      used[page] += count;
      return { page, local, count };
    });
    let reallocated = false;
    for (const page of [0, 1] as const) {
      const needed = Math.max(1, used[page]);
      const current = this.pages[page];
      if (current && current.size >= needed * this.recordBytes) continue;
      if (current) retire.push(current);
      const records = Math.min(limit, Math.ceil(needed * GROWTH));
      this.pages[page] = device.createBuffer({ label: `${this.label}-page${page}`, size: Math.max(16, records * this.recordBytes),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
      reallocated = true;
    }
    this.page1Start = Math.floor(this.pages[0]!.size / this.recordBytes);
    const regions = placed.map(region => ({ ...region, global: region.page === 0 ? region.local : this.page1Start + region.local }));
    return { regions, reallocated };
  }

  buffer(page: 0 | 1): GPUBuffer { return this.pages[page]!; }

  /** Both pages for binding; an unused page 1 binds its small placeholder. */
  bindings(device: GPUDevice): [GPUBuffer, GPUBuffer] {
    this.placeholder ??= device.createBuffer({ label: `${this.label}-empty`, size: 64, usage: GPUBufferUsage.STORAGE });
    return [this.pages[0] ?? this.placeholder, this.pages[1] ?? this.placeholder];
  }

  get gpuBytes(): number { return (this.pages[0]?.size ?? 0) + (this.pages[1]?.size ?? 0); }

  destroy(): void {
    this.pages[0]?.destroy(); this.pages[1]?.destroy();
    this.pages[0] = null; this.pages[1] = null;
    this.placeholder?.destroy(); this.placeholder = null;
    this.device = null;
  }
}
