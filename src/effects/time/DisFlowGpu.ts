import { DIS_FLOW_WGSL } from './disFlowShaders';
import type { ResidentMotionFrames } from './residentMotionFrames';

type Stage = 'extract' | 'downsample' | 'search' | 'densify' | 'storeFlow';
type Level = { width: number; height: number; a: GPUTexture; b: GPUTexture;
  patches: GPUTexture[]; forward: GPUTexture; backward: GPUTexture };

/** Scratch belongs to the analysis device, not the effect graph or project.
 * Every pair is submitted before yielding; no borrowed decoder handles survive. */
export class DisFlowGpu {
  private levels: Level[] = [];
  private empty: GPUTexture;
  private sampler: GPUSampler;
  private device: GPUDevice;
  private pipelines: Record<Stage, GPUComputePipeline>;
  private constructor(device: GPUDevice, width: number, height: number,
    pipelines: Record<Stage, GPUComputePipeline>) {
    this.device = device; this.pipelines = pipelines;
    this.sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    this.empty = this.texture(1, 1);
    for (let i = 0; i < 4; i++) {
      this.levels.push({ width, height, a: this.texture(width,height), b: this.texture(width,height),
        patches: [this.texture(Math.ceil(width/4),Math.ceil(height/4)), this.texture(Math.ceil(width/4),Math.ceil(height/4))],
        forward: this.texture(width,height), backward: this.texture(width,height) });
      if (Math.min(width,height) < 32) break;
      width = Math.ceil(width/2); height = Math.ceil(height/2);
    }
  }

  static async create(device: GPUDevice, width: number, height: number) {
    const module = device.createShaderModule({ label: 'DIS inverse search', code: DIS_FLOW_WGSL });
    const compilation = await module.getCompilationInfo();
    const errors = compilation.messages.filter(message => message.type === 'error');
    if (errors.length) throw new Error(errors.map(message => `DIS shader ${message.lineNum}:${message.linePos}: ${message.message}`).join('\n'));
    const names: Stage[] = ['extract','downsample','search','densify','storeFlow'];
    const pipelines = await Promise.all(names.map(entryPoint => device.createComputePipelineAsync({
      label: `DIS ${entryPoint}`, layout: 'auto', compute: { module, entryPoint } })));
    device.pushErrorScope('out-of-memory'); device.pushErrorScope('validation');
    let gpu: DisFlowGpu | undefined;
    try {
      gpu = new DisFlowGpu(device,width,height,Object.fromEntries(names.map((name,i) => [name,pipelines[i]])) as Record<Stage,GPUComputePipeline>);
    } finally {
      const errors = await Promise.all([device.popErrorScope(),device.popErrorScope()]);
      const error = errors.find(Boolean);
      if (error) { gpu?.destroy(); throw new Error(`DIS scratch: ${error.message}`); }
    }
    return gpu!;
  }

  private texture(width: number, height: number) {
    return this.device.createTexture({ label: 'DIS scratch', size: [width,height], format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING });
  }

  async pair(snapshot: ResidentMotionFrames, time: number, targetTime: number, volume: GPUTexture, backwardVolume?: GPUTexture) {
    const slot = snapshot.slots.get(time)!, targetSlot = snapshot.slots.get(targetTime)!;
    if (slot === undefined || targetSlot === undefined) throw new Error('DIS source pair is no longer resident.');
    const buffers: GPUBuffer[] = [];
    this.device.pushErrorScope('out-of-memory'); this.device.pushErrorScope('validation');
    let failure: unknown;
    try {
      const encoder = this.device.createCommandEncoder({ label: 'DIS adjacent source pair' });
      const uniform = (sourceSlot: number, stage = 0) => {
        const data = new ArrayBuffer(48), integers = new Uint32Array(data), floats = new Float32Array(data);
        integers.set([snapshot.width,snapshot.height,snapshot.width,snapshot.height,snapshot.columns,snapshot.rows,sourceSlot,targetSlot]);
        floats[8] = stage === 2 ? time-targetTime : targetTime-time; integers[9] = stage;
        const buffer = this.device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.device.queue.writeBuffer(buffer,0,data); buffers.push(buffer); return { buffer };
      };
      const first = uniform(slot), second = uniform(targetSlot), propagated = uniform(slot,1);
      const dispatch = (stage: Stage, width: number, height: number, bindings: [number, GPUBindingResource][]) => {
        const pipeline = this.pipelines[stage];
        const group = this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0),
          entries: bindings.map(([binding,resource]) => ({ binding,resource })) });
        const pass = encoder.beginComputePass({ label: `DIS ${stage}` });
        pass.setPipeline(pipeline); pass.setBindGroup(0,group); pass.dispatchWorkgroups(Math.ceil(width/8),Math.ceil(height/8)); pass.end();
      };
      const base = this.levels[0], source = snapshot.atlas.createView({ dimension: '2d-array' });
      dispatch('extract',base.width,base.height,[[0,first],[1,source],[6,base.a.createView()]]);
      dispatch('extract',base.width,base.height,[[0,second],[1,source],[6,base.b.createView()]]);
      for (let i = 1; i < this.levels.length; i++) {
        const level = this.levels[i], previous = this.levels[i-1];
        for (const channel of ['a','b'] as const) dispatch('downsample',level.width,level.height,
          [[2,previous[channel].createView()],[6,level[channel].createView()]]);
      }
      for (const direction of ['forward','backward'] as const) {
        for (let i = this.levels.length-1; i >= 0; i--) {
          const level = this.levels[i], coarse = this.levels[i+1]?.[direction] ?? this.empty;
          const reference = (direction === 'forward' ? level.a : level.b).createView();
          const target = (direction === 'forward' ? level.b : level.a).createView();
          for (let step = 0; step < 2; step++) dispatch('search',Math.ceil(level.width/4),Math.ceil(level.height/4),
            [[0,step ? propagated : first],[2,reference],[3,target],[4,coarse.createView()],
              [5,(step ? level.patches[0] : this.empty).createView()],[6,level.patches[step].createView()],[7,this.sampler]]);
          dispatch('densify',level.width,level.height,[[2,reference],[3,target],[5,level.patches[1].createView()],
            [6,level[direction].createView()],[7,this.sampler]]);
        }
      }
      dispatch('storeFlow',base.width,base.height,[[0,first],[4,base.forward.createView()],
        [5,base.backward.createView()],[7,this.sampler],[8,volume.createView({ dimension: '2d-array' })]]);
      if (backwardVolume) dispatch('storeFlow',base.width,base.height,[[0,uniform(slot,2)],[4,base.backward.createView()],
        [5,base.forward.createView()],[7,this.sampler],[8,backwardVolume.createView({ dimension: '2d-array' })]]);
      this.device.queue.submit([encoder.finish()]);
    } catch (error) { failure = error; }
    const checks = Promise.all([this.device.popErrorScope(),this.device.popErrorScope()]);
    try {
      const errors = await checks;
      await this.device.queue.onSubmittedWorkDone();
      if (failure) throw failure;
      const error = errors.find(Boolean); if (error) throw new Error(`DIS: ${error.message}`);
    } finally { for (const buffer of buffers) buffer.destroy(); }
  }

  destroy() {
    this.empty.destroy();
    for (const level of this.levels) for (const texture of [level.a,level.b,...level.patches,level.forward,level.backward]) texture.destroy();
    this.levels = [];
  }
}
