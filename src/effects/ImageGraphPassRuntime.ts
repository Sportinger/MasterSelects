import commonShader from './_shared/commonShader';
import { imageGraphProgramShader } from './_shared/imageGraphDefinition';
import type { ImageOperatorPlan } from '../services/operators/imageOperatorGraph';
import { imageOperatorRuntimeUniformSize, packImageOperatorRuntimeUniforms, type ImageOperatorResourceMetadata } from '../services/operators/imageOperatorRuntimeUniforms';
import { imageGraphResourceSampleType, imageGraphResourceViewDimension } from './_shared/imageGraphShaderResources';
import { motionAnalysisMaxEdge } from './time/motionAnalysisQuality';
import { createCheckedPipeline } from '../engine/core/gpuPipelineGuard';
import { EffectGpuPipelineError } from './effectGpuFailures';
import { Logger } from '../services/logger';
import { imageResourceSize } from '../services/operators/imageResourceScale';

const log = Logger.create('ImageGraphPassRuntime');

export type ImageGraphPassSource = { kind: 'texture'; view: GPUTextureView } | { kind: 'external'; texture: GPUExternalTexture };
export interface ImageGraphPassBatch {
  readonly encoded: Map<string, { view: GPUTextureView; identity: string }>;
  readonly resources: Map<string, { view: GPUTextureView; identity: string }>;
  /** Pooled pass textures this batch holds until `releaseBatch` or the next encoder. */
  readonly leases: PassTextureLease[];
  /** Set by `releaseBatch`: its views may already hold another effect's pass output. */
  released?: boolean;
  encoder?: GPUCommandEncoder;
  sourceResource?: GPUTextureView | GPUExternalTexture; sampler?: GPUSampler; width?: number; height?: number; timelineTimeSeconds?: number;
}
export interface ImageGraphExternalResource {
  view: GPUTextureView;
  identity: string;
  width?: number;
  height?: number;
  available?: boolean;
  disTrajectory?: import('./time/DisTrajectory').DisTrajectory;
  temporalSamples?: import('./time/TemporalSampleMetadata').TemporalSampleMetadata;
}
/** A pass-boundary texture. Its content only lives from its producer pass to the end of one encode (or batch). */
export interface PooledPassTexture { readonly texture: GPUTexture; readonly view: GPUTextureView; readonly key: string; lastUsed: number }
/** One lease of a pool texture. The token tells a stale holder apart from the texture's current one. */
export interface PassTextureLease { readonly item: PooledPassTexture; readonly token: number }
/** Free pool textures unused for this many encoders are destroyed. */
const STALE_ENCODERS = 120;

export interface EncodeImageGraphPassesOptions {
  encoder: GPUCommandEncoder; sampler: GPUSampler; source: ImageGraphPassSource;
  width: number; height: number; timelineTimeSeconds: number; plan: ImageOperatorPlan;
  outputView?: GPUTextureView; outputFormat?: GPUTextureFormat;
  /** Caller's effect occurrence (diagnostics); pass textures are pooled, not owned per instance. */
  instanceId: string;
  stopAtResourceId?: string;
  /** Ephemeral dedupe scope. Create once per capture/encode batch and then discard. */
  batch?: ImageGraphPassBatch;
  /** Borrowed runtime resources; identities must change whenever their content changes. */
  externalResources?: ReadonlyMap<string, ImageGraphExternalResource>;
}

/**
 * Owns the transient GPU textures of compiled multi-pass image programs. Pass-boundary caches
 * are rebuilt on every encode, so they come from one pool keyed by size (all rgba16float):
 * a texture is leased for one encode call, or for a batch until `releaseBatch`, and every
 * lease returns to the pool when a new command encoder starts. Commands of one encoder run in
 * recording order and whole command buffers in submission order, so a returned texture can be
 * written by the next lease safely. Many effect instances share a few textures per size.
 */
export class ImageGraphPassRuntime {
  private readonly device: GPUDevice;
  private readonly pipelines = new Map<string, GPURenderPipeline>();
  private readonly failedPipelines = new Map<string, string>();
  private readonly free = new Map<string, PooledPassTexture[]>();
  /** Leased textures and the token of their current lease. */
  private readonly leased = new Map<PooledPassTexture, number>();
  private nextLeaseToken = 0;
  private encoder?: GPUCommandEncoder;
  private generation = 0;
  private disposed = false;

  constructor(device: GPUDevice) {
    this.device = device;
    void device.lost.then(() => this.dispose());
  }

  createBatch(): ImageGraphPassBatch { return { encoded: new Map(), resources: new Map(), leases: [] }; }
  /** The batch's resources are no longer read: its textures go back to the pool and the batch
   * forgets their views, so nothing can read a texture the next lease overwrites. */
  releaseBatch(batch: ImageGraphPassBatch | undefined): void {
    if (!batch) return;
    this.giveBack(batch.leases.splice(0)); batch.encoded.clear(); batch.resources.clear(); batch.released = true;
  }
  getBatchResourceView(batch: ImageGraphPassBatch, resourceId: string) { return batch.resources.get(resourceId)?.view; }

  encode(options: EncodeImageGraphPassesOptions): boolean {
    if (this.disposed) throw new Error('ImageGraphPassRuntime is disposed.');
    if (options.batch?.released) throw new Error('Image graph pass batch was released; create a new batch.');
    const passes = options.plan.passes?.length ? options.plan.passes
      : options.plan.resourceInputs?.length
        ? [{ id: 'image-pass:final', program: options.plan, inputResources: options.plan.resourceInputs, outputResource: undefined }]
        : undefined;
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
    const analysisEdge = options.plan.externalResources?.some(resource => resource.kind === 'source-motion' && resource.required)
      ? 320 : motionAnalysisMaxEdge();
    const resources = (options.plan.resources ?? []).map(resource => resource.maxEdge && resource.id.startsWith('image-resource:__motion-')
      ? { ...resource, maxEdge: Math.min(resource.maxEdge, analysisEdge) } : resource);
    const descriptors = new Map(resources.map(item => [item.id, item]));
    const ids = new Set(descriptors.keys());
    this.beginEncoder(options.encoder);
    const leases: PassTextureLease[] = [];
    try { return this.encodePasses(options, passes, descriptors, ids, leases); }
    finally { if (options.batch) options.batch.leases.push(...leases); else this.giveBack(leases); }
  }

  private encodePasses(options: EncodeImageGraphPassesOptions, passes: NonNullable<ImageOperatorPlan['passes']>,
    descriptors: Map<string, NonNullable<ImageOperatorPlan['resources']>[number]>, ids: Set<string>, leases: PassTextureLease[]): boolean {
    const produced = new Set<string>();
    const localViews = new Map<string, GPUTextureView>(), identities = new Map<string, string>();
    const metadata = new Map<string, ImageOperatorResourceMetadata>();
    for (const [id, resource] of options.externalResources ?? []) {
      if (ids.has(id)) throw new Error(`External image resource ${id} conflicts with a materialized resource.`);
      if (!resource.identity) throw new Error(`External image resource ${id} requires a content identity.`);
      ids.add(id); produced.add(id); localViews.set(id, resource.view); identities.set(id, resource.identity);
      if (resource.width !== undefined || resource.height !== undefined || resource.available !== undefined) {
        metadata.set(id, { width: resource.width!, height: resource.height!, available: resource.available! });
      }
    }
    for (const pass of passes) {
      if (pass.inputResources.length > 8) throw new Error(`Image graph pass ${pass.id} exceeds eight resource inputs.`);
      for (const id of pass.inputResources) if (!ids.has(id) || !produced.has(id)) throw new Error(`Image graph pass ${pass.id} reads unavailable resource ${id}.`);
      const { width, height } = imageResourceSize(pass.outputResource ? descriptors.get(pass.outputResource) : undefined, options.width, options.height);
      const packed = packImageOperatorRuntimeUniforms(pass.program, options.timelineTimeSeconds, width, height, metadata);
      const payloadIdentity = packed ? Array.from(new Uint32Array(packed.buffer, packed.byteOffset, packed.byteLength / 4)).join(',') : '';
      const inputIdentities = pass.inputResources.map(id => identities.get(id) ?? `local:${id}`);
      const producerIdentity = pass.outputResource ? `${pass.outputResource}:${width}x${height}:${pass.program.key}:${payloadIdentity}:${inputIdentities.join('|')}` : '';
      const shared = producerIdentity ? options.batch?.encoded.get(producerIdentity) : undefined;
      if (pass.outputResource && shared) { localViews.set(pass.outputResource, shared.view); identities.set(pass.outputResource, shared.identity); produced.add(pass.outputResource);
        options.batch?.resources.set(pass.outputResource, shared); if (pass.outputResource === options.stopAtResourceId) break; continue; }
      let output = options.outputView;
      if (pass.outputResource) { const lease = this.lease(width, height); leases.push(lease); output = lease.item.view; }
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
      pass.inputResources.forEach((id, index) => entries.push({ binding: 3 + index, resource: localViews.get(id)! }));
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
    // A pass the driver could not build must not be set again: it would invalidate the whole frame.
    const failed = this.failedPipelines.get(key);
    if (failed) throw new EffectGpuPipelineError(failed);
    const module = this.device.createShaderModule({ code: `${commonShader}\n${imageGraphProgramShader(program, 'imageGraphPassFragment', source)}` });
    let layout: GPUPipelineLayout | 'auto' = 'auto';
    if (program.resourceSampling?.includes('exact-u32-pixel-load')) {
      const entries: GPUBindGroupLayoutEntry[] = [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        source === 'external'
          ? { binding: 1, visibility: GPUShaderStage.FRAGMENT, externalTexture: {} }
          : { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      ];
      if (imageOperatorRuntimeUniformSize(program)) entries.push({ binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } });
      (program.resourceInputs ?? []).forEach((_id, index) => entries.push({ binding: 3 + index, visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: imageGraphResourceSampleType(program.resourceSampling?.[index]),
          viewDimension: imageGraphResourceViewDimension(_id) } }));
      const bindGroupLayout = this.device.createBindGroupLayout({ entries });
      layout = this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
    }
    const { pipeline, settled } = createCheckedPipeline(this.device, () => this.device.createRenderPipeline({ label: `image-graph-pass-${program.key}`,
      layout, vertex: { module, entryPoint: 'vertexMain' },
      fragment: { module, entryPoint: 'imageGraphPassFragment', targets: [{ format }] }, primitive: { topology: 'triangle-list' } }));
    if (this.pipelines.size >= 64) this.pipelines.delete(this.pipelines.keys().next().value!);
    this.pipelines.set(key, pipeline);
    void settled.then(failure => {
      if (!failure) return;
      if (this.pipelines.get(key) === pipeline) this.pipelines.delete(key);
      this.failedPipelines.set(key, failure.message);
      log.error(`Image graph pass pipeline could not be built (${failure.kind}); the effect is skipped`, failure);
    });
    return pipeline;
  }

  /** A new command encoder: every lease of the previous one returns to the pool; long unused textures are destroyed. */
  private beginEncoder(encoder: GPUCommandEncoder): void {
    if (encoder === this.encoder) return;
    this.encoder = encoder; this.generation++;
    this.giveBack([...this.leased].map(([item, token]) => ({ item, token })));
    const stale: PooledPassTexture[] = [];
    for (const [key, list] of this.free) {
      const kept = list.filter(item => this.generation - item.lastUsed <= STALE_ENCODERS || (stale.push(item), false));
      if (kept.length) this.free.set(key, kept); else this.free.delete(key);
    }
    // Their last encoder is long finished; wait for the queue before destroying anyway.
    if (stale.length) void this.device.queue.onSubmittedWorkDone().then(() => stale.forEach(item => item.texture.destroy()), () => undefined);
  }

  private lease(width: number, height: number): PassTextureLease {
    const key = `${width}x${height}`;
    const reused = this.free.get(key)?.pop();
    const item = reused ?? (() => {
      const texture = this.device.createTexture({ label: `image-graph-pass-${key}`, size: { width, height }, format: 'rgba16float',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
      return { texture, view: texture.createView(), key, lastUsed: this.generation };
    })();
    const token = ++this.nextLeaseToken;
    this.leased.set(item, token);
    return { item, token };
  }

  /** Returns leases to the pool. A stale lease (its texture went back at an encoder switch and
   * may be leased again by now) returns nothing, so it cannot free another holder's texture. */
  private giveBack(leases: readonly PassTextureLease[]): void {
    for (const { item, token } of leases) {
      if (this.leased.get(item) !== token) continue;
      this.leased.delete(item);
      item.lastUsed = this.generation;
      const list = this.free.get(item.key) ?? [];
      list.push(item); this.free.set(item.key, list);
    }
  }

  /** Pooled textures currently held (leased) and idle (free), for diagnostics and tests. */
  poolStats(): { leased: number; free: number } {
    return { leased: this.leased.size, free: [...this.free.values()].reduce((total, list) => total + list.length, 0) };
  }

  dispose() { if (this.disposed) return; this.disposed = true;
    for (const item of [...this.leased.keys(), ...[...this.free.values()].flat()]) item.texture.destroy();
    this.leased.clear(); this.free.clear(); this.pipelines.clear(); this.failedPipelines.clear(); }
}
