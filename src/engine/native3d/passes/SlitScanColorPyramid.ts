const shader = /* wgsl */`
@group(0) @binding(0) var image: texture_2d<f32>;
@group(0) @binding(1) var imageSampler: sampler;
struct Vertex { @builtin(position) position: vec4f, @location(0) uv: vec2f }
@vertex fn vertex(@builtin(vertex_index) i: u32) -> Vertex {
  let uv = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return Vertex(vec4f(uv * vec2f(2,-2) + vec2f(-1,1),0,1),uv);
}
@fragment fn copy(v: Vertex) -> @location(0) vec4f {
  let c = textureSampleLevel(image,imageSampler,v.uv,0.0);
  return vec4f(c.rgb*c.a,c.a);
}
@fragment fn reduce(v: Vertex) -> @location(0) vec4f {
  return textureSampleLevel(image,imageSampler,v.uv,0.0);
}`;

/** Owned complete-color snapshot with premultiplied mips. No source history or
 * readback: each level reads only the previous level in the same encoder. */
export class SlitScanColorPyramid {
  private device: GPUDevice;
  private texture?: GPUTexture;
  private views: GPUTextureView[] = [];
  private sampler: GPUSampler;
  private copy: GPURenderPipeline;
  private reduce: GPURenderPipeline;
  constructor(device: GPUDevice) {
    this.device = device;
    this.sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
    const module = device.createShaderModule({ label: 'slit-scan-color-pyramid', code: shader });
    const pipeline = (entryPoint: string) => device.createRenderPipeline({ layout: 'auto',
      vertex: { module, entryPoint: 'vertex' }, fragment: { module, entryPoint, targets: [{ format: 'rgba8unorm' }] } });
    this.copy = pipeline('copy'); this.reduce = pipeline('reduce');
  }
  capture(encoder: GPUCommandEncoder, input: GPUTextureView, width: number, height: number): GPUTextureView {
    if (!this.texture || this.texture.width !== width || this.texture.height !== height) {
      this.destroy();
      const mipLevelCount = 1 + Math.floor(Math.log2(Math.max(width, height)));
      this.texture = this.device.createTexture({ label: 'slit-scan-color-mips', size: [width, height], mipLevelCount,
        format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
      this.views = Array.from({ length: mipLevelCount }, (_, baseMipLevel) => this.texture!.createView({ baseMipLevel, mipLevelCount: 1 }));
    }
    for (let level = 0; level < this.views.length; level++) {
      const pipeline = level === 0 ? this.copy : this.reduce;
      const pass = encoder.beginRenderPass({ label: `slit-scan-color-mip-${level}`, colorAttachments: [
        { view: this.views[level], loadOp: 'clear', storeOp: 'store', clearValue: [0,0,0,0] },
      ] });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: level === 0 ? input : this.views[level - 1] }, { binding: 1, resource: this.sampler },
      ] }));
      pass.draw(3); pass.end();
    }
    return this.texture.createView();
  }
  destroy(): void {
    const texture = this.texture; this.texture = undefined; this.views = [];
    if (texture) void Promise.resolve().then(() => this.device.queue.onSubmittedWorkDone())
      .then(() => texture.destroy(), () => texture.destroy());
  }
}
