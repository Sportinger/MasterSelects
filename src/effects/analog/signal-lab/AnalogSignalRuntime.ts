import type { ComputeEffectDefinition } from '../../types';
import type { AnalogSignalPlan, AnalogSignalStage, AnalogSignalStageKind } from '../../../services/operators/analogSignalGraph';

interface PipelineState {
  signature: string;
  pipelines: Record<AnalogSignalStageKind, GPUComputePipeline>;
  layouts: Record<AnalogSignalStageKind, GPUBindGroupLayout>;
}
interface InstanceResources {
  planKey: string;
  textures: Map<string, GPUTexture>;
  lineStates: Map<string, GPUBuffer>;
  uniformBuffers: Map<string, GPUBuffer>;
}

const SIGNAL_SIZE = [864, 313] as const;
const DECODED_SIZE = [360, 288] as const;

export class AnalogSignalRuntime {
  private readonly device: GPUDevice;
  private pipelineState?: PipelineState;
  private resources = new Map<string, InstanceResources>();
  constructor(device: GPUDevice) { this.device = device; }

  ensure(definition: ComputeEffectDefinition): void { this.ensurePipelines(definition); }

  encode(options: {
    commandEncoder: GPUCommandEncoder; definition: ComputeEffectDefinition; plan: AnalogSignalPlan;
    instanceId: string; inputView: GPUTextureView; outputView: GPUTextureView;
    width: number; height: number; timelineTimeSeconds: number;
    onStageOutput?: (stage: AnalogSignalStage, view: GPUTextureView, width: number, height: number) => void;
  }): boolean {
    if (options.plan.passthrough || options.plan.stages.length === 0) return false;
    const state = this.ensurePipelines(options.definition);
    const resources = this.ensureResources(options.instanceId, options.plan);
    for (const stage of options.plan.stages) {
      const uniform = this.writeStageUniform(options.definition, resources, stage, options.width, options.height, options.timelineTimeSeconds);
      if (stage.kind === 'analyze') {
        const input = this.requireTexture(resources, stage.input, stage);
        const lineState = resources.lineStates.get(stage.nodeId)!;
        const pass = options.commandEncoder.beginComputePass({ label: `analog-${stage.nodeId}-analyze` });
        pass.setPipeline(state.pipelines.analyze);
        pass.setBindGroup(0, this.device.createBindGroup({ layout: state.layouts.analyze, entries: [
          { binding: 2, resource: { buffer: uniform } }, { binding: 3, resource: input.createView() }, { binding: 6, resource: { buffer: lineState } },
        ] }));
        pass.dispatchWorkgroups(1, SIGNAL_SIZE[1]); pass.end(); continue;
      }
      const output = stage.kind === 'resolve' ? options.outputView : resources.textures.get(stage.nodeId)!.createView();
      const entries: GPUBindGroupEntry[] = [{ binding: 2, resource: { buffer: uniform } }];
      if (stage.kind === 'encode') {
        this.requireExternalSource(resources, stage.input, stage);
        entries.push({ binding: 1, resource: options.inputView }, { binding: 4, resource: output });
      }
      else if (stage.kind === 'decode') entries.push(
        { binding: 3, resource: this.requireTexture(resources, stage.input, stage).createView() }, { binding: 4, resource: output },
        { binding: 6, resource: { buffer: this.requireLineState(resources, stage.receiver, stage) } });
      else if (stage.kind === 'resolve') {
        this.requireExternalSource(resources, stage.source, stage);
        entries.push({ binding: 1, resource: options.inputView }, { binding: 3, resource: this.requireTexture(resources, stage.input, stage).createView() }, { binding: 5, resource: output });
      }
      else entries.push({ binding: 3, resource: this.requireTexture(resources, stage.input, stage).createView() }, { binding: 4, resource: output });
      const [width, height] = stage.kind === 'resolve' ? [options.width, options.height]
        : stage.kind === 'decode' ? DECODED_SIZE : SIGNAL_SIZE;
      const pass = options.commandEncoder.beginComputePass({ label: `analog-${stage.nodeId}-${stage.kind}` });
      pass.setPipeline(state.pipelines[stage.kind]);
      pass.setBindGroup(0, this.device.createBindGroup({ layout: state.layouts[stage.kind], entries }));
      pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8)); pass.end();
      options.onStageOutput?.(stage, output, width, height);
    }
    return true;
  }

  clear(): void {
    for (const resources of this.resources.values()) this.destroyResources(resources);
    this.resources.clear(); this.pipelineState = undefined;
  }

  private ensurePipelines(definition: ComputeEffectDefinition): PipelineState {
    const signature = `${definition.uniformSize}\0${definition.shader}`;
    if (this.pipelineState?.signature === signature) return this.pipelineState;
    this.clear();
    const uniform: GPUBindGroupLayoutEntry = { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } };
    const layout = (entries: GPUBindGroupLayoutEntry[]) => this.device.createBindGroupLayout({ entries });
    const layouts: Record<AnalogSignalStageKind, GPUBindGroupLayout> = {
      encode: layout([{ binding: 1, visibility: GPUShaderStage.COMPUTE, texture: {} }, uniform, { binding: 4, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float' } }]),
      rf: layout([uniform, { binding: 3, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } }, { binding: 4, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float' } }]),
      vhs: undefined as never, analyze: layout([uniform, { binding: 3, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } }, { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }]),
      decode: layout([uniform, { binding: 3, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } }, { binding: 4, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float' } }, { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }]),
      resolve: layout([{ binding: 1, visibility: GPUShaderStage.COMPUTE, texture: {} }, uniform, { binding: 3, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } }, { binding: 5, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba8unorm' } }]),
    };
    layouts.vhs = layouts.rf;
    const module = this.device.createShaderModule({ code: definition.shader });
    const make = (kind: AnalogSignalStageKind, entryPoint: string) => this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [layouts[kind]] }), compute: { module, entryPoint },
    });
    const pipelines = { encode: make('encode', 'palEncodeCompute'), rf: make('rf', 'rfChannelCompute'), vhs: make('vhs', 'vhsTransportCompute'),
      analyze: make('analyze', 'receiverAnalyzeCompute'), decode: make('decode', 'palDecodeCompute'), resolve: make('resolve', definition.entryPoint) };
    return this.pipelineState = { signature, layouts, pipelines };
  }

  private ensureResources(instanceId: string, plan: AnalogSignalPlan): InstanceResources {
    const resourceKey = JSON.stringify(plan.stages.map(stage => [stage.nodeId, stage.kind, stage.input, stage.source, stage.receiver]));
    const current = this.resources.get(instanceId); if (current?.planKey === resourceKey) return current;
    if (current) this.destroyResources(current);
    const result: InstanceResources = { planKey: resourceKey, textures: new Map(), lineStates: new Map(), uniformBuffers: new Map() };
    for (const stage of plan.stages) {
      if (stage.kind === 'encode' || stage.kind === 'rf' || stage.kind === 'vhs') result.textures.set(stage.nodeId, this.createTexture(stage.nodeId, ...SIGNAL_SIZE));
      if (stage.kind === 'decode') result.textures.set(stage.nodeId, this.createTexture(stage.nodeId, ...DECODED_SIZE));
      if (stage.kind === 'analyze') result.lineStates.set(stage.nodeId, this.device.createBuffer({ size: SIGNAL_SIZE[1] * 16, usage: GPUBufferUsage.STORAGE, label: `analog-${stage.nodeId}-lines` }));
    }
    this.resources.set(instanceId, result); return result;
  }

  private createTexture(nodeId: string, width: number, height: number): GPUTexture {
    return this.device.createTexture({ label: `analog-${nodeId}`, size: [width, height], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING });
  }
  private writeStageUniform(definition: ComputeEffectDefinition, resources: InstanceResources, stage: AnalogSignalStage, width: number, height: number, time: number): GPUBuffer {
    const data = definition.packUniforms(stage.params, width, height, time) as Float32Array;
    let buffer = resources.uniformBuffers.get(stage.nodeId);
    if (!buffer) { buffer = this.device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); resources.uniformBuffers.set(stage.nodeId, buffer); }
    this.device.queue.writeBuffer(buffer, 0, data.buffer, data.byteOffset, data.byteLength); return buffer;
  }
  private requireTexture(resources: InstanceResources, id: string | undefined, stage: AnalogSignalStage): GPUTexture {
    const texture = id ? resources.textures.get(id) : undefined; if (!texture) throw new Error(`Analog ${stage.kind} ${stage.nodeId} has no texture predecessor`); return texture;
  }
  private requireLineState(resources: InstanceResources, id: string | undefined, stage: AnalogSignalStage): GPUBuffer {
    const buffer = id ? resources.lineStates.get(id) : undefined; if (!buffer) throw new Error(`Analog ${stage.kind} ${stage.nodeId} has no receiver analysis`); return buffer;
  }
  private requireExternalSource(resources: InstanceResources, id: string | undefined, stage: AnalogSignalStage): void {
    if (!id || resources.textures.has(id)) throw new Error(`Analog ${stage.kind} ${stage.nodeId} requires the external frame source`);
  }
  private destroyResources(resources: InstanceResources): void {
    for (const texture of resources.textures.values()) texture.destroy();
    for (const buffer of [...resources.lineStates.values(), ...resources.uniformBuffers.values()]) buffer.destroy();
  }
}
