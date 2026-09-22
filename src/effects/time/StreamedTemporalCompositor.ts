import commonShader from '../_shared/commonShader';

/** A single full-size source texture is reused after each submitted contribution.
 * Linear time interpolation is a sum of two tent weights, so streaming is equivalent
 * to keeping all sampled frames resident. UVs come from the unmodified authored map.
 */
export class StreamedTemporalCompositor {
  private device: GPUDevice;
  private pipeline?: GPURenderPipeline;
  constructor(device: GPUDevice) { this.device = device; }

  accumulate(source: GPUTextureView, demand: GPUTextureView, output: GPUTextureView,
    sampler: GPUSampler, index: number, samples: number, horizon: number, nearest: boolean, first: boolean) {
    const device = this.device;
    if (!this.pipeline) {
      const module = device.createShaderModule({ code: `${commonShader}
@group(0) @binding(0) var s: sampler;
@group(0) @binding(1) var source: texture_2d<f32>;
@group(0) @binding(2) var demand: texture_2d<f32>;
@group(0) @binding(3) var<uniform> settings: vec4f;
@fragment fn accumulate(input: VertexOutput) -> @location(0) vec4f {
  let request = textureLoad(demand, vec2i(input.position.xy), 0);
  let position = clamp(request.z / max(settings.z, 0.00001), 0.0, 1.0) * (settings.y - 1.0);
  var weight = max(0.0, 1.0 - abs(position - settings.x));
  if (settings.w > 0.5) { weight = select(0.0, 1.0, round(position) == settings.x); }
  if (weight <= 0.0) { discard; }
  return textureSampleLevel(source, s, request.xy, 0.0) * weight;
}` });
      const add: GPUBlendComponent = { operation: 'add', srcFactor: 'one', dstFactor: 'one' };
      this.pipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vertexMain' },
        fragment: { module, entryPoint: 'accumulate', targets: [{ format: 'rgba16float', blend: { color: add, alpha: add } }] },
        primitive: { topology: 'triangle-list' } });
    }
    const settings = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(settings, 0, new Float32Array([index, samples, horizon, nearest ? 1 : 0]));
    const bind = device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: sampler }, { binding: 1, resource: source }, { binding: 2, resource: demand },
      { binding: 3, resource: { buffer: settings } },
    ] });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: output, loadOp: first ? 'clear' : 'load', storeOp: 'store' }] });
    pass.setPipeline(this.pipeline); pass.setBindGroup(0, bind); pass.draw(6); pass.end();
    device.queue.submit([encoder.finish()]);
    // Submitted commands retain the buffer; destruction occurs when GPU work is done.
    return device.queue.onSubmittedWorkDone().finally(() => settings.destroy());
  }
}
