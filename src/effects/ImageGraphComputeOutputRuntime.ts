import { imageGraphLoadFunction } from './_shared/imageGraphSampling';
import { ImageGraphPassRuntime, type ImageGraphPassSource } from './ImageGraphPassRuntime';
import { imageOperatorRuntimeUniformSize, packImageOperatorRuntimeUniforms } from '../services/operators/imageOperatorRuntimeUniforms';
import type { ImageOperatorPlan } from '../services/operators/imageOperatorGraph';
import { imageGraphRuntimeDeclaration } from './_shared/imageGraphShaderRuntime';
import { imageGraphResourceDeclarations, imageGraphResourceSampleType, validateImageGraphResourceSampling } from './_shared/imageGraphShaderResources';
import type { ImageOperatorResourceMetadata } from '../services/operators/imageOperatorRuntimeUniforms';

interface ComputePipeline { pipeline: GPUComputePipeline; layout: GPUBindGroupLayout }
export interface EncodeImageGraphComputeOutputOptions {
  encoder: GPUCommandEncoder; sampler: GPUSampler; source: ImageGraphPassSource; plan: ImageOperatorPlan;
  externalResources?: ReadonlyMap<string, { view: GPUTextureView; identity: string; width?: number; height?: number; available?: boolean }>;
  outputView: GPUTextureView; width: number; height: number; timelineTimeSeconds: number; instanceId: string;
}

export function imageGraphComputeOutputShader(plan: ImageOperatorPlan): string {
  if (plan.capabilities.includes('derivative')) throw new Error('Compute image output does not support fragment derivatives.');
  if (plan.passes?.length) throw new Error('Compute image output shader expects one final program.');
  const resources = plan.resourceInputs ?? [], sampling = plan.resourceSampling;
  if (new Set(resources).size !== resources.length) throw new Error('Compute image output has invalid resource inputs.');
  validateImageGraphResourceSampling(plan);
  const resourceWgsl = imageGraphResourceDeclarations(plan);
  const needsResolution = plan.capabilities.includes('resolution'), needsTime = plan.capabilities.includes('time');
  const args = ['original', ...(plan.capabilities.includes('uv') ? ['uv'] : []),
    ...(needsResolution ? ['vec2f(dimensions)'] : []), ...(needsTime ? ['imageGraphRuntime.timelineTimeSeconds'] : []),
    ...(plan.values.length ? [needsResolution || needsTime || sampling?.includes('exact-u32-pixel-load') ? 'imageGraphRuntime.imageParameters' : 'imageParameters'] : [])];
  return `${plan.wgsl}
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var imageGraphSource: texture_2d<f32>;
@group(0) @binding(11) var imageGraphOutput: texture_storage_2d<rgba8unorm, write>;
${imageGraphRuntimeDeclaration(plan)}
${resourceWgsl}
fn sampleImageGraphSource(uv: vec2f) -> vec4f { return textureSampleLevel(imageGraphSource, texSampler, uv, 0.0); }
${plan.capabilities.includes('pixel-load') ? imageGraphLoadFunction('loadImageGraphSource', 'imageGraphSource') : ''}
@compute @workgroup_size(8, 8)
fn imageGraphComputeOutput(@builtin(global_invocation_id) id: vec3u) {
  let dimensions = textureDimensions(imageGraphOutput);
  if (id.x >= dimensions.x || id.y >= dimensions.y) { return; }
  let uv = (vec2f(id.xy) + 0.5) / vec2f(dimensions);
  let original = textureLoad(imageGraphSource, vec2i(id.xy), 0);
  textureStore(imageGraphOutput, vec2i(id.xy), evaluateImageGraph(${args.join(', ')}));
}`;
}

/** Encodes explicit rgba16 intermediates with the shared pass runtime, then
 * writes the final shared Image IR program through an rgba8 compute store. */
export class ImageGraphComputeOutputRuntime {
  private readonly device: GPUDevice;
  private readonly passRuntime: ImageGraphPassRuntime;
  private readonly pipelines = new Map<string, ComputePipeline>();
  constructor(device: GPUDevice) { this.device = device; this.passRuntime = new ImageGraphPassRuntime(device); }

  encode(options: EncodeImageGraphComputeOutputOptions): void {
    if (options.source.kind !== 'texture') throw new Error('Compute image output requires a texture source.');
    const passes = options.plan.passes, finalPass = passes?.length ? passes.at(-1)! : undefined;
    if (finalPass?.outputResource) throw new Error('Compute image graph has no final output program.');
    const program = finalPass?.program ?? options.plan;
    const resources = new Map(options.externalResources ?? []);
    if (passes && passes.length > 1) {
      const producers = passes.slice(0, -1), lastResource = producers.at(-1)?.outputResource;
      if (!lastResource) throw new Error('Compute image graph producer has no materialized output.');
      const batch = this.passRuntime.createBatch();
      this.passRuntime.encode({ ...options, plan: { ...options.plan, passes: producers }, batch,
        stopAtResourceId: lastResource, externalResources: resources });
      for (const [id, resource] of batch.resources) resources.set(id, resource);
    }
    const inputIds = finalPass?.inputResources ?? program.resourceInputs ?? [];
    const programInputs = program.resourceInputs ?? [];
    if (inputIds.length !== programInputs.length || inputIds.some((id, index) => id !== programInputs[index])) {
      throw new Error('Compute image final pass resources do not match its program inputs.');
    }
    const state = this.pipeline(program), entries: GPUBindGroupEntry[] = [
      { binding: 0, resource: options.sampler }, { binding: 1, resource: options.source.view },
      { binding: 11, resource: options.outputView },
    ];
    const metadata = new Map<string, ImageOperatorResourceMetadata>();
    for (const id of inputIds) { const value = resources.get(id);
      if (value && (value.width !== undefined || value.height !== undefined || value.available !== undefined)) {
        metadata.set(id, { width: value.width!, height: value.height!, available: value.available! });
      } }
    const packed = packImageOperatorRuntimeUniforms(program, options.timelineTimeSeconds, options.width, options.height, metadata);
    if (packed) { const buffer = this.device.createBuffer({ size: packed.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      this.device.queue.writeBuffer(buffer, 0, packed); entries.push({ binding: 2, resource: { buffer } }); }
    inputIds.forEach((id, index) => { const resource = resources.get(id);
      if (!resource) throw new Error(`Compute image output reads unavailable resource ${id}.`);
      entries.push({ binding: 3 + index, resource: resource.view }); });
    const pass = options.encoder.beginComputePass({ label: 'image-graph-compute-output' });
    pass.setPipeline(state.pipeline); pass.setBindGroup(0, this.device.createBindGroup({ layout: state.layout, entries }));
    pass.dispatchWorkgroups(Math.ceil(options.width / 8), Math.ceil(options.height / 8)); pass.end();
  }

  private pipeline(program: ImageOperatorPlan): ComputePipeline {
    const found = this.pipelines.get(program.key); if (found) return found;
    const entries: GPUBindGroupLayoutEntry[] = [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: {} },
      { binding: 11, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba8unorm' } },
    ];
    if (imageOperatorRuntimeUniformSize(program)) entries.push({ binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } });
    (program.resourceInputs ?? []).forEach((_id, index) => entries.push({ binding: 3 + index, visibility: GPUShaderStage.COMPUTE,
      texture: { sampleType: imageGraphResourceSampleType(program.resourceSampling?.[index]) } }));
    const layout = this.device.createBindGroupLayout({ entries });
    const module = this.device.createShaderModule({ code: imageGraphComputeOutputShader(program) });
    const pipeline = this.device.createComputePipeline({ layout: this.device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module, entryPoint: 'imageGraphComputeOutput' } });
    const result = { pipeline, layout }; if (this.pipelines.size >= 64) this.pipelines.delete(this.pipelines.keys().next().value!);
    this.pipelines.set(program.key, result); return result;
  }
  dispose(): void { this.passRuntime.dispose(); this.pipelines.clear(); }
}
