import type { DisTrajectory } from '../DisTrajectory';

const shader = /* wgsl */`
struct Params { grid: vec4f, clock: vec4f, counts: vec4u }
@group(0) @binding(0) var forward: texture_2d_array<f32>;
@group(0) @binding(1) var backward: texture_2d_array<f32>;
@group(0) @binding(2) var age: texture_2d<f32>;
@group(0) @binding(3) var<storage,read> steps: array<vec4f>;
@group(0) @binding(4) var<uniform> params: Params;
@group(0) @binding(5) var output: texture_storage_2d<rgba32float,write>;
@group(0) @binding(6) var linearSampler: sampler;
fn field(uv: vec2f, slot: u32, reverse: bool) -> vec4f {
  let columns = u32(params.grid.z); let rows = u32(params.grid.w);
  let tile = vec2f(f32(slot%columns),f32((slot/columns)%rows));
  let local = clamp(uv,.5/params.grid.xy,1.0-.5/params.grid.xy);
  let p = (tile+local)/vec2f(f32(columns),f32(rows));
  let layer = i32(slot/(columns*rows));
  if (reverse) { return textureSampleLevel(backward,linearSampler,p,layer,0.0); }
  return textureSampleLevel(forward,linearSampler,p,layer,0.0);
}
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(output); if (any(id.xy>=size)) { return; }
  let p = vec2f(id.xy)/vec2f(size-vec2u(1));
  let ageSize = textureDimensions(age);
  let requested = params.clock.x-textureLoad(age,min(vec2i(p*vec2f(ageSize)),vec2i(ageSize)-1),0).r;
  var uv = select(vec2f(.5,p.y),vec2f(p.x,.5),params.clock.y>.5);
  let future = requested>=0.0;
  let start = select(0u,params.counts.x,future);
  let count = select(params.counts.x,params.counts.y,future);
  var current = 0.0; var valid = 1.0;
  for (var i=0u;i<count && abs(requested-current)>.000001;i++) {
    let step = steps[start+i];
    let motion = field(uv,u32(step.x),step.y>.5);
    if (motion.a<.5 || motion.b<.15) { valid=0.0; break; }
    let delta = sign(step.z)*min(abs(step.z),abs(requested-current));
    uv += motion.xy*delta; current += delta;
    if (any(uv<vec2f(0.0)) || any(uv>vec2f(1.0))) { valid=0.0; break; }
  }
  if (abs(requested-current)>.00001) { valid=0.0; }
  textureStore(output,vec2i(id.xy),vec4f(uv,valid,0.0));
}`;

/** Independent seeds have stable grid identities. A lost correspondence ends
 * that seed's segment; no previous playback state or invented bridge is used. */
export class BandTrajectoryField {
  private device: GPUDevice;
  private pipeline: GPUComputePipeline;
  private sampler: GPUSampler;
  private texture?: GPUTexture;
  constructor(device: GPUDevice) {
    this.device = device;
    const bindings = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '2d-array' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '2d-array' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba32float' } },
      { binding: 6, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
    ] });
    this.pipeline = device.createComputePipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [bindings] }), label: 'slit-scan-trajectories',
      compute: { module: device.createShaderModule({ code: shader }), entryPoint: 'main' } });
    this.sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
  }

  encode(encoder: GPUCommandEncoder, trajectory: DisTrajectory, age: GPUTextureView, now: number,
    columns: number, rows: number, verticalScan: boolean): GPUTextureView {
    const times = [...new Set(trajectory.pairs.flatMap(pair => [pair.sourceTime, pair.targetTime]))].toSorted((a,b)=>a-b);
    if (!times.length) throw new Error('Motion band has no source correspondences.');
    const origin = times.reduce((best,time)=>Math.abs(time-now)<Math.abs(best-now)?time:best,times[0]);
    const chain = (direction: number) => {
      let time = origin; const values: number[] = [];
      for (let i=0;i<512;i++) {
        const pair = trajectory.pairs.find(p => (p.sourceTime===time && Math.sign(p.targetTime-time)===direction)
          || (p.targetTime===time && Math.sign(p.sourceTime-time)===direction));
        if (!pair) break;
        const reverse = pair.targetTime===time;
        const next = reverse ? pair.sourceTime : pair.targetTime;
        values.push(pair.slot,Number(reverse),next-time,0); time=next;
      }
      return values;
    };
    const past=chain(-1),future=chain(1), steps=new Float32Array([...past,...future]);
    const storage=this.device.createBuffer({size:Math.max(16,steps.byteLength),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
    if(steps.length)this.device.queue.writeBuffer(storage,0,steps);
    const data=new ArrayBuffer(48), floats=new Float32Array(data),ints=new Uint32Array(data);
    floats.set([trajectory.width,trajectory.height,trajectory.columns,trajectory.rows,now-origin,Number(verticalScan),0,0]);
    ints.set([past.length/4,future.length/4,0,0],8);
    const uniform=this.device.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    this.device.queue.writeBuffer(uniform,0,data);
    if(!this.texture || this.texture.width!==columns+1 || this.texture.height!==rows+1) {
      if(this.texture)this.retire([this.texture]);
      this.texture=this.device.createTexture({size:[columns+1,rows+1],format:'rgba32float',
        usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING});
    }
    const view=this.texture.createView();
    const pass=encoder.beginComputePass({label:'slit-scan-trajectories'});pass.setPipeline(this.pipeline);
    pass.setBindGroup(0,this.device.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[
      {binding:0,resource:trajectory.forward},{binding:1,resource:trajectory.backward},{binding:2,resource:age},
      {binding:3,resource:{buffer:storage}},{binding:4,resource:{buffer:uniform}},{binding:5,resource:view},
      {binding:6,resource:this.sampler},
    ]}));pass.dispatchWorkgroups(Math.ceil((columns+1)/8),Math.ceil((rows+1)/8));pass.end();
    this.retire([storage,uniform]);return view;
  }
  destroy(): void { if(this.texture)this.retire([this.texture]);this.texture=undefined; }
  private retire(resources:(GPUBuffer|GPUTexture)[]):void {
    void Promise.resolve().then(()=>this.device.queue.onSubmittedWorkDone()).then(()=>resources.forEach(r=>r.destroy()),()=>resources.forEach(r=>r.destroy()));
  }
}
