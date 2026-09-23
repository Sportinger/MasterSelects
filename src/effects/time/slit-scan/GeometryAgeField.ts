import { temporalSourceTime, type TemporalClipSource } from '../temporalClipSource';
import { MOTION_IMAGE_WGSL } from '../../../services/operators/motionImageWgsl';
import type { TemporalSampleMetadata } from '../TemporalSampleMetadata';
import { geometrySampleTimes, GEOMETRY_SAMPLE_TIME_WGSL } from './geometrySampleTimes';
import { GeometrySourceClock } from './GeometrySourceClock';

const shader = MOTION_IMAGE_WGSL + GEOMETRY_SAMPLE_TIME_WGSL + /* wgsl */`
struct Clock { range: vec4f, flow: vec4f }
@group(0) @binding(0) var query: texture_2d<f32>;
@group(0) @binding(1) var<storage, read> ages: array<f32>;
@group(0) @binding(2) var output: texture_storage_2d<rgba32float, write>;
@group(0) @binding(3) var<uniform> clock: Clock;
@group(0) @binding(4) var motion: texture_2d<f32>;
fn sampleQuery(p: vec2i) -> vec4f {
  return textureLoad(query,clamp(p,vec2i(0),vec2i(textureDimensions(query))-1),0);
}
fn displacement(p: vec2i) -> vec2f {
  let size = vec2f(textureDimensions(query)); let q = sampleQuery(p);
  if (any(abs(q.xy-(vec2f(p)+.5)/size) > 2.0/size)) { return vec2f(0.0); }
  let gradient = .5*vec2f(sampleQuery(p+vec2i(1,0)).b-sampleQuery(p-vec2i(1,0)).b,
    sampleQuery(p+vec2i(0,1)).b-sampleQuery(p-vec2i(0,1)).b);
  let field = textureLoad(motion,p,0);
  let deformation = motionTemporalDeformation(field,gradient,size);
  let confidence = smoothstep(.15,.6,deformation.z)*field.a;
  if (deformation.w <= .05) { return vec2f(0.0); }
  return vec2f(clamp(log2(max(deformation.x,1.0))/6.0,0.0,1.0)*confidence,confidence);
}
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(output); if (any(id.xy >= size)) { return; }
  let delay = textureLoad(query, vec2i(id.xy), 0).b;
  var height = 0.0;
  if (clock.flow.x != 0.0) {
    let p = vec2i(id.xy); let center = displacement(p);
    var sum = center.x; var weights = 1.0;
    if (center.y > 0.0 && clock.flow.y > 0.0) {
      let centerMotion = textureLoad(motion,p,0);
      let radius = i32(clock.flow.y);
      for (var y = -radius; y <= radius; y++) { for (var x = -radius; x <= radius; x++) {
        let other = p+vec2i(x,y);
        if (any(other<vec2i(0)) || any(other>=vec2i(size)) || (x==0 && y==0)) { continue; }
        if (abs(sampleQuery(other).b-delay) > .05) { continue; }
        let otherMotion = textureLoad(motion,other,0);
        if (length(otherMotion.xy-centerMotion.xy) > max(.01,.25*length(centerMotion.xy))) { continue; }
        let signal = displacement(other); if (signal.y<=0.0) { continue; }
        let weight = exp(-f32(x*x+y*y)/max(1.0,clock.flow.y*clock.flow.y));
        sum += signal.x*weight; weights += weight;
      } }
    }
    height = sum/weights*clock.flow.x;
  }
  var age = vec2f(0.0);
  if (clock.flow.z > 0.0) {
    age = sampledSourceAge(delay, u32(clock.flow.z), clock.flow.w > .5);
  } else {
    let position = clamp((delay-clock.range.x)/clock.range.y,0.0,1.0)*clock.range.z;
    let lo = u32(floor(position)); let hi = min(lo+1u,u32(clock.range.z));
    age.x = clock.range.w - mix(ages[lo],ages[hi],fract(position));
  }
  textureStore(output,vec2i(id.xy),vec4f(age.x,height,age.y,1.0));
}`;

/** Relative source ages retain Float32 precision even for large absolute PTS.
 * Mapping samples come exclusively from the temporal owner, including ramps,
 * reverse, transitions and holds. Linear lookup uses 8192 intervals per clip.
 */
export class GeometryAgeField {
  private readonly device: GPUDevice;
  private readonly pipeline: GPUComputePipeline;
  private readonly table: GPUBuffer;
  private readonly clock: GPUBuffer;
  private samples: GPUBuffer;
  private texture?: GPUTexture;
  private sourceClock = new GeometrySourceClock();

  constructor(device: GPUDevice) {
    this.device = device;
    const bindings = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba32float' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    ] });
    this.pipeline = device.createComputePipeline({ label: 'slit-scan-source-age',
      layout: device.createPipelineLayout({ bindGroupLayouts: [bindings] }),
      compute: { module: device.createShaderModule({ code: shader }), entryPoint: 'main' } });
    this.table = device.createBuffer({ size: 8193 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.clock = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.samples = device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  }

  encode(encoder: GPUCommandEncoder, query: GPUTextureView, width: number, height: number,
    source: TemporalClipSource, factor: number, motion?: GPUTextureView, flowDepth = 0, smoothing = 0,
    sampling?: TemporalSampleMetadata): GPUTextureView {
    if (!(factor > 0) || !Number.isFinite(factor)) throw new Error('Invalid geometry time factor.');
    if (!sampling) {
      const clock = this.sourceClock.sample(source, factor);
      if (clock.changed) this.device.queue.writeBuffer(this.table, 0, clock.table);
      this.device.queue.writeBuffer(this.clock, 0, clock.range);
    }
    if (sampling) {
      const data = geometrySampleTimes(sampling, temporalSourceTime(source, source.localTime));
      if (this.samples.size < data.byteLength) {
        this.retire([this.samples]);
        this.samples = this.device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      }
      this.device.queue.writeBuffer(this.samples, 0, data);
    }
    this.device.queue.writeBuffer(this.clock, 16, new Float32Array([motion ? flowDepth : 0,
      Math.max(0, Math.min(4, smoothing)), sampling?.samples.length ?? 0, Number(sampling?.interpolation === 'nearest')]));
    if (!this.texture || this.texture.width !== width || this.texture.height !== height) {
      if (this.texture) this.retire([this.texture]);
      this.texture = this.device.createTexture({ label: 'slit-scan-source-age-field', size: [width, height],
        format: 'rgba32float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
    }
    const view = this.texture.createView();
    const pass = encoder.beginComputePass({ label: 'slit-scan-source-age' });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: query }, { binding: 1, resource: { buffer: this.table } },
      { binding: 2, resource: view }, { binding: 3, resource: { buffer: this.clock } },
      { binding: 4, resource: motion ?? query },
      { binding: 5, resource: { buffer: this.samples } },
    ] }));
    pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8)); pass.end();
    return view;
  }

  destroy(): void { this.retire([this.table, this.clock, this.samples, ...(this.texture ? [this.texture] : [])]); this.texture = undefined; }
  private retire(resources: (GPUBuffer | GPUTexture)[]): void {
    void Promise.resolve().then(() => this.device.queue.onSubmittedWorkDone())
      .then(() => resources.forEach(r => r.destroy()), () => resources.forEach(r => r.destroy()));
  }
}
