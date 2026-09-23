import { hybridTemporalWeights } from './hybridTemporalShader';
import type { ScanAxis } from './linearTemporalBlockPlan';

// Reuse precisely the Hybrid grid/PTS interpolation, but sample one borrowed source
// directly into its strips. No full-frame atlas upload or demand-texture readback.
const shader = hybridTemporalWeights.replace('@group(0) @binding(0) var demand: texture_2d<f32>;', `
struct Strip { size: vec2f, delay: f32, group: u32, angle: f32, rotation: u32, pad: vec2u }
@group(0) @binding(0) var<uniform> strip: Strip;
@group(0) @binding(2) var source: texture_external;
@group(0) @binding(3) var s: sampler;`) + /* wgsl */`
@vertex fn vertex(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let uv = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(uv * 2.0 - vec2f(1.0), 0.0, 1.0);
}
@fragment fn fragment(@builtin(position) p: vec4f) -> @location(0) vec4f {
  var uv = p.xy / strip.size;
  let angle = strip.angle * 0.017453292519943295;
  let direction = vec2f(cos(angle), sin(angle));
  let position = clamp(dot(uv - vec2f(.5), direction) / (abs(direction.x) + abs(direction.y)) + .5, 0.0, 1.0);
  let w = weights(position * strip.delay);
  var contribution = 0.0;
  for (var i = 0u; i < 4u; i++) { if (w.groups[i] == strip.group) { contribution += w.factors[i]; } }
  if (strip.rotation == 90u) { uv = vec2f(uv.y, 1.0 - uv.x); }
  if (strip.rotation == 180u) { uv = vec2f(1.0) - uv; }
  if (strip.rotation == 270u) { uv = vec2f(1.0 - uv.y, uv.x); }
  return textureSampleBaseClampToEdge(source, s, uv) * contribution;
}`;

export class LinearTemporalBlockGpu {
  private pipeline: GPURenderPipeline;
  private sampler: GPUSampler;
  private device: GPUDevice;
  constructor(device: GPUDevice) {
    this.device = device;
    const module = device.createShaderModule({ label: 'slit-scan-source-strips', code: shader });
    const add: GPUBlendComponent = { operation: 'add', srcFactor: 'one', dstFactor: 'one' };
    this.pipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vertex' },
      fragment: { module, entryPoint: 'fragment', targets: [{ format: 'rgba16float', blend: { color: add, alpha: add } }] } });
    this.sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
  }
  draw(encoder: GPUCommandEncoder, source: GPUExternalTexture, metadata: GPUBuffer, target: GPUTexture,
    group: number, delay: number, axis: ScanAxis, rotation: number, rect: [number, number, number, number]) {
    const uniform = this.device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM, mappedAtCreation: true });
    const data = uniform.getMappedRange();
    new Float32Array(data).set([target.width, target.height, delay]);
    new Uint32Array(data)[3] = group;
    new Float32Array(data)[4] = axis;
    new Uint32Array(data)[5] = rotation; uniform.unmap();
    const bind = this.device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: uniform } }, { binding: 1, resource: { buffer: metadata } },
      { binding: 2, resource: source }, { binding: 3, resource: this.sampler },
    ] });
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'load', storeOp: 'store' }] });
    pass.setPipeline(this.pipeline); pass.setBindGroup(0, bind); pass.setScissorRect(...rect); pass.draw(3); pass.end();
    return uniform;
  }
}
