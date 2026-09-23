import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { temporalSampleMetadata } from './TemporalSampleMetadata';
import type { ResolvedImageGraphExternalResource } from '../_shared/imageGraphExternalResources';
import { sourceFrameService, type SourceFrameLease } from '../../services/mediaRuntime/sourceFrames/SourceFrameService';
import type { SourceFrameReader } from '../../services/mediaRuntime/sourceFrames/SourceFrameReader';
import { TemporalFrameUploader } from '../../engine/texture/TemporalFrameUploader';
import { prepareImageEffect } from '../../services/operators/imageEffectRuntimePlan';
import { temporalCurrentGraph, temporalDemandGraph, temporalGraphQueries } from '../../services/operators/temporalDemandGraph';
import { ImageGraphPassRuntime } from '../ImageGraphPassRuntime';
import { StabilizedCurrentFrame } from './StabilizedCurrentFrame';
import { HybridTemporalGpu } from './HybridTemporalGpu';
import { hybridTemporalBatches, hybridTemporalMemory, hybridTemporalWindow } from './hybridTemporalWindow';
import { recordTemporalPreparation, setTemporalStatus, temporalExportFrameStep } from './temporalResourcePreparation';
import { LinearTemporalBlock } from './LinearTemporalBlock';
import { linearTemporalAxis, linearTemporalBlockMemory } from './linearTemporalBlockPlan';
import { slitScanSourceTransform } from './slit-scan/stabilization';
import { temporalSourceTime } from './temporalClipSource';
import type { SourceTemporalRequest } from './SourceTemporalRuntime';

export interface HybridTemporalContext {
  queryIds?: readonly string[];
  graph: EffectOperatorGraph; sampler: GPUSampler; timelineTime: number;
  externalResources: ReadonlyMap<string, ResolvedImageGraphExternalResource>;
  effect: { type: string; params: Record<string, unknown> };
}
interface QueryResources { atlas: ResolvedImageGraphExternalResource; ages: ResolvedImageGraphExternalResource }
interface QueryTargets { id: string; demand: GPUTexture; branch: GPUTexture; outputs: GPUTexture[] }
interface Result { queries: Record<string, QueryResources>; current: ResolvedImageGraphExternalResource; atlas: ResolvedImageGraphExternalResource; ages: ResolvedImageGraphExternalResource }
interface Entry {
  identity: string; bytes: number; capacity: number; width: number; height: number;
  lease: SourceFrameLease; reader?: SourceFrameReader; abort: AbortController;
  atlas: GPUTexture; queries: QueryTargets[]; ages: GPUTexture; metadata: GPUBuffer;
  currents: StabilizedCurrentFrame[]; slots: Map<number, number>;
  index: number; signature?: string; requested?: string; result?: Result; pending?: Promise<void>; error?: Error;
  encoder: GPUCommandEncoder; retryAt?: number; retryTimer?: ReturnType<typeof setTimeout>;
  block?: LinearTemporalBlock;
}

/** Bounded GPU PTS cache. Oversized windows accumulate disjoint temporal weights
 * in batches, using borrowed decoded surfaces directly in the GPU uploader. */
export class HybridTemporalRuntime {
  private entries = new Map<string, Entry>();
  private device: GPUDevice;
  private onReady?: () => void;
  private gpu?: HybridTemporalGpu;
  private uploader: TemporalFrameUploader;
  private graphs: ImageGraphPassRuntime;
  constructor(device: GPUDevice, onReady?: () => void) {
    this.device = device; this.onReady = onReady;
    this.uploader = new TemporalFrameUploader(device);
    this.graphs = new ImageGraphPassRuntime(device);
  }

  resolve(request: SourceTemporalRequest, context: HybridTemporalContext, budget = 640 * 1024 * 1024): Result | undefined {
    if (!request.currentInput) throw new Error('Hybrid rendering requires the current source input.');
    this.gpu ??= new HybridTemporalGpu(this.device);
    const { width, height } = request.currentInput, device = this.device;
    const scale = request.maxEdge ? Math.min(1, request.maxEdge / Math.max(request.media.width!, request.media.height!)) : 1;
    const sw = Math.round(request.media.width! * scale), sh = Math.round(request.media.height! * scale);
    if (![width, height, sw, sh].every(n => Number.isInteger(n) && n > 0 && n <= device.limits.maxTextureDimension2D)) {
      throw new Error('Hybrid rendering requires valid dimensions within the GPU texture limit.');
    }
    const queryIds = context.queryIds?.length ? [...new Set(context.queryIds)] : temporalGraphQueries(context.graph).map(query => query.id);
    if (!queryIds.length) throw new Error('Hybrid requires a temporal query.');
    const step = temporalExportFrameStep();
    const axis = queryIds.length === 1 ? linearTemporalAxis(request, context.graph, context.effect.params, step) : undefined;
    const blockMemory = axis === undefined ? { count: 0, bytes: 0 } : linearTemporalBlockMemory(width, height);
    const memory = hybridTemporalMemory(width, height, sw, sh, blockMemory.count ? 2 : request.samples, device.limits.maxTextureArrayLayers,
      budget - blockMemory.bytes, queryIds.length);
    memory.bytes += blockMemory.bytes;
    // Originals make cache identities independent of global proxy toggles and export.
    const identity = JSON.stringify([request.media.id, request.media.url, width, height, sw, sh, memory.capacity, blockMemory.count, queryIds, request.stabilization?.identity]);
    let entry = this.entries.get(request.key);
    if (entry?.error && performance.now() >= (entry.retryAt ?? 0)) { this.release(request.key); entry = undefined; }
    if (entry && entry.identity !== identity) { this.release(request.key); entry = undefined; }
    if (!entry) {
      for (const [key, old] of this.entries) {
        if ([...this.entries.values()].reduce((n, e) => n + e.bytes, memory.bytes) <= budget) break;
        if (old.encoder !== request.encoder) this.release(key);
      }
      if ([...this.entries.values()].reduce((n, e) => n + e.bytes, memory.bytes) > budget) throw new Error('Concurrent hybrid caches exceed the available history budget.');
      const texture = (format: GPUTextureFormat, w = width, h = height, layers = 1) => device.createTexture({
        size: [w, h, layers], format, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST });
      entry = { identity, ...memory, width, height, lease: sourceFrameService.acquire(request.media), abort: new AbortController(),
        atlas: texture('rgba8unorm', sw, sh, memory.capacity),
        queries: queryIds.map(id => ({ id, demand: texture('rgba32float'), branch: texture('rgba8unorm'), outputs: [texture('rgba16float'), texture('rgba16float')] })),
        ages: texture('rgba32float', 65, 1), metadata: device.createBuffer({ size: 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
        currents: [new StabilizedCurrentFrame(device, width, height), new StabilizedCurrentFrame(device, width, height)],
        index: 0, slots: new Map(), encoder: request.encoder };
      const data = new Float32Array(65 * 4); data[256] = 1; data[258] = 2;
      device.queue.writeTexture({ texture: entry.ages }, data, { bytesPerRow: 65 * 16 }, [65, 1]);
      this.entries.set(request.key, entry);
    }
    entry.encoder = request.encoder;
    if (entry.error) throw entry.error;
    if (!entry.reader) {
      const owner = entry;
      owner.pending ??= this.pending(owner, owner.lease.ready.then(reader => { owner.reader = reader; }));
      recordTemporalPreparation(owner.pending); return owner.result;
    }
    const window = hybridTemporalWindow(request, entry.reader.frames);
    // Validate canonical decoded timestamps before changing any GPU state.
    if (request.stabilization) for (const time of window.times) slitScanSourceTransform(request.stabilization, time);
    const signature = JSON.stringify([request.source, request.horizon, request.timeFactor, request.samples, request.nearest,
      context.graph, context.effect.params, context.timelineTime, [...context.externalResources].map(([id, r]) => [id, r.identity])]);
    entry.requested = signature;
    if (entry.signature === signature) return entry.result;
    if (entry.pending) { recordTemporalPreparation(entry.pending); return entry.result; }
    const current = entry.currents[entry.index].encode(request.encoder, request.currentInput.view, request.stabilization
      ? slitScanSourceTransform(request.stabilization, temporalSourceTime(request.source, request.source.localTime)) : [1, 0, 0, 0, 1, 0]);
    for (const query of entry.queries) for (const [kind, graph, target, format] of [
      ['demand', temporalDemandGraph(context.graph, query.id), query.demand, 'rgba32float'],
      ['current', temporalCurrentGraph(context.graph, query.id), query.branch, 'rgba8unorm'],
    ] as const) {
      const plan = prepareImageEffect({ ...context.effect, operatorGraph: graph }).plan;
      if (!plan) throw new Error('Hybrid temporal graph is incomplete.');
      this.graphs.encode({ encoder: request.encoder, sampler: context.sampler, source: { kind: 'texture', view: current }, width, height,
        timelineTimeSeconds: context.timelineTime, plan: plan.passes?.length ? plan : { ...plan, passes: [{ id: kind, program: plan, inputResources: plan.resourceInputs ?? [] }] },
        outputView: target.createView(), outputFormat: format, instanceId: `${request.key}:${query.id}:${kind}`, externalResources: context.externalResources });
    }
    if (entry.metadata.size !== window.metadata.byteLength) {
      const retired = entry.metadata;
      entry.metadata = device.createBuffer({ size: window.metadata.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      void Promise.resolve().then(() => device.queue.onSubmittedWorkDone()).finally(() => retired.destroy());
    }
    device.queue.writeBuffer(entry.metadata, 0, window.metadata);
    if (axis !== undefined && blockMemory.count && step) {
      entry.block ??= new LinearTemporalBlock(device);
      const { localTime: _localTime, ...sourceIdentity } = request.source;
      const blockIdentity = JSON.stringify([sourceIdentity, request.horizon, request.timeFactor, request.samples, request.nearest,
        context.effect.params, axis, step]);
      const consume = (encoder: GPUCommandEncoder) => {
        const tile = entry!.block!.find(blockIdentity, request.source.localTime);
        if (!tile) throw new Error('Prepared temporal output tile is unavailable.');
        encoder.copyTextureToTexture({ texture: tile.texture }, { texture: entry!.queries[0].outputs[entry!.index] }, [width, height]);
        // Keep the current input live; it may contain preceding effects.
        const slots = new Int32Array(tile.times.length + 1).fill(-1); slots[0] = 0;
        const buffer = this.gpu!.accumulate(encoder, entry!.queries[0].demand.createView(), tile.metadata,
          entry!.atlas.createView({ dimension: '2d-array' }), entry!.queries[0].branch.createView(),
          entry!.queries[0].outputs[entry!.index].createView(), slots, false);
        void Promise.resolve().then(() => device.queue.onSubmittedWorkDone()).finally(() => buffer.destroy());
        this.finish(entry!, request, current, signature, `shared source · ${blockMemory.count} outputs`, tile.times.length);
      };
      if (entry.block.find(blockIdentity, request.source.localTime)) { consume(request.encoder); return entry.result; }
      const owner = entry;
      owner.pending = this.pending(owner, (async () => {
        await Promise.resolve(); // Submit the current/demand capture before any source work.
        const check = () => { owner.abort.signal.throwIfAborted();
          if (!request.keepPending && owner.requested !== signature) throw new DOMException('Hybrid seek superseded.', 'AbortError'); };
        check();
        await owner.block!.prepare(blockIdentity, request, owner.reader!, owner.lease, this.uploader,
          axis, step, blockMemory.count, owner.abort.signal, check);
        check(); const encoder = device.createCommandEncoder(); consume(encoder); device.queue.submit([encoder.finish()]);
      })());
      recordTemporalPreparation(owner.pending); return owner.result;
    }
    if (window.times.every(time => entry!.slots.has(time))) {
      this.draw(entry, request.encoder, window.times.map((_, i) => i + 1), window.times, true);
      this.finish(entry, request, current, signature, 'GPU cache', window.times.length); return entry.result;
    }
    const owner = entry;
    owner.pending = this.pending(owner, this.prepare(owner, request, window.times, current, signature));
    recordTemporalPreparation(owner.pending); return owner.result;
  }

  private pending(entry: Entry, operation: Promise<void>) {
    const pending = operation.catch(error => {
      if (entry.abort.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return;
      entry.error = error instanceof Error ? error : new Error(String(error));
      entry.retryAt = performance.now() + 1000;
      entry.retryTimer = setTimeout(() => this.onReady?.(), 1010); throw entry.error;
    }).finally(() => { entry.pending = undefined; this.onReady?.(); });
    void pending.catch(() => undefined); return pending;
  }

  private draw(entry: Entry, encoder: GPUCommandEncoder, groups: number[], times: number[], first: boolean) {
    const mapping = new Int32Array(times.length + 1).fill(-1); if (first) mapping[0] = 0;
    for (const group of groups) mapping[group] = entry.slots.get(times[group - 1])!;
    for (const query of entry.queries) {
      const buffer = this.gpu!.accumulate(encoder, query.demand.createView(), entry.metadata, entry.atlas.createView({ dimension: '2d-array' }),
        query.branch.createView(), query.outputs[entry.index].createView(), mapping, first);
      // Every query consumes the same decoded batch before its source slots recycle.
      void Promise.resolve().then(() => this.device.queue.onSubmittedWorkDone()).finally(() => buffer.destroy());
    }
  }

  private async prepare(entry: Entry, request: SourceTemporalRequest, times: number[], current: GPUTextureView, signature: string) {
    await Promise.resolve(); // Enclosing render must submit captured current/demand first.
    const check = () => {
      entry.abort.signal.throwIfAborted();
      if (!request.keepPending && entry.requested !== signature) throw new DOMException('Hybrid seek superseded.', 'AbortError');
    };
    check();
    const neededSet = new Set<number>();
    if (times.length <= entry.capacity) times.forEach((_, i) => neededSet.add(i + 1));
    else for (const query of entry.queries) {
      const needed = await this.gpu!.needed(query.demand.createView(), entry.metadata, entry.width, entry.height, times.length + 1);
      needed.forEach(group => neededSet.add(group)); check();
    }
    const needed = [...neededSet];
    check();
    const batches = hybridTemporalBatches(times, needed, entry.slots, entry.capacity);
    for (const [index, groups] of batches.entries()) {
      check();
      const required = new Set(groups.map(group => times[group - 1]));
      const missing = [...required].filter(time => !entry.slots.has(time));
      if (missing.length) await entry.lease.request({ times: missing, priority: 'required', signal: entry.abort.signal, onFrame: frame => {
        check();
        let slot = Array.from({ length: entry.capacity }, (_, i) => i).find(i => ![...entry.slots.values()].includes(i));
        if (slot === undefined) {
          const victim = [...entry.slots].find(([time]) => !required.has(time));
          if (!victim) throw new Error('Hybrid cache has no recyclable slot.');
          slot = victim[1]; entry.slots.delete(victim[0]);
        }
        this.uploader.upload(frame, entry.atlas, slot, request.stabilization ? slitScanSourceTransform(request.stabilization, frame.time) : undefined);
        entry.slots.set(frame.time, slot);
      } });
      check();
      const encoder = this.device.createCommandEncoder(); this.draw(entry, encoder, groups, times, index === 0);
      this.device.queue.submit([encoder.finish()]);
      setTemporalStatus(request.effectId, `Hybrid · GPU batch ${index + 1}/${batches.length} · ${entry.capacity} cached frames`);
    }
    check(); this.finish(entry, request, current, signature, times.length > entry.capacity ? 'GPU streaming' : 'GPU cache', times.length);
  }

  private finish(entry: Entry, request: SourceTemporalRequest, current: GPUTextureView, signature: string, mode: string, sourceFrames: number) {
    entry.signature = signature;
    const temporalSamples = temporalSampleMetadata(hybridTemporalWindow(request, entry.reader!.frames), request.timeFactor ?? 1, request.nearest);
    const queries = Object.fromEntries(entry.queries.map(query => [query.id, {
      atlas: { view: query.outputs[entry.index].createView({ dimension: '2d-array' }), identity: `${signature}:${query.id}` },
      ages: { view: entry.ages.createView(), identity: 'hybrid-output', temporalSamples },
    }]));
    entry.result = { current: { view: current, identity: signature }, queries, ...queries[entry.queries[0].id] };
    entry.index = 1 - entry.index;
    setTemporalStatus(request.effectId, `Hybrid · ${mode} · ${request.horizon.toFixed(2)} s window · ${request.samples} samples · ${sourceFrames} distinct source frames · ${entry.slots.size}/${entry.capacity} cached`);
  }

  release(key: string) {
    const entry = this.entries.get(key); if (!entry) return;
    clearTimeout(entry.retryTimer); entry.abort.abort(); entry.lease.release(); this.entries.delete(key);
    entry.block?.clear();
    const dispose = () => {
      for (const t of [entry.atlas, entry.ages, ...entry.queries.flatMap(query => [query.demand, query.branch, ...query.outputs])]) t.destroy();
      entry.metadata.destroy(); entry.currents.forEach(c => c.destroy());
    };
    void Promise.resolve().then(() => this.device.queue.onSubmittedWorkDone()).finally(dispose);
  }
  isCurrent(key: string) { const entry = this.entries.get(key); return !!entry?.result && entry.signature === entry.requested; }
  destroy() { for (const key of this.entries.keys()) this.release(key); this.graphs.dispose(); this.uploader.destroy(); }
}
