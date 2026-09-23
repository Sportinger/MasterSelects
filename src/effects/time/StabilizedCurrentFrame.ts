/** Apply tracking to the already presented input; never wait for a second decode. */
export class StabilizedCurrentFrame {
  private texture: GPUTexture;
  private buffer: GPUBuffer;
  private pipeline: GPURenderPipeline;
  private sampler: GPUSampler;
  private device: GPUDevice;
  readonly width: number;
  readonly height: number;
  constructor(device: GPUDevice, width: number, height: number) {
    this.device = device; this.width = width; this.height = height;
    this.texture = device.createTexture({ label: 'stabilized-current-frame', size: [width, height], format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT });
    this.buffer = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
    const module = device.createShaderModule({ code: `
      @group(0) @binding(0) var source: texture_2d<f32>;
      @group(0) @binding(1) var linearSampler: sampler;
      struct Transform { row0: vec4f, row1: vec4f }
      @group(0) @binding(2) var<uniform> transform: Transform;
      struct Vertex { @builtin(position) position: vec4f, @location(0) uv: vec2f }
      @vertex fn vertex(@builtin(vertex_index) i: u32) -> Vertex {
        let uv = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
        return Vertex(vec4f(uv * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0), 0.0, 1.0), uv);
      }
      @fragment fn fragment(v: Vertex) -> @location(0) vec4f {
        let p = vec3f(v.uv, 1.0);
        let uv = vec2f(dot(transform.row0.xyz, p), dot(transform.row1.xyz, p));
        let color = textureSampleLevel(source, linearSampler, uv, 0.0);
        return select(vec4f(0.0), color, all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0)));
      }` });
    this.pipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vertex' },
      fragment: { module, entryPoint: 'fragment', targets: [{ format: 'rgba8unorm' }] }, primitive: { topology: 'triangle-list' } });
  }
  encode(encoder: GPUCommandEncoder, input: GPUTextureView, matrix: readonly number[]) {
    this.device.queue.writeBuffer(this.buffer, 0, new Float32Array([
      matrix[0], matrix[1], matrix[2], 0, matrix[3], matrix[4], matrix[5], 0,
    ]));
    const view = this.texture.createView();
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: input }, { binding: 1, resource: this.sampler }, { binding: 2, resource: { buffer: this.buffer } },
    ] }));
    pass.draw(3); pass.end();
    return view;
  }
  destroy() { this.texture.destroy(); this.buffer.destroy(); }
}
