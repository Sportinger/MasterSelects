import commonShader from './_shared/commonShader';
import { imageGraphProgramShader } from './_shared/imageGraphDefinition';
import type { ImageOperatorPlan } from '../services/operators/imageOperatorGraph';
import { packImageOperatorRuntimeUniforms } from '../services/operators/imageOperatorRuntimeUniforms';

export type ImageGraphPassSource = { kind: 'texture'; view: GPUTextureView } | { kind: 'external'; texture: GPUExternalTexture };
export interface ImageGraphPassBatch {
  readonly encoded: Map<string, { view: GPUTextureView; identity: string }>;
  readonly resources: Map<string, { view: GPUTextureView; identity: string }>;
  readonly transientTextures: GPUTexture[];
  encoder?: GPUCommandEncoder;
  sourceResource?: GPUTextureView | GPUExternalTexture; sampler?: GPUSampler; width?: number; height?: number; timelineTimeSeconds?: number;
}
interface Allocation { width: number; height: number; topology: string; textures: Map<string, GPUTexture>; views: Map<string, GPUTextureView> }

export interface EncodeImageGraphPassesOptions {
  encoder: GPUCommandEncoder; sampler: GPUSampler; source: ImageGraphPassSource;
  width: number; height: number; timelineTimeSeconds: number; plan: ImageOperatorPlan;
  outputView?: GPUTextureView; outputFormat?: GPUTextureFormat; instanceId: string;
  stopAtResourceId?: string;
  /** Ephemeral dedupe scope. Create once per capture/encode batch and then discard. */
  batch?: ImageGraphPassBatch;
}

/** Owns transient GPU allocations for compiled multi-pass image programs. */
export class ImageGraphPassRuntime {
  private readonly device: GPUDevice;
  private readonly pipelines = new Map<string, GPURenderPipeline>();
  private readonly allocations = new Map<string, Allocation>();
  private readonly activeAllocationKeys = new Map<string, string>();
  private disposed = false;

  constructor(device: GPUDevice) {
    this.device = device;
    const owner = this;
    void device.lost.then(() => owner.dispose());
  }

  createBatch(): ImageGraphPassBatch { return { encoded: new Map(), resources: new Map(), transientTextures: [] }; }
  getBatchResourceView(batch: ImageGraphPassBatch, resourceId: string) { return batch.resources.get(resourceId)?.view; }

  encode(options: EncodeImageGraphPassesOptions): boolean {
    if (this.disposed) throw new Error('ImageGraphPassRuntime is disposed.');
    const passes = options.plan.passes;
    if (!passes?.length) return false;
    if (options.batch) {
      const sourceResource = options.source.kind === 'texture' ? options.source.view : options.source.texture;
      if (options.batch.sourceResource === undefined) Object.assign(options.batch, { encoder: options.encoder, sourceResource, sampler: options.sampler,
        width: options.width, height: options.height, timelineTimeSeconds: options.timelineTimeSeconds });
      else if (options.batch.encoder !== options.encoder || options.batch.sourceResource !== sourceResource || options.batch.sampler !== options.sampler || options.batch.width !== options.width
        || options.batch.height !== options.height || options.batch.timelineTimeSeconds !== options.timelineTimeSeconds)
        throw new Error('Image graph pass batch cannot mix source or frame context.');
    }
    if (!options.stopAtResourceId && passes.at(-1)?.outputResource) throw new Error('Multi-pass image graph has no final output pass.');
    if (options.stopAtResourceId && !(options.plan.resources ?? []).some(resource => resource.id === options.stopAtResourceId))
      throw new Error(`Image graph preview resource ${options.stopAtResourceId} is unavailable.`);
    const requiredSampledTextures = 1 + Math.max(...passes.map(pass => pass.inputResources.length));
    if (this.device.limits.maxSampledTexturesPerShaderStage < requiredSampledTextures)
      throw new Error('Device cannot bind the required image graph resources.');
    const resources = options.plan.resources ?? [];
    const descriptors = new Map(resources.map(item => [item.id, item]));
    const ids = new Set(descriptors.keys());
    const topology = `${options.plan.key}:${passes.map(pass => `${pass.id}>${pass.outputResource ?? 'final'}:${pass.inputResources.join(',')}`).join('|')}`;
    const allocation = this.allocation(options.instanceId, topology, options.width, options.height, resources);
    const produced = new Set<string>();
    const localViews = new Map<string, GPUTextureView>(), identities = new Map<string, string>();
    for (const pass of passes) {
      if (pass.inputResources.length > 8) throw new Error(`Image graph pass ${pass.id} exceeds eight resource inputs.`);
      for (const id of pass.inputResources) if (!ids.has(id) || !produced.has(id)) throw new Error(`Image graph pass ${pass.id} reads unavailable resource ${id}.`);
      const packed = packImageOperatorRuntimeUniforms(pass.program, options.timelineTimeSeconds, options.width, options.height);
      const payloadIdentity = packed ? Array.from(new Uint32Array(packed.buffer, packed.byteOffset, packed.byteLength / 4)).join(',') : '';
      const inputIdentities = pass.inputResources.map(id => identities.get(id) ?? `local:${id}`);
      const producerIdentity = pass.outputResource ? `${pass.outputResource}:${pass.program.key}:${payloadIdentity}:${inputIdentities.join('|')}` : '';
      const shared = producerIdentity ? options.batch?.encoded.get(producerIdentity) : undefined;
      if (pass.outputResource && shared) { localViews.set(pass.outputResource, shared.view); identities.set(pass.outputResource, shared.identity); produced.add(pass.outputResource);
        options.batch?.resources.set(pass.outputResource, shared); if (pass.outputResource === options.stopAtResourceId) break; continue; }
      let output = pass.outputResource ? allocation.views.get(pass.outputResource) : options.outputView;
      const priorResource = pass.outputResource ? options.batch?.resources.get(pass.outputResource) : undefined;
      if (pass.outputResource && priorResource && priorResource.identity !== producerIdentity) {
        const texture = this.device.createTexture({ size: { width: options.width, height: options.height }, format: 'rgba16float',
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
        options.batch!.transientTextures.push(texture); output = texture.createView();
      }
      if (!output) throw new Error(`Image graph pass ${pass.id} has no output resource.`);
      if (pass.outputResource && descriptors.get(pass.outputResource)?.producerPassId !== pass.id)
        throw new Error(`Image graph resource ${pass.outputResource} has the wrong producer.`);
      const pipeline = this.pipeline(pass.program, options.source.kind, pass.outputResource ? 'rgba16float' : options.outputFormat ?? 'rgba8unorm');
      const entries: GPUBindGroupEntry[] = [{ binding: 0, resource: options.sampler },
        { binding: 1, resource: options.source.kind === 'texture' ? options.source.view : options.source.texture }];
      if (packed) {
        // Bind groups/recorded commands retain the resource. Do not rewrite or retain
        // historical animated payloads in the runtime across encodes.
        const buffer = this.device.createBuffer({ size: packed.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.device.queue.writeBuffer(buffer, 0, packed);
        entries.push({ binding: 2, resource: { buffer } });
      }
      pass.inputResources.forEach((id, index) => entries.push({ binding: 3 + index, resource: localViews.get(id) ?? allocation.views.get(id)! }));
      const bind = this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries });
      const render = options.encoder.beginRenderPass({ colorAttachments: [{ view: output, loadOp: 'clear', storeOp: 'store' }] });
      render.setPipeline(pipeline); render.setBindGroup(0, bind); render.draw(6); render.end();
      if (pass.outputResource) { produced.add(pass.outputResource); localViews.set(pass.outputResource, output); identities.set(pass.outputResource, producerIdentity);
        const materialized = { view: output, identity: producerIdentity }; options.batch?.encoded.set(producerIdentity, materialized);
        options.batch?.resources.set(pass.outputResource, materialized); if (pass.outputResource === options.stopAtResourceId) break; }
    }
    return true;
  }

  private pipeline(program: ImageOperatorPlan, source: ImageGraphPassSource['kind'], format: GPUTextureFormat) {
    const key = `${source}:${format}:${program.key}`; const found = this.pipelines.get(key);
    if (found) { this.pipelines.delete(key); this.pipelines.set(key, found); return found; }
    const module = this.device.createShaderModule({ code: `${commonShader}\n${imageGraphProgramShader(program, 'imageGraphPassFragment', source)}` });
    const pipeline = this.device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vertexMain' },
      fragment: { module, entryPoint: 'imageGraphPassFragment', targets: [{ format }] }, primitive: { topology: 'triangle-list' } });
    if (this.pipelines.size >= 64) this.pipelines.delete(this.pipelines.keys().next().value!);
    this.pipelines.set(key, pipeline); return pipeline;
  }

  private allocation(instanceId: string, topology: string, width: number, height: number, resources: readonly { id: string }[]): Allocation {
    const allocationKey = `${instanceId}:${width}x${height}:${topology}`;
    const found = this.allocations.get(allocationKey);
    if (found) { this.allocations.delete(allocationKey); this.allocations.set(allocationKey, found); return found; }
    const previousKey = this.activeAllocationKeys.get(instanceId);
    if (previousKey && previousKey !== allocationKey) this.allocations.delete(previousKey);
    const next: Allocation = { width, height, topology, textures: new Map(), views: new Map() };
    for (const resource of resources) { const texture = this.device.createTexture({ size: { width, height }, format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING }); next.textures.set(resource.id, texture); next.views.set(resource.id, texture.createView()); }
    this.allocations.set(allocationKey, next); this.activeAllocationKeys.set(instanceId, allocationKey);
    if (this.allocations.size > 32) {
      const retiredKey = this.allocations.keys().next().value!; this.allocations.delete(retiredKey);
      for (const [owner, key] of this.activeAllocationKeys) if (key === retiredKey) this.activeAllocationKeys.delete(owner);
    }
    return next;
  }

  private destroyAllocation(value: Allocation) { for (const texture of value.textures.values()) texture.destroy(); }
  dispose() { if (this.disposed) return; this.disposed = true; for (const value of this.allocations.values()) this.destroyAllocation(value);
    this.activeAllocationKeys.clear(); this.allocations.clear(); this.pipelines.clear(); }
}
