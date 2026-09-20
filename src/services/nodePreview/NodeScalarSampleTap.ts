const SHADER = `
@group(0) @binding(0) var t: texture_2d<f32>;
@group(0) @binding(1) var s: sampler;
@group(0) @binding(2) var<uniform> p: array<vec4f,2>;
@group(0) @binding(3) var<storage,read_write> result: vec4f;
@compute @workgroup_size(1) fn sampleCell() {
  let size=vec2f(textureDimensions(t));
  var columns=clamp(p[1].x,4.0,240.0); if(p[1].y>0.5){columns=round(columns);}
  var rows=columns*size.y/size.x; if(p[1].y>0.5){rows=max(1.0,round(rows));}
  var uv=(floor(vec2f(columns,rows)*0.5)+0.5)/vec2f(columns,rows);
  if(p[1].y<0.5){uv.y=1.0-uv.y;}
  uv=clamp(uv*p[0].xy+p[0].zw,vec2f(0),vec2f(1));
  if(p[1].y>0.5){result=textureLoad(t,vec2u(min(uv*size,size-1.0)),0);}
  else{result=textureSampleLevel(t,s,uv,0.0);}
}`;
type Sample = [number, number, number, number];
interface Demand { stage: string; clipId: string; values: number[]; finish: (sample?: Sample) => void; timer: ReturnType<typeof setTimeout> }

/** One sampled grid cell shared by all math viewers. Transfers 16 numeric bytes,
 * with no canvas, bitmap, thumbnail or extra video decoder. */
export class NodeScalarSampleTap {
  private pending = new Map<string, Demand>();
  private cache = new Map<string, Promise<Sample | undefined>>();
  private pipelines = new WeakMap<GPUDevice, GPUComputePipeline>();
  has(stage: string) { return [...this.pending.values()].some(demand => demand.stage === stage); }
  request(stage: string, clipId: string, revision: string, uv: number[], columns: number, native: boolean) {
    const values = [...uv, columns, native ? 1 : 0, 0, 0], key = JSON.stringify([stage, revision, values]);
    const previous = this.cache.get(key); if (previous) return previous;
    if (this.pending.size >= 8) return Promise.resolve(undefined);
    const promise = new Promise<Sample | undefined>(resolve => {
      const finish = (sample?: Sample) => { const demand = this.pending.get(key); if (demand) clearTimeout(demand.timer); this.pending.delete(key); resolve(sample); };
      this.pending.set(key, { stage, clipId, values, finish, timer: setTimeout(() => finish(), 500) });
    });
    this.cache.set(key, promise);
    while (this.cache.size > 32) this.cache.delete(this.cache.keys().next().value!);
    void import('../render/renderHostPort').then(({ renderHostPort }) => renderHostPort.requestRender());
    return promise;
  }
  capture(stage: string, device: GPUDevice, encoder: GPUCommandEncoder, sampler: GPUSampler, texture: GPUTextureView) {
    const demands = [...this.pending.values()].filter(demand => demand.stage === stage);
    if (!demands.length) return;
    let pipeline = this.pipelines.get(device);
    if (!pipeline) { pipeline = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: SHADER }), entryPoint: 'sampleCell' } }); this.pipelines.set(device, pipeline); }
    for (const demand of demands) {
      // Mark as captured before the next render can enqueue the same demand.
      demand.stage = '';
      const uniform = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      const output = device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
      const readback = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      device.queue.writeBuffer(uniform, 0, new Float32Array(demand.values));
      const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: texture }, { binding: 1, resource: sampler }, { binding: 2, resource: { buffer: uniform } }, { binding: 3, resource: { buffer: output } },
      ] });
      const pass = encoder.beginComputePass(); pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.dispatchWorkgroups(1); pass.end();
      encoder.copyBufferToBuffer(output, 0, readback, 0, 16);
      queueMicrotask(() => { void readback.mapAsync(GPUMapMode.READ).then(() => {
        const values = [...new Float32Array(readback.getMappedRange())] as Sample; readback.unmap(); demand.finish(values);
      }).catch(() => demand.finish()).finally(() => { uniform.destroy(); output.destroy(); readback.destroy(); }); });
    }
  }
  cancelClip(clipId: string) { for (const demand of this.pending.values()) if (demand.clipId === clipId) demand.finish(); this.cache.clear(); }
}
export const nodeScalarSampleTap: NodeScalarSampleTap = import.meta.hot?.data?.nodeScalarSampleTap ?? new NodeScalarSampleTap();
if (import.meta.hot) import.meta.hot.dispose(data => { data.nodeScalarSampleTap = nodeScalarSampleTap; });
