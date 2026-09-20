import type { ComputeEffectDefinition } from './types';
import { AnalogSignalRuntime } from './analog/signal-lab/AnalogSignalRuntime';
import type { AnalogSignalPlan } from '../services/operators/analogSignalGraph';

interface ComputePipelineState {
  pipeline: GPUComputePipeline;
  layout: GPUBindGroupLayout;
  signature: string;
}

interface JumpFloodTextures {
  width: number;
  height: number;
  ping: GPUTexture;
  pong: GPUTexture;
}

interface JumpFloodState {
  signature: string;
  seedPipeline: GPUComputePipeline;
  jumpPipeline: GPUComputePipeline;
  resolvePipeline: GPUComputePipeline;
  seedLayout: GPUBindGroupLayout;
  jumpLayout: GPUBindGroupLayout;
  resolveLayout: GPUBindGroupLayout;
  stepBuffers: Map<number, GPUBuffer>;
  textures: JumpFloodTextures | null;
}

export class ComputeEffectRuntime {
  private readonly device: GPUDevice;
  private states = new Map<string, ComputePipelineState>();
  private jumpFloodStates = new Map<string, JumpFloodState>();
  private readonly analogSignalRuntime: AnalogSignalRuntime;

  constructor(device: GPUDevice) {
    this.device = device;
    this.analogSignalRuntime = new AnalogSignalRuntime(device);
  }

  ensure(definition: ComputeEffectDefinition): void {
    if (definition.computeMode === 'jump-flood') {
      this.ensureJumpFlood(definition);
    } else if (definition.computeMode === 'analog-signal') {
      this.analogSignalRuntime.ensure(definition);
    } else {
      this.ensureSingle(definition);
    }
  }

  private ensureSingle(definition: ComputeEffectDefinition): ComputePipelineState {
    const signature = `${definition.entryPoint}\u0000${definition.uniformSize}\u0000${definition.shader}`;
    const current = this.states.get(definition.id);
    if (current?.signature === signature) return current;
    const entries: GPUBindGroupLayoutEntry[] = [
      { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: {} },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba8unorm' } },
    ];
    if (definition.uniformSize > 0) {
      entries.push({ binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } });
    }
    const layout = this.device.createBindGroupLayout({ label: `compute-effect-${definition.id}-layout`, entries });
    const module = this.device.createShaderModule({ label: `compute-effect-${definition.id}`, code: definition.shader });
    const pipeline = this.device.createComputePipeline({
      label: `compute-effect-${definition.id}-pipeline`,
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module, entryPoint: definition.entryPoint },
    });
    const state = { pipeline, layout, signature };
    this.states.set(definition.id, state);
    return state;
  }

  private ensureJumpFlood(definition: ComputeEffectDefinition): JumpFloodState {
    const signature = `${definition.uniformSize}\u0000${definition.shader}`;
    const current = this.jumpFloodStates.get(definition.id);
    if (current?.signature === signature) return current;
    if (current) this.destroyJumpFloodState(current);
    const module = this.device.createShaderModule({ label: `compute-effect-${definition.id}-jfa`, code: definition.shader });
    const seedLayout = this.device.createBindGroupLayout({
      label: `compute-effect-${definition.id}-seed-layout`,
      entries: [
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float' } },
      ],
    });
    const jumpLayout = this.device.createBindGroupLayout({
      label: `compute-effect-${definition.id}-jump-layout`,
      entries: [
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float' } },
        { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    });
    const resolveLayout = this.device.createBindGroupLayout({
      label: `compute-effect-${definition.id}-resolve-layout`,
      entries: [
        { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: {} },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba8unorm' } },
      ],
    });
    const pipeline = (label: string, layout: GPUBindGroupLayout, entryPoint: string) => this.device.createComputePipeline({
      label,
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module, entryPoint },
    });
    const state: JumpFloodState = {
      signature,
      seedLayout,
      jumpLayout,
      resolveLayout,
      seedPipeline: pipeline(`compute-effect-${definition.id}-seed`, seedLayout, 'voronoiSeedCompute'),
      jumpPipeline: pipeline(`compute-effect-${definition.id}-jump`, jumpLayout, 'voronoiJumpCompute'),
      resolvePipeline: pipeline(`compute-effect-${definition.id}-resolve`, resolveLayout, definition.entryPoint),
      stepBuffers: new Map(),
      textures: null,
    };
    this.jumpFloodStates.set(definition.id, state);
    return state;
  }

  encode(options: {
    commandEncoder: GPUCommandEncoder;
    definition: ComputeEffectDefinition;
    inputView: GPUTextureView;
    outputView: GPUTextureView;
    uniformBuffer: GPUBuffer | null;
    width: number;
    height: number;
    analogPlan?: AnalogSignalPlan;
    instanceId?: string;
    timelineTimeSeconds?: number;
    onAnalogStageOutput?: (stage: import('../services/operators/analogSignalGraph').AnalogSignalStage, view: GPUTextureView, width: number, height: number) => void;
  }): boolean {
    if (options.definition.computeMode === 'jump-flood') {
      this.encodeJumpFlood(options);
      return true;
    }
    if (options.definition.computeMode === 'analog-signal') {
      if (!options.analogPlan || !options.instanceId) throw new Error('Analog signal effects require a compiled graph plan');
      return this.analogSignalRuntime.encode({ ...options, plan: options.analogPlan, instanceId: options.instanceId,
        timelineTimeSeconds: options.timelineTimeSeconds ?? 0, onStageOutput: options.onAnalogStageOutput });
    }
    const state = this.ensureSingle(options.definition);
    const entries: GPUBindGroupEntry[] = [
      { binding: 1, resource: options.inputView },
      { binding: 5, resource: options.outputView },
    ];
    if (options.uniformBuffer) entries.push({ binding: 2, resource: { buffer: options.uniformBuffer } });
    const bindGroup = this.device.createBindGroup({ layout: state.layout, entries });
    const pass = options.commandEncoder.beginComputePass({ label: `compute-effect-${options.definition.id}` });
    pass.setPipeline(state.pipeline);
    pass.setBindGroup(0, bindGroup);
    this.dispatch(pass, options.definition, options.width, options.height);
    pass.end();
    return true;
  }

  private encodeJumpFlood(options: {
    commandEncoder: GPUCommandEncoder;
    definition: ComputeEffectDefinition;
    inputView: GPUTextureView;
    outputView: GPUTextureView;
    uniformBuffer: GPUBuffer | null;
    width: number;
    height: number;
  }): void {
    if (!options.uniformBuffer) throw new Error('Jump-flood effects require a uniform buffer');
    const state = this.ensureJumpFlood(options.definition);
    const textures = this.ensureJumpFloodTextures(state, options.width, options.height);
    let source = textures.ping;
    let target = textures.pong;
    this.encodePass(options.commandEncoder, state.seedPipeline, this.device.createBindGroup({
      layout: state.seedLayout,
      entries: [
        { binding: 2, resource: { buffer: options.uniformBuffer } },
        { binding: 4, resource: textures.ping.createView() },
      ],
    }), options.definition, options.width, options.height, 'voronoi-seeds');

    let distance = 1;
    while (distance < Math.max(options.width, options.height)) distance *= 2;
    for (distance /= 2; distance >= 1; distance /= 2) {
      const stepBuffer = this.getJumpStepBuffer(state, distance);
      this.encodePass(options.commandEncoder, state.jumpPipeline, this.device.createBindGroup({
        layout: state.jumpLayout,
        entries: [
          { binding: 2, resource: { buffer: options.uniformBuffer } },
          { binding: 3, resource: source.createView() },
          { binding: 4, resource: target.createView() },
          { binding: 7, resource: { buffer: stepBuffer } },
        ],
      }), options.definition, options.width, options.height, `voronoi-jump-${distance}`);
      [source, target] = [target, source];
    }

    this.encodePass(options.commandEncoder, state.resolvePipeline, this.device.createBindGroup({
      layout: state.resolveLayout,
      entries: [
        { binding: 1, resource: options.inputView },
        { binding: 2, resource: { buffer: options.uniformBuffer } },
        { binding: 3, resource: source.createView() },
        { binding: 5, resource: options.outputView },
      ],
    }), options.definition, options.width, options.height, 'voronoi-resolve');
  }

  private encodePass(
    encoder: GPUCommandEncoder,
    pipeline: GPUComputePipeline,
    bindGroup: GPUBindGroup,
    definition: ComputeEffectDefinition,
    width: number,
    height: number,
    label: string,
  ): void {
    const pass = encoder.beginComputePass({ label });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    this.dispatch(pass, definition, width, height);
    pass.end();
  }

  private dispatch(pass: GPUComputePassEncoder, definition: ComputeEffectDefinition, width: number, height: number): void {
    const [workgroupX, workgroupY] = definition.workgroupSize ?? [8, 8];
    pass.dispatchWorkgroups(Math.ceil(width / workgroupX), Math.ceil(height / workgroupY));
  }

  private ensureJumpFloodTextures(state: JumpFloodState, width: number, height: number): JumpFloodTextures {
    if (state.textures?.width === width && state.textures.height === height) return state.textures;
    state.textures?.ping.destroy();
    state.textures?.pong.destroy();
    const create = (label: string) => this.device.createTexture({
      label,
      size: [width, height],
      format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    });
    state.textures = { width, height, ping: create('voronoi-seed-ping'), pong: create('voronoi-seed-pong') };
    return state.textures;
  }

  private getJumpStepBuffer(state: JumpFloodState, distance: number): GPUBuffer {
    const existing = state.stepBuffers.get(distance);
    if (existing) return existing;
    const buffer = this.device.createBuffer({
      label: `voronoi-jump-step-${distance}`,
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(buffer, 0, new Float32Array([distance, 0, 0, 0, 0, 0, 0, 0]));
    state.stepBuffers.set(distance, buffer);
    return buffer;
  }

  private destroyJumpFloodState(state: JumpFloodState): void {
    state.textures?.ping.destroy();
    state.textures?.pong.destroy();
    for (const buffer of state.stepBuffers.values()) buffer.destroy();
  }

  clear(): void {
    this.states.clear();
    for (const state of this.jumpFloodStates.values()) this.destroyJumpFloodState(state);
    this.jumpFloodStates.clear();
    this.analogSignalRuntime.clear();
  }
}
