import type { ComputeEffectDefinition } from './types';
import { AnalogSignalRuntime } from './analog/signal-lab/AnalogSignalRuntime';
import type { AnalogSignalPlan } from '../services/operators/analogSignalGraph';
import type { ComputeImagePlan } from '../services/operators/computeImageGraph';
import { ImageGraphComputeOutputRuntime } from './ImageGraphComputeOutputRuntime';
import { JumpFloodRuntime } from './JumpFloodRuntime';

interface ComputePipelineState {
  pipeline: GPUComputePipeline;
  layout: GPUBindGroupLayout;
  signature: string;
}

export class ComputeEffectRuntime {
  private readonly device: GPUDevice;
  private states = new Map<string, ComputePipelineState>();
  private readonly analogSignalRuntime: AnalogSignalRuntime;
  private readonly jumpFloodRuntime: JumpFloodRuntime;
  private readonly imageGraphComputeOutputRuntime: ImageGraphComputeOutputRuntime;

  constructor(device: GPUDevice) {
    this.device = device;
    this.analogSignalRuntime = new AnalogSignalRuntime(device);
    this.jumpFloodRuntime = new JumpFloodRuntime(device);
    this.imageGraphComputeOutputRuntime = new ImageGraphComputeOutputRuntime(device);
  }

  ensure(definition: ComputeEffectDefinition): void {
    if (definition.computeMode === 'jump-flood') {
      this.jumpFloodRuntime.ensure(definition);
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
    computeImagePlan?: ComputeImagePlan;
    sampler?: GPUSampler;
    /** Borrowed stage resources for this encoder only; observers must not retain or destroy them. */
    onComputeImageResources?: (resources: ReadonlyMap<string, { view: GPUTextureView; identity: string }>) => void;
    onAnalogStageOutput?: (stage: import('../services/operators/analogSignalGraph').AnalogSignalStage, view: GPUTextureView, width: number, height: number) => void;
    onAnalogImageInputs?: (stage: import('../services/operators/analogSignalGraph').AnalogSignalStage | undefined,
      inputs: import('./analog/signal-lab/AnalogSignalRuntime').AnalogImagePreviewInputs) => void;
  }): boolean {
    if (options.computeImagePlan) {
      if (options.computeImagePlan.passthrough) return false;
      if (!options.instanceId || !options.sampler) {
        throw new Error('Compute image graphs require an instance ID and sampler.');
      }
      if (options.computeImagePlan.stages.length && options.definition.computeMode !== 'jump-flood') {
        throw new Error('Compute image stage graphs require a jump-flood definition.');
      }
      const resources = options.computeImagePlan.stages.length
        ? this.jumpFloodRuntime.encodeStages({ encoder: options.commandEncoder,
          definition: options.definition, plan: options.computeImagePlan, instanceId: options.instanceId,
          width: options.width, height: options.height, timelineTimeSeconds: options.timelineTimeSeconds ?? 0 })
        : new Map<string, { view: GPUTextureView; identity: string }>();
      const program = options.computeImagePlan.imageProgram;
      if (!program) throw new Error('A non-passthrough compute image graph requires a final image program.');
      const externalResources = new Map<string, { view: GPUTextureView; identity: string }>();
      for (const descriptor of program.fieldResources ?? []) {
        const resource = resources.get(descriptor.producerNodeId);
        if (!resource) throw new Error(`Compute image resource ${descriptor.resourceId} has no stage output.`);
        externalResources.set(descriptor.resourceId, resource);
      }
      options.onComputeImageResources?.(externalResources);
      this.imageGraphComputeOutputRuntime.encode({ encoder: options.commandEncoder, sampler: options.sampler,
        source: { kind: 'texture', view: options.inputView }, width: options.width, height: options.height,
        timelineTimeSeconds: options.timelineTimeSeconds ?? 0, plan: program, outputView: options.outputView,
        instanceId: `compute-image:${options.instanceId}`, externalResources });
      return true;
    }
    if (options.definition.computeMode === 'jump-flood') {
      if (!options.uniformBuffer) throw new Error('Jump-flood effects require a uniform buffer');
      this.jumpFloodRuntime.encodeLegacy({ encoder: options.commandEncoder, definition: options.definition,
        inputView: options.inputView, outputView: options.outputView, uniformBuffer: options.uniformBuffer,
        width: options.width, height: options.height });
      return true;
    }
    if (options.definition.computeMode === 'analog-signal') {
      if (!options.analogPlan || !options.instanceId) throw new Error('Analog signal effects require a compiled graph plan');
      return this.analogSignalRuntime.encode({ ...options, plan: options.analogPlan, instanceId: options.instanceId,
        timelineTimeSeconds: options.timelineTimeSeconds ?? 0, onStageOutput: options.onAnalogStageOutput,
        onImagePreviewInputs: options.onAnalogImageInputs });
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

  private dispatch(pass: GPUComputePassEncoder, definition: ComputeEffectDefinition, width: number, height: number): void {
    const [workgroupX, workgroupY] = definition.workgroupSize ?? [8, 8];
    pass.dispatchWorkgroups(Math.ceil(width / workgroupX), Math.ceil(height / workgroupY));
  }

  clear(): void {
    this.states.clear();
    this.jumpFloodRuntime.dispose();
    this.imageGraphComputeOutputRuntime.dispose();
    this.analogSignalRuntime.clear();
  }
}
