import type { ComputeEffectDefinition } from './types';

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

const ANALOG_SIGNAL_WIDTH = 864;
const ANALOG_SIGNAL_HEIGHT = 313;
const ANALOG_DECODED_WIDTH = 360;
const ANALOG_DECODED_HEIGHT = 288;

interface AnalogSignalTextures {
  encoded: GPUTexture;
  received: GPUTexture;
  tape: GPUTexture;
  decoded: GPUTexture;
  lineState: GPUBuffer;
}

interface AnalogSignalState {
  signature: string;
  encodePipeline: GPUComputePipeline;
  channelPipeline: GPUComputePipeline;
  tapePipeline: GPUComputePipeline;
  analyzePipeline: GPUComputePipeline;
  decodePipeline: GPUComputePipeline;
  resolvePipeline: GPUComputePipeline;
  encodeLayout: GPUBindGroupLayout;
  transformLayout: GPUBindGroupLayout;
  analyzeLayout: GPUBindGroupLayout;
  decodeLayout: GPUBindGroupLayout;
  resolveLayout: GPUBindGroupLayout;
  textures: AnalogSignalTextures;
}

export class ComputeEffectRuntime {
  private readonly device: GPUDevice;
  private states = new Map<string, ComputePipelineState>();
  private jumpFloodStates = new Map<string, JumpFloodState>();
  private analogSignalStates = new Map<string, AnalogSignalState>();

  constructor(device: GPUDevice) {
    this.device = device;
  }

  ensure(definition: ComputeEffectDefinition): void {
    if (definition.computeMode === 'jump-flood') {
      this.ensureJumpFlood(definition);
    } else if (definition.computeMode === 'analog-signal') {
      this.ensureAnalogSignal(definition);
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

  private ensureAnalogSignal(definition: ComputeEffectDefinition): AnalogSignalState {
    const signature = `${definition.uniformSize}\u0000${definition.shader}`;
    const current = this.analogSignalStates.get(definition.id);
    if (current?.signature === signature) return current;
    if (current) this.destroyAnalogSignalState(current);

    const module = this.device.createShaderModule({
      label: `compute-effect-${definition.id}-analog-signal`,
      code: definition.shader,
    });
    const uniformEntry: GPUBindGroupLayoutEntry = {
      binding: 2,
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type: 'uniform' },
    };
    const encodeLayout = this.device.createBindGroupLayout({
      label: `compute-effect-${definition.id}-analog-encode-layout`,
      entries: [
        { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: {} },
        uniformEntry,
        { binding: 4, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float' } },
      ],
    });
    const transformLayout = this.device.createBindGroupLayout({
      label: `compute-effect-${definition.id}-analog-transform-layout`,
      entries: [
        uniformEntry,
        { binding: 3, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float' } },
      ],
    });
    const analyzeLayout = this.device.createBindGroupLayout({
      label: `compute-effect-${definition.id}-analog-analyze-layout`,
      entries: [
        uniformEntry,
        { binding: 3, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    const decodeLayout = this.device.createBindGroupLayout({
      label: `compute-effect-${definition.id}-analog-decode-layout`,
      entries: [
        uniformEntry,
        { binding: 3, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float' } },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    const resolveLayout = this.device.createBindGroupLayout({
      label: `compute-effect-${definition.id}-analog-resolve-layout`,
      entries: [
        { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: {} },
        uniformEntry,
        { binding: 3, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba8unorm' } },
      ],
    });
    const pipeline = (label: string, layout: GPUBindGroupLayout, entryPoint: string) => this.device.createComputePipeline({
      label,
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module, entryPoint },
    });
    const state: AnalogSignalState = {
      signature,
      encodeLayout,
      transformLayout,
      analyzeLayout,
      decodeLayout,
      resolveLayout,
      encodePipeline: pipeline(`compute-effect-${definition.id}-pal-encode`, encodeLayout, 'palEncodeCompute'),
      channelPipeline: pipeline(`compute-effect-${definition.id}-rf-channel`, transformLayout, 'rfChannelCompute'),
      tapePipeline: pipeline(`compute-effect-${definition.id}-vhs-transport`, transformLayout, 'vhsTransportCompute'),
      analyzePipeline: pipeline(`compute-effect-${definition.id}-receiver-analyze`, analyzeLayout, 'receiverAnalyzeCompute'),
      decodePipeline: pipeline(`compute-effect-${definition.id}-pal-decode`, decodeLayout, 'palDecodeCompute'),
      resolvePipeline: pipeline(`compute-effect-${definition.id}-display-resolve`, resolveLayout, definition.entryPoint),
      textures: this.createAnalogSignalTextures(definition.id),
    };
    this.analogSignalStates.set(definition.id, state);
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
  }): void {
    if (options.definition.computeMode === 'jump-flood') {
      this.encodeJumpFlood(options);
      return;
    }
    if (options.definition.computeMode === 'analog-signal') {
      this.encodeAnalogSignal(options);
      return;
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
  }

  private encodeAnalogSignal(options: {
    commandEncoder: GPUCommandEncoder;
    definition: ComputeEffectDefinition;
    inputView: GPUTextureView;
    outputView: GPUTextureView;
    uniformBuffer: GPUBuffer | null;
    width: number;
    height: number;
  }): void {
    if (!options.uniformBuffer) throw new Error('Analog signal effects require a uniform buffer');
    const state = this.ensureAnalogSignal(options.definition);
    const textures = state.textures;

    this.encodePassAtSize(options.commandEncoder, state.encodePipeline, this.device.createBindGroup({
      layout: state.encodeLayout,
      entries: [
        { binding: 1, resource: options.inputView },
        { binding: 2, resource: { buffer: options.uniformBuffer } },
        { binding: 4, resource: textures.encoded.createView() },
      ],
    }), ANALOG_SIGNAL_WIDTH, ANALOG_SIGNAL_HEIGHT, 'analog-pal-encode');

    this.encodePassAtSize(options.commandEncoder, state.channelPipeline, this.device.createBindGroup({
      layout: state.transformLayout,
      entries: [
        { binding: 2, resource: { buffer: options.uniformBuffer } },
        { binding: 3, resource: textures.encoded.createView() },
        { binding: 4, resource: textures.received.createView() },
      ],
    }), ANALOG_SIGNAL_WIDTH, ANALOG_SIGNAL_HEIGHT, 'analog-rf-channel');

    this.encodePassAtSize(options.commandEncoder, state.tapePipeline, this.device.createBindGroup({
      layout: state.transformLayout,
      entries: [
        { binding: 2, resource: { buffer: options.uniformBuffer } },
        { binding: 3, resource: textures.received.createView() },
        { binding: 4, resource: textures.tape.createView() },
      ],
    }), ANALOG_SIGNAL_WIDTH, ANALOG_SIGNAL_HEIGHT, 'analog-vhs-transport');

    const analyzePass = options.commandEncoder.beginComputePass({ label: 'analog-receiver-analyze' });
    analyzePass.setPipeline(state.analyzePipeline);
    analyzePass.setBindGroup(0, this.device.createBindGroup({
      layout: state.analyzeLayout,
      entries: [
        { binding: 2, resource: { buffer: options.uniformBuffer } },
        { binding: 3, resource: textures.tape.createView() },
        { binding: 6, resource: { buffer: textures.lineState } },
      ],
    }));
    analyzePass.dispatchWorkgroups(1, ANALOG_SIGNAL_HEIGHT);
    analyzePass.end();

    this.encodePassAtSize(options.commandEncoder, state.decodePipeline, this.device.createBindGroup({
      layout: state.decodeLayout,
      entries: [
        { binding: 2, resource: { buffer: options.uniformBuffer } },
        { binding: 3, resource: textures.tape.createView() },
        { binding: 4, resource: textures.decoded.createView() },
        { binding: 6, resource: { buffer: textures.lineState } },
      ],
    }), ANALOG_DECODED_WIDTH, ANALOG_DECODED_HEIGHT, 'analog-pal-decode');

    this.encodePassAtSize(options.commandEncoder, state.resolvePipeline, this.device.createBindGroup({
      layout: state.resolveLayout,
      entries: [
        { binding: 1, resource: options.inputView },
        { binding: 2, resource: { buffer: options.uniformBuffer } },
        { binding: 3, resource: textures.decoded.createView() },
        { binding: 5, resource: options.outputView },
      ],
    }), options.width, options.height, 'analog-display-resolve');
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

  private encodePassAtSize(
    encoder: GPUCommandEncoder,
    pipeline: GPUComputePipeline,
    bindGroup: GPUBindGroup,
    width: number,
    height: number,
    label: string,
  ): void {
    const pass = encoder.beginComputePass({ label });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
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

  private createAnalogSignalTextures(effectId: string): AnalogSignalTextures {
    const createSignalTexture = (stage: string) => this.device.createTexture({
      label: `compute-effect-${effectId}-analog-${stage}`,
      size: [ANALOG_SIGNAL_WIDTH, ANALOG_SIGNAL_HEIGHT],
      format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    });
    return {
      encoded: createSignalTexture('encoded'),
      received: createSignalTexture('received'),
      tape: createSignalTexture('tape'),
      decoded: this.device.createTexture({
        label: `compute-effect-${effectId}-analog-decoded`,
        size: [ANALOG_DECODED_WIDTH, ANALOG_DECODED_HEIGHT],
        format: 'rgba16float',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
      }),
      lineState: this.device.createBuffer({
        label: `compute-effect-${effectId}-analog-line-state`,
        size: ANALOG_SIGNAL_HEIGHT * 4 * Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.STORAGE,
      }),
    };
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

  private destroyAnalogSignalState(state: AnalogSignalState): void {
    state.textures.encoded.destroy();
    state.textures.received.destroy();
    state.textures.tape.destroy();
    state.textures.decoded.destroy();
    state.textures.lineState.destroy();
  }

  clear(): void {
    this.states.clear();
    for (const state of this.jumpFloodStates.values()) this.destroyJumpFloodState(state);
    this.jumpFloodStates.clear();
    for (const state of this.analogSignalStates.values()) this.destroyAnalogSignalState(state);
    this.analogSignalStates.clear();
  }
}
