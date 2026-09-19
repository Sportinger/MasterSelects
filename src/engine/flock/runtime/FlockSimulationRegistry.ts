import { Logger } from '../../../services/logger';
import { renderHostPort } from '../../../services/render/renderHostPort';
import type { Keyframe } from '../../../types/keyframes';
import type { FlockDiagnostic } from '../../../types/flock';
import { hashFlockString } from '../../../services/flock/compiler/flockCompilerSupport';
import {
  indexFlockKeyframes,
  resolveFlockRender,
  type FlockEvaluationContext,
} from '../../../services/flock/compiler/flockParamEvaluation';
import { FLOCK_SOLVER_VERSION, type FlockProgram } from '../../../services/flock/compiler/flockProgramTypes';
import type { FlockLayerSourceData } from '../../../services/flock/flockLayerSource';
import { flockStepForSourceTime } from '../../../services/flock/time/flockTimeMapper';
import type { SceneFlockLayer } from '../../scene/types';
import { FlockBranchRenderer, type FlockDrawPlan, type FlockLinkBinding } from '../gpu/FlockBranchRenderer';
import { getFlockGpuPipelines } from '../gpu/FlockGpuPipelines';
import { peekFlockModelMesh } from '../gpu/flockModelMeshes';
import { FlockGpuSession, estimateFlockSessionBuffers } from '../gpu/FlockGpuSession';
import { createFlockAudioSampler, getFlockAudioRevision } from './flockAudioSampler';
import { flockCheckpointStore } from './flockCheckpointStore';
import { buildFlockRuntimeStatus } from './flockRuntimeStatus';
import {
  flockRuntime,
  type FlockHostCapabilities,
  type FlockParticleSample,
  type FlockPrecomputeResult,
  type FlockRuntimeBackend,
} from './flockRuntimeApi';
import { runFlockPrecompute, type FlockPrecomputeJob } from './flockPrecompute';

const log = Logger.create('FlockRuntime');
const PREVIEW_IDLE_DISPOSE_MS = 20_000;
const EXPORT_IDLE_DISPOSE_MS = 4_000;

export interface FlockSessionEntry {
  key: string;
  clipId: string;
  consumer: 'preview' | 'export' | 'precompute';
  session: FlockGpuSession;
  program: FlockProgram;
  behaviorHash: string;
  keyframeSignatures: Map<string, string[]>;
  cacheKey: string;
  persistedSteps: number[] | null;
  persistedLoads: Set<number>;
  lastUsedAt: number;
  targetStep: number;
  sourceTime: number;
  caughtUp: boolean;
  stale: boolean;
  runtimeDiagnostics: FlockDiagnostic[];
  timings: Record<string, number>;
  lastStatusAt: number;
  lastState: string;
  audioRevision: number;
}

function keyframeEntrySignature(keyframe: Keyframe): string {
  return `${keyframe.time}:${keyframe.value}:${keyframe.easing}:${keyframe.handleIn?.x ?? ''},${keyframe.handleIn?.y ?? ''}:${keyframe.handleOut?.x ?? ''},${keyframe.handleOut?.y ?? ''}`;
}

export class FlockSimulationRegistry implements FlockRuntimeBackend {
  device: GPUDevice | null = null;
  readonly entries = new Map<string, FlockSessionEntry>();
  readonly latestInputs = new Map<string, FlockLayerSourceData>();
  readonly jobs = new Map<string, FlockPrecomputeJob>();
  private readonly lastValidPrograms = new Map<string, FlockProgram>();
  private renderer: FlockBranchRenderer | null = null;
  private readonly contexts = new WeakMap<Keyframe[], FlockEvaluationContext>();
  private lastPruneAt = 0;

  private ensureDevice(device: GPUDevice): void {
    if (this.device === device) return;
    if (this.device) {
      log.info('GPU device changed; rebuilding flock sessions from checkpoints/source');
      for (const entry of this.entries.values()) entry.session.dispose();
      this.entries.clear();
      this.renderer?.dispose();
      this.renderer = null;
    }
    this.device = device;
    void device.lost?.then(() => {
      if (this.device !== device) return;
      for (const entry of this.entries.values()) entry.session.dispose();
      this.entries.clear();
      this.renderer = null;
      this.device = null;
    });
  }

  getRenderer(device: GPUDevice): FlockBranchRenderer {
    this.ensureDevice(device);
    if (!this.renderer) this.renderer = new FlockBranchRenderer(device, getFlockGpuPipelines(device));
    return this.renderer;
  }

  contextFor(clipId: string, keyframes: Keyframe[]): FlockEvaluationContext {
    let context = this.contexts.get(keyframes);
    if (!context) {
      context = { keyframesByProperty: indexFlockKeyframes(keyframes), audio: createFlockAudioSampler(clipId) };
      this.contexts.set(keyframes, context);
    }
    return context;
  }

  private signatures(program: FlockProgram, keyframes: Keyframe[]): Map<string, string[]> {
    const behavior = new Set<string>(program.behaviorProperties);
    const result = new Map<string, string[]>();
    for (const keyframe of keyframes.toSorted((a, b) => a.time - b.time)) {
      if (!behavior.has(keyframe.property)) continue;
      const list = result.get(keyframe.property) ?? [];
      list.push(keyframeEntrySignature(keyframe));
      result.set(keyframe.property, list);
    }
    return result;
  }

  private cacheKeyFor(program: FlockProgram, signatures: Map<string, string[]>): string {
    const keyframes = [...signatures.entries()].toSorted(([a], [b]) => a.localeCompare(b));
    const adapter = (this.device as GPUDevice & { adapterInfo?: { vendor?: string; architecture?: string } } | null)?.adapterInfo;
    return hashFlockString(JSON.stringify([FLOCK_SOLVER_VERSION, program.hashes.behavior, keyframes, adapter?.vendor ?? '', adapter?.architecture ?? '']));
  }

  /** Earliest source step affected by keyframe edits (the preceding segment boundary for eased curves). */
  private earliestChangedStep(program: FlockProgram, previous: Map<string, string[]>, next: Map<string, string[]>): number | null {
    if (program.loopSeconds > 0) {
      const changed = [...new Set([...previous.keys(), ...next.keys()])]
        .some((property) => (previous.get(property) ?? []).join('|') !== (next.get(property) ?? []).join('|'));
      return changed ? 0 : null;
    }
    let earliest: number | null = null;
    for (const property of new Set([...previous.keys(), ...next.keys()])) {
      const a = previous.get(property) ?? [];
      const b = next.get(property) ?? [];
      if (a.join('|') === b.join('|')) continue;
      let index = 0;
      while (index < a.length && index < b.length && a[index] === b[index]) index += 1;
      const boundary = index > 0 ? Number(a[index - 1].split(':')[0]) : 0;
      const step = Math.max(0, Math.floor(boundary * program.stepRate) + program.simulation.warmupSteps);
      earliest = earliest === null ? step : Math.min(earliest, step);
    }
    return earliest;
  }

  private admit(device: GPUDevice, program: FlockProgram): { ok: true } | { ok: false; message: string } {
    const estimate = estimateFlockSessionBuffers(program);
    const limits = device.limits;
    if (estimate.largestBinding > limits.maxStorageBufferBindingSize || estimate.largestBinding > limits.maxBufferSize) {
      return {
        ok: false,
        message: `Population ${program.capacity} needs a ${Math.ceil(estimate.largestBinding / 1048576)} MB storage binding; this GPU allows ${Math.floor(limits.maxStorageBufferBindingSize / 1048576)} MB. The swarm is not reduced silently — lower the emitter count.`,
      };
    }
    return { ok: true };
  }

  acquire(
    device: GPUDevice,
    clipId: string,
    consumer: FlockSessionEntry['consumer'],
    program: FlockProgram,
    keyframes: Keyframe[],
  ): FlockSessionEntry | null {
    this.ensureDevice(device);
    const key = `${clipId}|${consumer}`;
    const context = this.contextFor(clipId, keyframes);
    let entry = this.entries.get(key);
    if (entry && (entry.session.isDisposed || entry.program.hashes.topology !== program.hashes.topology || entry.session.device !== device)) {
      entry.session.dispose();
      this.entries.delete(key);
      entry = undefined;
    }
    const nextSignatures = this.signatures(program, keyframes);
    if (!entry) {
      const admission = this.admit(device, program);
      if (!admission.ok) {
        flockRuntime.publishStatus(buildFlockRuntimeStatus({ clipId, state: 'unsupported', message: admission.message, program }));
        return null;
      }
      const session = new FlockGpuSession(device, getFlockGpuPipelines(device), program, context);
      entry = {
        key,
        clipId,
        consumer,
        session,
        program,
        behaviorHash: program.hashes.behavior,
        keyframeSignatures: nextSignatures,
        cacheKey: this.cacheKeyFor(program, nextSignatures),
        persistedSteps: null,
        persistedLoads: new Set(),
        lastUsedAt: performance.now(),
        targetStep: 0,
        sourceTime: 0,
        caughtUp: false,
        stale: false,
        runtimeDiagnostics: [],
        timings: {},
        lastStatusAt: 0,
        lastState: '',
        audioRevision: getFlockAudioRevision(),
      };
      this.entries.set(key, entry);
      if (consumer !== 'precompute') void this.loadPersistedIndex(entry);
      return entry;
    }

    entry.session.setContext(program, context);
    const audioRevision = getFlockAudioRevision();
    const audioChanged = entry.audioRevision !== audioRevision && program.values.some((value) => value.kind === 'audio');
    entry.audioRevision = audioRevision;
    const invalidateStep = program.hashes.behavior !== entry.behaviorHash || audioChanged
      ? 0
      : this.earliestChangedStep(program, entry.keyframeSignatures, nextSignatures);
    entry.program = program;
    entry.behaviorHash = program.hashes.behavior;
    entry.keyframeSignatures = nextSignatures;
    if (invalidateStep !== null) {
      entry.session.invalidateFrom(invalidateStep);
      entry.cacheKey = this.cacheKeyFor(program, nextSignatures);
      entry.persistedSteps = null;
      entry.persistedLoads.clear();
      if (consumer !== 'precompute') void this.loadPersistedIndex(entry);
    }
    return entry;
  }

  private async loadPersistedIndex(entry: FlockSessionEntry): Promise<void> {
    const cacheKey = entry.cacheKey;
    const steps = await flockCheckpointStore.listSteps(cacheKey);
    if (entry.cacheKey === cacheKey) entry.persistedSteps = steps;
  }

  async loadPersistedCheckpoint(entry: FlockSessionEntry, targetStep: number, wait: boolean): Promise<void> {
    const steps = entry.persistedSteps;
    if (!steps?.length) return;
    const candidate = steps.filter((step) => step <= targetStep).pop();
    if (candidate === undefined || candidate <= entry.session.hasCheckpointAtOrBefore(targetStep)) return;
    if (entry.session.step >= candidate && entry.session.step <= targetStep) return;
    if (entry.persistedLoads.has(candidate)) return;
    entry.persistedLoads.add(candidate);
    const cacheKey = entry.cacheKey;
    const load = flockCheckpointStore.get(cacheKey, candidate).then((record) => {
      if (!record || entry.session.isDisposed || entry.cacheKey !== cacheKey) return;
      if (entry.session.importCheckpoint(record.step, record.state, record.rings) && !wait) renderHostPort.requestRender();
    });
    if (wait) await load;
  }

  prepare(
    device: GPUDevice,
    commandEncoder: GPUCommandEncoder,
    layer: SceneFlockLayer,
    options: { realtime: boolean },
  ): FlockDrawPlan | null {
    const data = layer.flock;
    if (data.program) this.lastValidPrograms.set(data.clipId, data.program);
    if (data.consumer === 'preview') this.latestInputs.set(data.clipId, data);
    const program = data.program ?? this.lastValidPrograms.get(data.clipId) ?? null;
    if (!program) {
      flockRuntime.publishStatus(buildFlockRuntimeStatus({ clipId: data.clipId, state: 'invalid', diagnostics: data.diagnostics }));
      return null;
    }
    const entry = this.acquire(device, data.clipId, data.consumer, program, data.keyframes);
    if (!entry) return null;
    entry.stale = !data.program;
    const sample = flockStepForSourceTime(program, data.sourceTime);
    const targetStep = sample.step + 1;
    void this.loadPersistedCheckpoint(entry, targetStep, false);
    entry.session.seekCheckpoint(targetStep);
    const budget = data.consumer === 'export' ? Number.MAX_SAFE_INTEGER : options.realtime ? 12 : 90;
    const stepStarted = performance.now();
    const caughtUp = entry.session.advanceTo(targetStep, budget);
    entry.timings.stepsEncode = performance.now() - stepStarted;
    if (!caughtUp && data.consumer !== 'export') renderHostPort.requestRender();

    const context = this.contextFor(data.clipId, data.keyframes);
    const render = resolveFlockRender(program, sample.sourceTime, context);
    const links = new Map<number, FlockLinkBinding>();
    const linksStarted = performance.now();
    const runtimeDiagnostics: FlockDiagnostic[] = [];
    for (const branch of render.branches) {
      if (branch.spec.kind === 'instances' && branch.p.e.mesh === 'model') {
        const model = peekFlockModelMesh(branch.p.a.model ?? '');
        if (!branch.p.a.model || !model || model.status !== 'ready' || model.decimated) {
          runtimeDiagnostics.push({
            code: model?.status === 'loading' ? 'model-loading' : model?.decimated ? 'model-decimated' : 'model-unavailable',
            severity: model?.status === 'loading' || model?.decimated ? 'info' : 'warning',
            message: model?.message ?? (branch.p.a.model ? 'Loading model asset…' : 'Choose a model asset; a placeholder arrow mesh is drawn meanwhile.'),
            nodeIds: [branch.spec.sourceNodeId],
          });
        }
      }
      if (branch.spec.kind !== 'links') continue;
      const perParticle = branch.spec.params.integers.perParticle ?? 2;
      const maxLinks = branch.spec.params.integers.maxLinks ?? 20_000;
      const fraction = Math.min(branch.p.n.sampleFraction ?? 0.3, maxLinks / Math.max(1, program.capacity * perParticle));
      const radius = branch.p.n.radius ?? 10;
      if (radius > entry.session.lastGridCellSize * 2) {
        runtimeDiagnostics.push({ code: 'link-radius-clamped', severity: 'warning', message: `Link distance ${radius} exceeds twice the simulation neighborhood (${(entry.session.lastGridCellSize * 2).toFixed(1)}); links are limited to that range. The simulation radius is not changed.`, nodeIds: [branch.spec.sourceNodeId] });
      }
      const result = entry.session.encodeLinks(commandEncoder, { branchIndex: branch.spec.index, radius, perParticle, fraction, salt: 211 });
      links.set(branch.spec.index, { buffer: result.buffer, perParticle: result.perParticle, fraction });
    }
    const unavailableAudio = program.values
      .filter((value) => value.kind === 'audio' && value.params.assets.clipId && context.audio?.(value.params.assets.clipId, sample.sourceTime, 0) === null)
      .map((value) => value.sourceNodeId);
    if (unavailableAudio.length > 0) {
      runtimeDiagnostics.push({ code: 'audio-unavailable', severity: 'warning', message: 'Audio analysis for the referenced clip is unavailable; the Audio Level node outputs its floor value. Run loudness analysis on that clip.', nodeIds: unavailableAudio });
    }
    entry.timings.links = performance.now() - linksStarted;
    entry.runtimeDiagnostics = runtimeDiagnostics;
    entry.lastUsedAt = performance.now();
    entry.targetStep = targetStep;
    entry.sourceTime = sample.sourceTime;
    entry.caughtUp = caughtUp;
    this.publishEntryStatus(entry, data);
    this.pruneIdle();
    return { layer, session: entry.session, program, render, alpha: caughtUp ? sample.alpha : 1, links };
  }

  /** Export: advances pinned export sessions to every layer's time before rendering. */
  async prepareForExport(device: GPUDevice, layers: FlockLayerSourceData[]): Promise<void> {
    for (const data of layers) {
      if (!data.program) {
        const first = data.diagnostics.find((diagnostic) => diagnostic.severity === 'error');
        throw new Error(`Flock graph is invalid and cannot be exported${first ? `: ${first.message}` : ''}`);
      }
      const entry = this.acquire(device, data.clipId, 'export', data.program, data.keyframes);
      if (!entry) {
        throw new Error(flockRuntime.getStatus(data.clipId)?.message ?? 'Flock simulation is not supported on this GPU.');
      }
      const targetStep = flockStepForSourceTime(data.program, data.sourceTime).step + 1;
      await this.loadPersistedCheckpoint(entry, targetStep, true);
      entry.session.seekCheckpoint(targetStep);
      while (entry.session.step < targetStep && !entry.session.isDisposed) {
        entry.session.advanceTo(Math.min(targetStep, entry.session.step + 240), 240);
        await device.queue.onSubmittedWorkDone();
      }
      entry.lastUsedAt = performance.now();
    }
  }

  private publishEntryStatus(entry: FlockSessionEntry, data: FlockLayerSourceData): void {
    if (entry.consumer !== 'preview') return;
    const job = this.jobs.get(entry.clipId);
    const state = data.program ? (entry.caughtUp ? 'ready' : 'computing') : 'stale';
    const now = performance.now();
    if (state === entry.lastState && now - entry.lastStatusAt < 250 && !job) return;
    entry.lastState = state;
    entry.lastStatusAt = now;
    flockRuntime.publishStatus(buildFlockRuntimeStatus({
      clipId: entry.clipId,
      state,
      program: entry.program,
      entry,
      diagnostics: [...data.diagnostics, ...entry.runtimeDiagnostics],
      job,
    }));
  }

  private pruneIdle(): void {
    const now = performance.now();
    if (now - this.lastPruneAt < 1000) return;
    this.lastPruneAt = now;
    for (const [key, entry] of this.entries) {
      const limit = entry.consumer === 'export' ? EXPORT_IDLE_DISPOSE_MS : entry.consumer === 'preview' ? PREVIEW_IDLE_DISPOSE_MS : Number.POSITIVE_INFINITY;
      if (now - entry.lastUsedAt <= limit) continue;
      entry.session.dispose();
      this.entries.delete(key);
      if (entry.consumer === 'preview') flockRuntime.clearStatus(entry.clipId);
    }
  }

  // ----- FlockRuntimeBackend -----

  getCapabilities(): FlockHostCapabilities {
    const limits = this.device?.limits;
    return {
      webgpu: typeof navigator !== 'undefined' && 'gpu' in navigator,
      gpuCompute: !!this.device,
      fallback: this.device ? 'none' : 'cpu-limited',
      cpuFallbackMaxParticles: 0,
      maxStorageBufferBindingSize: limits?.maxStorageBufferBindingSize ?? 0,
      maxBufferSize: limits?.maxBufferSize ?? 0,
      maxStorageBuffersPerShaderStage: limits?.maxStorageBuffersPerShaderStage ?? 0,
      maxComputeWorkgroupsPerDimension: limits?.maxComputeWorkgroupsPerDimension ?? 0,
    };
  }

  requestPrecompute(clipId: string, range: { start: number; end: number }, options: { persist: boolean }): Promise<FlockPrecomputeResult> {
    return runFlockPrecompute(this, clipId, range, options);
  }

  cancelPrecompute(clipId: string): void {
    const job = this.jobs.get(clipId);
    if (job) job.cancelled = true;
  }

  async sampleParticles(clipId: string, options: { maxCount: number }): Promise<FlockParticleSample | null> {
    const entry = this.entries.get(`${clipId}|preview`);
    if (!entry || entry.session.isDisposed) return null;
    const raw = await entry.session.sampleParticles(options.maxCount);
    const count = raw.length / 16;
    const values: number[] = [];
    for (let index = 0; index < count; index += 1) {
      const base = index * 16;
      values.push(raw[base], raw[base + 1], raw[base + 2], raw[base + 4], raw[base + 5], raw[base + 6], raw[base + 3], raw[base + 11]);
    }
    return { clipId, step: entry.session.step, sourceTime: entry.sourceTime, count, values: values.map((value) => Math.round(value * 1000) / 1000) };
  }

  async clearCache(clipId: string): Promise<void> {
    for (const entry of this.entries.values()) {
      if (entry.clipId !== clipId) continue;
      entry.session.clearCheckpoints();
      entry.persistedSteps = [];
      entry.persistedLoads.clear();
    }
    await flockCheckpointStore.pruneClip(clipId);
    renderHostPort.requestRender();
  }
}

let registry: FlockSimulationRegistry | null = null;

if (import.meta.hot) {
  import.meta.hot.accept();
  if (import.meta.hot.data?.flockSimulationRegistry) {
    registry = import.meta.hot.data.flockSimulationRegistry;
  }
  import.meta.hot.dispose((data) => {
    data.flockSimulationRegistry = registry;
  });
}

export function getFlockSimulationRegistry(): FlockSimulationRegistry {
  if (!registry) {
    registry = new FlockSimulationRegistry();
    flockRuntime.setBackend(registry);
  }
  return registry;
}
