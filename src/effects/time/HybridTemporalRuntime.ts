import type { EffectOperatorGraph } from '../../types/operatorGraph';
import type { ResolvedImageGraphExternalResource } from '../_shared/imageGraphExternalResources';
import { sourceFrameService, type SourceFrameLease } from '../../services/mediaRuntime/sourceFrames/SourceFrameService';
import type { SourceFrameReader } from '../../services/mediaRuntime/sourceFrames/SourceFrameReader';
import { TemporalFrameUploader } from '../../engine/texture/TemporalFrameUploader';
import { prepareImageEffect } from '../../services/operators/imageEffectRuntimePlan';
import { temporalCurrentGraph, temporalDemandGraph } from '../../services/operators/temporalDemandGraph';
import { ImageGraphPassRuntime } from '../ImageGraphPassRuntime';
import { StabilizedCurrentFrame } from './StabilizedCurrentFrame';
import { HybridTemporalGpu } from './HybridTemporalGpu';
import { hybridTemporalBatches, hybridTemporalMemory, hybridTemporalWindow } from './hybridTemporalWindow';
import { recordTemporalPreparation, setTemporalStatus } from './temporalResourcePreparation';
import { slitScanSourceTransform } from './slit-scan/stabilization';
import { temporalSourceTime } from './temporalClipSource';
import type { SourceTemporalRequest } from './SourceTemporalRuntime';

export interface HybridTemporalContext {
  graph: EffectOperatorGraph; sampler: GPUSampler; timelineTime: number;
  externalResources: ReadonlyMap<string, ResolvedImageGraphExternalResource>;
  effect: { type: string; params: Record<string, unknown> };
}
interface Result { current: ResolvedImageGraphExternalResource; atlas: ResolvedImageGraphExternalResource; ages: ResolvedImageGraphExternalResource }
interface Entry {
  identity: string; bytes: number; capacity: number; width: number; height: number;
  lease: SourceFrameLease; reader?: SourceFrameReader; abort: AbortController;
  atlas: GPUTexture; demand: GPUTexture; branch: GPUTexture; ages: GPUTexture; metadata: GPUBuffer;
  outputs: GPUTexture[]; currents: StabilizedCurrentFrame[]; slots: Map<number, number>;
  index: number; signature?: string; requested?: string; result?: Result; pending?: Promise<void>; error?: Error;
  encoder: GPUCommandEncoder; retryAt?: number; retryTimer?: ReturnType<typeof setTimeout>;
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

  resolve(request: SourceTemporalRequest, context: HybridTemporalContext): Result | undefined {
    if (!request.currentInput) throw new Error('Hybrid rendering requires the current source input.');
    this.gpu ??= new HybridTemporalGpu(this.device);
    const { width, height } = request.currentInput, device = this.device;
    const scale = request.maxEdge ? Math.min(1, request.maxEdge / Math.max(request.media.width!, request.media.height!)) : 1;
    const sw = Math.round(request.media.width! * scale), sh = Math.round(request.media.height! * scale);
    if (![width, height, sw, sh].every(n => Number.isInteger(n) && n > 0 && n <= device.limits.maxTextureDimension2D)) {
      throw new Error('Hybrid rendering requires valid dimensions within the GPU texture limit.');
    }
    const memory = hybridTemporalMemory(width, height, sw, sh, request.samples, device.limits.maxTextureArrayLayers);
    // Originals make cache identities independent of global proxy toggles and export.
    const identity = JSON.stringify([request.media.id, request.media.url, width, height, sw, sh, memory.capacity, request.stabilization?.identity]);
    let entry = this.entries.get(request.key);
    if (entry?.error && performance.now() >= (entry.retryAt ?? 0)) { this.release(request.key); entry = undefined; }
    if (entry && entry.identity !== identity) { this.release(request.key); entry = undefined; }
    if (!entry) {
      for (const [key, old] of this.entries) {
        if ([...this.entries.values()].reduce((n, e) => n + e.bytes, memory.bytes) <= 640 * 1024 * 1024) break;
        if (old.encoder !== request.encoder) this.release(key);
      }
      if ([...this.entries.values()].reduce((n, e) => n + e.bytes, memory.bytes) > 640 * 1024 * 1024) throw new Error('Concurrent hybrid caches exceed 640 MiB.');
      const texture = (format: GPUTextureFormat, w = width, h = height, layers = 1) => device.createTexture({
        size: [w, h, layers], format, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST });
      entry = { identity, ...memory, width, height, lease: sourceFrameService.acquire(request.media), abort: new AbortController(),
        atlas: texture('rgba8unorm', sw, sh, memory.capacity), demand: texture('rgba32float'), branch: texture('rgba8unorm'),
        ages: texture('rgba32float', 65, 1), metadata: device.createBuffer({ size: 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
        outputs: [texture('rgba16float'), texture('rgba16float')], currents: [new StabilizedCurrentFrame(device, width, height), new StabilizedCurrentFrame(device, width, height)],
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
    const signature = JSON.stringify([request.source, request.horizon, request.samples, request.nearest,
      context.graph, context.effect.params, context.timelineTime, [...context.externalResources].map(([id, r]) => [id, r.identity])]);
    entry.requested = signature;
    if (entry.signature === signature) return entry.result;
    if (entry.pending) { recordTemporalPreparation(entry.pending); return entry.result; }
    const current = entry.currents[entry.index].encode(request.encoder, request.currentInput.view, request.stabilization
      ? slitScanSourceTransform(request.stabilization, temporalSourceTime(request.source, request.source.localTime)) : [1, 0, 0, 0, 1, 0]);
    for (const [kind, graph, target, format] of [
      ['demand', temporalDemandGraph(context.graph), entry.demand, 'rgba32float'],
      ['current', temporalCurrentGraph(context.graph), entry.branch, 'rgba8unorm'],
    ] as const) {
      const plan = prepareImageEffect({ ...context.effect, operatorGraph: graph }).plan;
      if (!plan) throw new Error('Hybrid temporal graph is incomplete.');
      this.graphs.encode({ encoder: request.encoder, sampler: context.sampler, source: { kind: 'texture', view: current }, width, height,
        timelineTimeSeconds: context.timelineTime, plan: plan.passes?.length ? plan : { ...plan, passes: [{ id: kind, program: plan, inputResources: plan.resourceInputs ?? [] }] },
        outputView: target.createView(), outputFormat: format, instanceId: `${request.key}:${kind}`, externalResources: context.externalResources });
    }
    if (entry.metadata.size !== window.metadata.byteLength) {
      const retired = entry.metadata;
      entry.metadata = device.createBuffer({ size: window.metadata.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      void Promise.resolve().then(() => device.queue.onSubmittedWorkDone()).finally(() => retired.destroy());
    }
    device.queue.writeBuffer(entry.metadata, 0, window.metadata);
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
    const buffer = this.gpu!.accumulate(encoder, entry.demand.createView(), entry.metadata, entry.atlas.createView({ dimension: '2d-array' }),
      entry.branch.createView(), entry.outputs[entry.index].createView(), mapping, first);
    // The enclosing render submits synchronously; defer retirement until that submit.
    void Promise.resolve().then(() => this.device.queue.onSubmittedWorkDone()).finally(() => buffer.destroy());
  }

  private async prepare(entry: Entry, request: SourceTemporalRequest, times: number[], current: GPUTextureView, signature: string) {
    await Promise.resolve(); // Enclosing render must submit captured current/demand first.
    const check = () => {
      entry.abort.signal.throwIfAborted();
      if (!request.keepPending && entry.requested !== signature) throw new DOMException('Hybrid seek superseded.', 'AbortError');
    };
    check();
    const needed = times.length <= entry.capacity ? times.map((_, i) => i + 1)
      : await this.gpu!.needed(entry.demand.createView(), entry.metadata, entry.width, entry.height, times.length + 1);
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
    entry.result = { current: { view: current, identity: signature },
      atlas: { view: entry.outputs[entry.index].createView({ dimension: '2d-array' }), identity: signature },
      ages: { view: entry.ages.createView(), identity: 'hybrid-output' } };
    entry.index = 1 - entry.index;
    setTemporalStatus(request.effectId, `Hybrid · ${mode} · ${request.samples} samples · ${sourceFrames} distinct source frames · ${entry.slots.size}/${entry.capacity} cached`);
  }

  release(key: string) {
    const entry = this.entries.get(key); if (!entry) return;
    clearTimeout(entry.retryTimer); entry.abort.abort(); entry.lease.release(); this.entries.delete(key);
    const dispose = () => {
      for (const t of [entry.atlas, entry.demand, entry.branch, entry.ages, ...entry.outputs]) t.destroy();
      entry.metadata.destroy(); entry.currents.forEach(c => c.destroy());
    };
    void Promise.resolve().then(() => this.device.queue.onSubmittedWorkDone()).finally(dispose);
  }
  destroy() { for (const key of this.entries.keys()) this.release(key); this.graphs.dispose(); this.uploader.destroy(); }
}
