import { hybridTemporalCompositeShader, hybridTemporalDemandShader } from './hybridTemporalShader';

/** One GPU pass per resident batch; read back only a 32-byte frame-usage bitset. */
export class HybridTemporalGpu {
  private device: GPUDevice;
  private composite: GPURenderPipeline;
  private demand: GPUComputePipeline;
  private sampler: GPUSampler;
  constructor(device: GPUDevice) {
    this.device = device;
    const module = device.createShaderModule({ code: hybridTemporalCompositeShader });
    const add: GPUBlendComponent = { operation: 'add', srcFactor: 'one', dstFactor: 'one' };
    this.composite = device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vertex' },
      fragment: { module, entryPoint: 'fragment', targets: [{ format: 'rgba16float', blend: { color: add, alpha: add } }] } });
    this.demand = device.createComputePipeline({ layout: 'auto', compute: {
      module: device.createShaderModule({ code: hybridTemporalDemandShader }), entryPoint: 'main' } });
    this.sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
  }
  accumulate(encoder: GPUCommandEncoder, demand: GPUTextureView, ages: GPUBuffer, atlas: GPUTextureView,
    current: GPUTextureView, output: GPUTextureView, mapping: Int32Array, first: boolean) {
    // A buffer per submitted batch prevents later queue writes from changing earlier draws.
    const slots = this.device.createBuffer({ size: mapping.byteLength, usage: GPUBufferUsage.STORAGE, mappedAtCreation: true });
    new Int32Array(slots.getMappedRange()).set(mapping); slots.unmap();
    const bind = this.device.createBindGroup({ layout: this.composite.getBindGroupLayout(0), entries: [
      { binding: 0, resource: demand }, { binding: 1, resource: { buffer: ages } }, { binding: 2, resource: atlas },
      { binding: 3, resource: current }, { binding: 4, resource: this.sampler }, { binding: 5, resource: { buffer: slots } },
    ] });
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: output, loadOp: first ? 'clear' : 'load', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
    pass.setPipeline(this.composite); pass.setBindGroup(0, bind); pass.draw(3); pass.end();
    return slots;
  }
  async needed(demand: GPUTextureView, ages: GPUBuffer, width: number, height: number, groups = 256) {
    const size = Math.ceil(groups / 32) * 4;
    const used = this.device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const staging = this.device.createBuffer({ size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    try {
      const encoder = this.device.createCommandEncoder();
      const pass = encoder.beginComputePass(); pass.setPipeline(this.demand);
      pass.setBindGroup(0, this.device.createBindGroup({ layout: this.demand.getBindGroupLayout(0), entries: [
        { binding: 0, resource: demand }, { binding: 1, resource: { buffer: ages } }, { binding: 2, resource: { buffer: used } },
      ] }));
      pass.dispatchWorkgroups(Math.ceil(width / 16), Math.ceil(height / 16)); pass.end();
      encoder.copyBufferToBuffer(used, 0, staging, 0, size); this.device.queue.submit([encoder.finish()]);
      await staging.mapAsync(GPUMapMode.READ);
      const bits = new Uint32Array(staging.getMappedRange());
      const needed = Array.from({ length: groups }, (_, i) => i).filter(i => (bits[i >>> 5] & (1 << (i % 32))) !== 0);
      staging.unmap(); return needed;
    } finally { used.destroy(); staging.destroy(); }
  }
}
