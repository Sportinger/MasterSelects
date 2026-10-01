import shader from '../shaders/StrandFrames.wgsl?raw';

/**
 * Strand frames on the GPU (StrandFrames.wgsl) for points a GPU stage has written: Surface Bind and
 * Rod Simulation both leave positions and radius scales in the strand point layout and let this
 * pass add arc length, rotation-minimizing frames and tangents.
 */
export class StrandFramesPass {
  private device: GPUDevice | null = null;
  private layout: GPUBindGroupLayout | null = null;
  private pipeline: GPUComputePipeline | null = null;

  private initialize(device: GPUDevice): void {
    if (this.device === device) return;
    this.device = device;
    this.layout = device.createBindGroupLayout({ label: 'strand-frames', entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }] });
    this.pipeline = device.createComputePipeline({ label: 'strand-frames', layout: device.createPipelineLayout({ bindGroupLayouts: [this.layout] }),
      compute: { module: device.createShaderModule({ label: 'strand-frames', code: shader }), entryPoint: 'strandFrames' } });
  }

  /** Records the frames of `strands` strands (`ranges`: first point and count each) into `pass`. */
  encode(device: GPUDevice, pass: GPUComputePassEncoder, ranges: GPUBuffer, strands: number, packed: GPUBuffer, temporaryBuffers: GPUBuffer[]): void {
    if (!strands) return;
    this.initialize(device);
    const groups = Math.ceil(strands / 64), width = Math.min(groups, device.limits.maxComputeWorkgroupsPerDimension);
    const uniform = device.createBuffer({ label: 'strand-frames-params', size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(uniform, 0, Uint32Array.of(strands, width, 0, 0));
    temporaryBuffers.push(uniform);
    pass.setPipeline(this.pipeline!);
    pass.setBindGroup(0, device.createBindGroup({ layout: this.layout!, entries: [
      { binding: 0, resource: { buffer: uniform } }, { binding: 1, resource: { buffer: ranges } }, { binding: 2, resource: { buffer: packed } }] }));
    pass.dispatchWorkgroups(width, Math.ceil(groups / width));
  }

  dispose(): void {
    this.pipeline = null; this.layout = null; this.device = null;
  }
}
