import type { ComputeEffectDefinition } from './types';
import type { ComputeImagePlan, ComputeImageStage } from '../services/operators/computeImageGraph';

interface Pipelines {
  signature: string; seed: GPUComputePipeline; jump: GPUComputePipeline; resolve: GPUComputePipeline;
  seedLayout: GPUBindGroupLayout; jumpLayout: GPUBindGroupLayout; resolveLayout: GPUBindGroupLayout;
  stepBuffers: Map<number, GPUBuffer>;
}
interface Allocation { width: number; height: number; ping: GPUTexture; pong: GPUTexture }
export interface JumpFloodStageResource { view: GPUTextureView; identity: string }

/** Shared owner for both legacy Voronoi dispatch and graph-selected seed/JFA stages. */
export class JumpFloodRuntime {
  private readonly device: GPUDevice;
  private pipelines = new Map<string, Pipelines>();
  private allocations = new Map<string, Allocation>();

  constructor(device: GPUDevice) { this.device = device; }

  ensure(definition: ComputeEffectDefinition): void { this.pipeline(definition); }

  encodeLegacy(options: { encoder: GPUCommandEncoder; definition: ComputeEffectDefinition; inputView: GPUTextureView;
    outputView: GPUTextureView; uniformBuffer: GPUBuffer; width: number; height: number }): void {
    const state = this.pipeline(options.definition), allocation = this.allocation(`legacy:${options.definition.id}`, options.width, options.height);
    this.seed(options.encoder, state, options.uniformBuffer, allocation.ping.createView(), options.definition, options.width, options.height);
    const field = this.jump(options.encoder, state, options.uniformBuffer, allocation.ping.createView(),
      [allocation.pong, allocation.ping], options.definition, options.width, options.height);
    this.pass(options.encoder, state.resolve, this.device.createBindGroup({ layout: state.resolveLayout, entries: [
      { binding: 1, resource: options.inputView }, { binding: 2, resource: { buffer: options.uniformBuffer } },
      { binding: 3, resource: field }, { binding: 5, resource: options.outputView },
    ] }), options.definition, options.width, options.height, 'voronoi-resolve');
  }

  encodeStages(options: { encoder: GPUCommandEncoder; definition: ComputeEffectDefinition; plan: ComputeImagePlan;
    instanceId: string; width: number; height: number; timelineTimeSeconds: number }): ReadonlyMap<string, JumpFloodStageResource> {
    const state = this.pipeline(options.definition), outputs = new Map<string, JumpFloodStageResource>();
    for (const stage of options.plan.stages) {
      const uniform = this.stageUniform(options.definition, stage, options.width, options.height, options.timelineTimeSeconds);
      const allocation = this.allocation(`${options.instanceId}:${stage.nodeId}`, options.width, options.height);
      let view: GPUTextureView;
      if (stage.kind === 'seed') {
        view = allocation.ping.createView();
        this.seed(options.encoder, state, uniform, view, options.definition, options.width, options.height, stage.nodeId);
      } else {
        const input = outputs.get(stage.input);
        if (!input) throw new Error(`Jump Flood ${stage.nodeId} reads unavailable stage ${stage.input}.`);
        view = this.jump(options.encoder, state, uniform, input.view, [allocation.ping, allocation.pong],
          options.definition, options.width, options.height, stage.nodeId);
      }
      outputs.set(stage.nodeId, { view, identity: `${options.plan.key}:${stage.nodeId}:${options.timelineTimeSeconds}:${JSON.stringify(stage.params)}` });
    }
    return outputs;
  }

  private stageUniform(definition: ComputeEffectDefinition, stage: ComputeImageStage, width: number, height: number, time: number) {
    const packed = definition.packUniforms(stage.params, width, height, time);
    if (!packed) throw new Error(`Compute stage ${stage.nodeId} requires uniforms.`);
    const buffer = this.device.createBuffer({ size: packed.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(buffer, 0, new Float32Array(packed)); return buffer;
  }

  private seed(encoder: GPUCommandEncoder, state: Pipelines, uniform: GPUBuffer, output: GPUTextureView,
    definition: ComputeEffectDefinition, width: number, height: number, label = 'voronoi-seeds') {
    this.pass(encoder, state.seed, this.device.createBindGroup({ layout: state.seedLayout, entries: [
      { binding: 2, resource: { buffer: uniform } }, { binding: 4, resource: output },
    ] }), definition, width, height, label);
  }

  private jump(encoder: GPUCommandEncoder, state: Pipelines, uniform: GPUBuffer, sourceView: GPUTextureView,
    targets: readonly [GPUTexture, GPUTexture], definition: ComputeEffectDefinition, width: number, height: number,
    label = 'voronoi-jump'): GPUTextureView {
    let targetIndex = 0;
    let distance = 1; while (distance < Math.max(width, height)) distance *= 2;
    for (distance /= 2; distance >= 1; distance /= 2) {
      const targetView = targets[targetIndex].createView(), step = this.stepBuffer(state, distance);
      this.pass(encoder, state.jump, this.device.createBindGroup({ layout: state.jumpLayout, entries: [
        { binding: 2, resource: { buffer: uniform } }, { binding: 3, resource: sourceView },
        { binding: 4, resource: targetView }, { binding: 7, resource: { buffer: step } },
      ] }), definition, width, height, `${label}-${distance}`);
      sourceView = targetView;
      targetIndex = targetIndex === 0 ? 1 : 0;
    }
    return sourceView;
  }

  private pass(encoder: GPUCommandEncoder, pipeline: GPUComputePipeline, bindGroup: GPUBindGroup,
    definition: ComputeEffectDefinition, width: number, height: number, label: string) {
    const pass = encoder.beginComputePass({ label }); pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup);
    const [x, y] = definition.workgroupSize ?? [8, 8]; pass.dispatchWorkgroups(Math.ceil(width / x), Math.ceil(height / y)); pass.end();
  }

  private pipeline(definition: ComputeEffectDefinition): Pipelines {
    const signature = `${definition.uniformSize}\0${definition.shader}`, found = this.pipelines.get(definition.id);
    if (found?.signature === signature) { this.pipelines.delete(definition.id); this.pipelines.set(definition.id, found); return found; }
    const module = this.device.createShaderModule({ label: `compute-effect-${definition.id}-jfa`, code: definition.shader });
    const seedLayout = this.device.createBindGroupLayout({ entries: [
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float' } },
    ] });
    const jumpLayout = this.device.createBindGroupLayout({ entries: [
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float' } },
      { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    ] });
    const resolveLayout = this.device.createBindGroupLayout({ entries: [
      { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: {} },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba8unorm' } },
    ] });
    const create = (layout: GPUBindGroupLayout, entryPoint: string) => this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [layout] }), compute: { module, entryPoint },
    });
    const result = { signature, seedLayout, jumpLayout, resolveLayout, seed: create(seedLayout, 'voronoiSeedCompute'),
      jump: create(jumpLayout, 'voronoiJumpCompute'), resolve: create(resolveLayout, definition.entryPoint), stepBuffers: new Map<number, GPUBuffer>() };
    if (this.pipelines.size >= 16) this.pipelines.delete(this.pipelines.keys().next().value!);
    this.pipelines.set(definition.id, result); return result;
  }

  private allocation(key: string, width: number, height: number): Allocation {
    const found = this.allocations.get(key);
    if (found?.width === width && found.height === height) { this.allocations.delete(key); this.allocations.set(key, found); return found; }
    const create = () => this.device.createTexture({ size: [width, height], format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING });
    const result = { width, height, ping: create(), pong: create() };
    if (this.allocations.size >= 32) this.allocations.delete(this.allocations.keys().next().value!);
    this.allocations.set(key, result); return result;
  }

  private stepBuffer(state: Pipelines, distance: number) {
    const found = state.stepBuffers.get(distance); if (found) return found;
    const buffer = this.device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(buffer, 0, new Float32Array([distance, 0, 0, 0, 0, 0, 0, 0])); state.stepBuffers.set(distance, buffer); return buffer;
  }

  dispose(): void {
    for (const allocation of this.allocations.values()) { allocation.ping.destroy(); allocation.pong.destroy(); }
    for (const state of this.pipelines.values()) for (const buffer of state.stepBuffers.values()) buffer.destroy();
    this.allocations.clear(); this.pipelines.clear();
  }
}
