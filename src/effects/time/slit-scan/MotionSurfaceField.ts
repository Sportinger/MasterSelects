import type { DisTrajectory } from '../DisTrajectory';
import { motionSurfaceIntervals } from './motionSurfaceIntervals';

const shader = /* wgsl */`
struct Params { grid: vec4f, settings: vec4f }
@group(0) @binding(0) var forward: texture_2d_array<f32>;
@group(0) @binding(1) var backward: texture_2d_array<f32>;
@group(0) @binding(2) var age: texture_2d<f32>;
@group(0) @binding(3) var<storage,read> steps: array<vec4f>;
@group(0) @binding(4) var<uniform> params: Params;
@group(0) @binding(5) var output: texture_storage_2d<rgba32float,write>;
@group(0) @binding(6) var linearSampler: sampler;
fn field(uv: vec2f, slot: u32, reverse: bool) -> vec4f {
  let grid = vec2u(params.grid.zw);
  let tile = vec2u(slot%grid.x,(slot/grid.x)%grid.y);
  let local = clamp(uv,.5/params.grid.xy,1.0-.5/params.grid.xy);
  let p = (vec2f(tile)+local)/vec2f(grid);
  let layer = i32(slot/(grid.x*grid.y));
  if (reverse) { return textureSampleLevel(backward,linearSampler,p,layer,0.0); }
  return textureSampleLevel(forward,linearSampler,p,layer,0.0);
}
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(output); if (any(id.xy>=size)) { return; }
  let p = vec2f(id.xy)/vec2f(size-vec2u(1));
  let ageSize = vec2i(textureDimensions(age));
  // The point belongs to this output pixel's source time. Transport it to
  // the current source time, using a separately measured direction each way.
  var current = -textureLoad(age,clamp(vec2i(p*vec2f(ageSize)),vec2i(0),ageSize-1),0).r;
  var uv = p; var valid = 1.0;
  let increasing = current < 0.0;
  let count = u32(params.settings.x);
  var lo = 0u; var hi = count;
  while (lo < hi) {
    let mid = (lo+hi)/2u;
    let before = select(steps[mid].x < current-.000001, steps[mid].y <= current+.000001, increasing);
    if (before) { lo=mid+1u; } else { hi=mid; }
  }
  var index = select(i32(lo)-1,i32(lo),increasing);
  if (params.settings.y != 0.0) {
    for (var n=0u;n<512u && abs(current)>.000001;n++) {
      if (index<0 || index>=i32(count)) { valid=0.0; break; }
      let step = steps[index];
      if (current<step.x-.00001 || current>step.y+.00001) { valid=0.0; break; }
      let reverse = select((step.w < .5), (step.w > .5), increasing);
      let motion = field(uv,u32(step.z),reverse);
      if (motion.a<.5 || motion.b<.15) { valid=0.0; break; }
      let next = select(max(step.x,0.0),min(step.y,0.0),increasing);
      uv += motion.xy*(next-current); current=next;
      if (any(uv<vec2f(0.0)) || any(uv>vec2f(1.0))) { valid=0.0; break; }
      index += select(-1,1,increasing);
    }
    if (abs(current)>.00001) { valid=0.0; }
  }
  // Visible fallback preserves the original XY; it does not claim a recovered
  // trajectory. Shared vertices keep adjacent cells joined without holes.
  let tracked = valid;
  if (valid < .5 && params.settings.z > .5) { uv = p; valid = 1.0; }
  textureStore(output,vec2i(id.xy),vec4f(mix(p,uv,params.settings.y),valid,tracked));
}`;

/** Full image grid: zero motion preserves area. No playback history, CPU
 * pixel readback or second decoder. Subframe motion is piecewise constant. */
export class MotionSurfaceField {
  private readonly device: GPUDevice;
  private readonly pipeline: GPUComputePipeline;
  private readonly sampler: GPUSampler;
  private texture?: GPUTexture;
  constructor(device: GPUDevice) {
    this.device = device;
    const layout = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '2d-array' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '2d-array' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba32float' } },
      { binding: 6, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
    ] });
    this.pipeline = device.createComputePipeline({ label: 'slit-scan-motion-surface',
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module: device.createShaderModule({ code: shader }), entryPoint: 'main' } });
    this.sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
  }

  encode(encoder: GPUCommandEncoder, trajectory: DisTrajectory, age: GPUTextureView, now: number,
    columns: number, rows: number, amount: number, keepUntracked = true): GPUTextureView {
    const steps = motionSurfaceIntervals(trajectory.pairs, now);
    const storage = this.device.createBuffer({ size: Math.max(16, steps.byteLength), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    if (steps.length) this.device.queue.writeBuffer(storage, 0, steps);
    const values = new Float32Array([trajectory.width, trajectory.height, trajectory.columns, trajectory.rows,
      steps.length / 4, Math.max(0, Math.min(2, Number.isFinite(amount) ? amount : 1)), Number(keepUntracked), 0]);
    const uniform = this.device.createBuffer({ size: values.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(uniform, 0, values);
    if (!this.texture || this.texture.width !== columns + 1 || this.texture.height !== rows + 1) {
      if (this.texture) this.retire([this.texture]);
      this.texture = this.device.createTexture({ size: [columns + 1, rows + 1], format: 'rgba32float',
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
    }
    const view = this.texture.createView(), pass = encoder.beginComputePass({ label: 'slit-scan-motion-surface' });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: trajectory.forward }, { binding: 1, resource: trajectory.backward },
      { binding: 2, resource: age }, { binding: 3, resource: { buffer: storage } },
      { binding: 4, resource: { buffer: uniform } }, { binding: 5, resource: view }, { binding: 6, resource: this.sampler },
    ] }));
    pass.dispatchWorkgroups(Math.ceil((columns + 1) / 8), Math.ceil((rows + 1) / 8)); pass.end();
    this.retire([storage, uniform]); return view;
  }
  destroy(): void { if (this.texture) this.retire([this.texture]); this.texture = undefined; }
  private retire(resources: (GPUBuffer | GPUTexture)[]): void {
    void Promise.resolve().then(() => this.device.queue.onSubmittedWorkDone())
      .then(() => resources.forEach(r => r.destroy()), () => resources.forEach(r => r.destroy()));
  }
}
