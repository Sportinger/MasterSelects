import shader from '../../shaders/StrandRasterScan.wgsl?raw';

const GROUP = 256;

/** Exclusive prefix sums of u32 storage buffers; the per-level sum buffers grow and are reused. */
export class StrandRasterScan {
  private device: GPUDevice | null = null;
  private layout: GPUBindGroupLayout | null = null;
  private scanPipeline: GPUComputePipeline | null = null;
  private addPipeline: GPUComputePipeline | null = null;
  private sums: GPUBuffer[] = [];

  private initialize(device: GPUDevice): void {
    if (this.device === device) return;
    this.dispose();
    this.device = device;
    this.layout = device.createBindGroupLayout({ label: 'strand-raster-scan', entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    ] });
    const module = device.createShaderModule({ label: 'strand-raster-scan', code: shader });
    const layout = device.createPipelineLayout({ bindGroupLayouts: [this.layout] });
    this.scanPipeline = device.createComputePipeline({ label: 'strand-raster-scan-blocks', layout, compute: { module, entryPoint: 'scanBlocks' } });
    this.addPipeline = device.createComputePipeline({ label: 'strand-raster-scan-add', layout, compute: { module, entryPoint: 'addBlockOffsets' } });
  }

  /** Replaces `values[0 … count)` with their exclusive prefix sums. */
  encode(device: GPUDevice, encoder: GPUCommandEncoder, values: GPUBuffer, count: number, temporaryBuffers: GPUBuffer[]): void {
    if (count <= 0) return;
    this.initialize(device);
    const counts = [count];
    while (counts[counts.length - 1] > GROUP) counts.push(Math.ceil(counts[counts.length - 1] / GROUP));
    counts.forEach((levelCount, level) => {
      const size = Math.max(16, Math.ceil(levelCount / GROUP) * 4);
      if (!this.sums[level] || this.sums[level].size < size) {
        this.sums[level]?.destroy();
        this.sums[level] = device.createBuffer({ label: `strand-raster-scan-sums-${level}`, size, usage: GPUBufferUsage.STORAGE });
      }
    });
    const levelValues = (level: number) => level === 0 ? values : this.sums[level - 1];
    const pass = encoder.beginComputePass({ label: 'strand-raster-scan' });
    const dispatch = (pipeline: GPUComputePipeline, level: number) => {
      const groups = Math.ceil(counts[level] / GROUP), width = Math.min(groups, device.limits.maxComputeWorkgroupsPerDimension);
      const uniform = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      temporaryBuffers.push(uniform);
      device.queue.writeBuffer(uniform, 0, Uint32Array.of(counts[level], width, 0, 0));
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, device.createBindGroup({ layout: this.layout!, entries: [
        { binding: 0, resource: { buffer: levelValues(level) } },
        { binding: 1, resource: { buffer: this.sums[level] } },
        { binding: 2, resource: { buffer: uniform } },
      ] }));
      pass.dispatchWorkgroups(width, Math.ceil(groups / width));
    };
    // Scan every level up to one block, then add each scanned block sum back down.
    for (let level = 0; level < counts.length; level++) dispatch(this.scanPipeline!, level);
    for (let level = counts.length - 2; level >= 0; level--) dispatch(this.addPipeline!, level);
    pass.end();
  }

  dispose(): void {
    this.sums.forEach(buffer => buffer.destroy());
    this.sums = [];
    this.scanPipeline = this.addPipeline = null;
    this.layout = null;
    this.device = null;
  }
}
