import { getPtStatus } from '../../engine/native3d/pathtrace/runtime/ptStatus';
import type { WorkerPathTraceReport } from './workerPathTraceReport';
import { NativeSceneRuntime } from '../../engine/native3d/NativeSceneRuntime';
import { FlockSimulationRuntime } from '../../engine/flock/runtime/FlockSimulationRuntime';
import { WorkerGpuNativeSceneAssets } from './WorkerGpuNativeSceneAssets';
import { WorkerGpuNativeSceneAudio } from './WorkerGpuNativeSceneAudio';
import type { FlockRuntimeStatus } from '../../engine/flock/runtime/flockRuntimeApi';
import type { SceneCamera, SceneLayer3DData } from '../../engine/scene/types';
import type { LayerRenderData } from '../../engine/core/types';
import { compileFlockDefinition } from '../flock/compiler/flockCompiler';
import type { FlockProgram } from '../flock/compiler/flockProgramTypes';
import type { Keyframe } from '../../types/keyframes';
import type { WorkerGpuFrameStackContractV1 } from './workerGpuFrameStackContract';
import type { WorkerGpuNativeScenePayload } from './workerGpuNativeSceneContract';
import type { WorkerGpuFrameStackNativeSceneInput } from './workerGpuFrameStackMaterializer';
import type { WorkerFlockStatusSnapshot } from './workerFlockStatus';
import { buildFlockRuntimeStatus } from '../../engine/flock/runtime/flockRuntimeStatus';
import { WorkerNativeSceneDeadline } from './workerNativeSceneCatchUp';
import { WorkerFlockControls } from './workerFlockControls';
import { flockGpuTimings } from '../../engine/flock/gpu/FlockGpuTimings';

interface SceneEntry {
  compositionId?: string;
  audio: WorkerGpuNativeSceneAudio;
  simulation: FlockSimulationRuntime;
  scene: NativeSceneRuntime;
  statuses: Map<string, FlockRuntimeStatus>;
  definitions: Map<string, { signature: string; program: FlockProgram }>;
  keyframes: Map<string, { signature: string; values: Keyframe[] }>;
  layers: SceneLayer3DData[];
  camera: SceneCamera | null;
  payload: WorkerGpuNativeScenePayload | null;
  preparingPayload: WorkerGpuNativeScenePayload | null;
}

export function hasWorkerGpuNativeScene(stack: WorkerGpuFrameStackContractV1): boolean {
  return stack.bindings.some(binding => binding.payload.kind === 'native-scene'
    || (binding.payload.kind === 'nested-stack' && hasWorkerGpuNativeScene(binding.payload.stack)));
}

/** Persistent scene/simulation state on the EXISTING target's GPU device. */
export class WorkerGpuNativeSceneOwner {
  private readonly device: GPUDevice;
  private readonly assets: WorkerGpuNativeSceneAssets;
  private readonly scenes = new Map<string, SceneEntry>();
  private disposed = false;
  readonly controls = new WorkerFlockControls((compositionId, clipId) => {
    const entries = [...this.scenes.values()].filter(entry => entry.compositionId === compositionId
      && entry.simulation.latestInputs.has(clipId));
    return entries.length === 1 ? entries[0].simulation : null;
  });
  private preparation = { steps: 0, prepareCalls: 0, encodeMs: 0, waitMs: 0, deferredSteps: 0 };

  constructor(device: GPUDevice) {
    this.device = device;
    this.assets = new WorkerGpuNativeSceneAssets(device);
  }

  private key(stack: WorkerGpuFrameStackContractV1, layerId: string): string {
    return JSON.stringify([stack.occurrenceNamespace, layerId]);
  }

  private async acquire(key: string): Promise<SceneEntry> {
    const cached = this.scenes.get(key);
    if (cached) return cached;
    const statuses = new Map<string, FlockRuntimeStatus>();
    const audio = new WorkerGpuNativeSceneAudio();
    const simulation = new FlockSimulationRuntime({
      requestRender: () => {}, // Exact requests explicitly await catch-up below.
      renderAssets: () => this.assets.registry, audioSampler: id => audio.sampler(id), audioRevision: () => 0,
      audioFingerprint: (id, audioClipIds) => audio.fingerprint(id, audioClipIds),
      modelState: id => this.assets.modelState(id),
      status: { getStatus: id => statuses.get(id), publishStatus: s => { statuses.set(s.clipId, s); }, clearStatus: id => { statuses.delete(id); } },
    });
    // The path tracer asks for more frames while a still image converges; the main thread schedules them.
    const scene = new NativeSceneRuntime({ flockRuntime: () => simulation, isRealtime: () => false, sourceFingerprint: () => undefined,
      requestRender: () => { this.pathTraceNeedsFrame = true; } });
    const entry: SceneEntry = { audio, simulation, scene, statuses, definitions: new Map(), keyframes: new Map(), layers: [], camera: null, payload: null, preparingPayload: null };
    this.scenes.set(key, entry);
    await scene.initialize(1, 1);
    return entry;
  }

  /** Prepare all occurrences before encoding the frozen compositor stack. */
  async prepare(stack: WorkerGpuFrameStackContractV1, current: () => boolean, clock = Date.now): Promise<void> {
    this.preparation = { steps: 0, prepareCalls: 0, encodeMs: 0, waitMs: 0, deferredSteps: 0 };
    const active = new Set<string>();
    const deadline = new WorkerNativeSceneDeadline(stack.frame.expireAfterMs, clock, () => !this.disposed && current());
    const guard = deadline.assertCurrent;
    await this.assets.prepare(stack, guard);
    const visit = async (frame: WorkerGpuFrameStackContractV1): Promise<void> => {
      for (const binding of frame.bindings) {
        guard();
        if (binding.payload.kind === 'nested-stack') { await visit(binding.payload.stack); continue; }
        if (binding.payload.kind !== 'native-scene') continue;
        const key = this.key(frame, binding.layerId), payload = binding.payload;
        active.add(key);
        const entry = await this.acquire(key);
        entry.compositionId = stack.frame.compositionId;
        guard();
        entry.payload = null;
        entry.preparingPayload = payload;
        await entry.audio.prepare(payload.layers, guard);
        entry.camera = { ...payload.camera, viewMatrix: new Float32Array(payload.camera.viewMatrix), projectionMatrix: new Float32Array(payload.camera.projectionMatrix) };
        entry.layers = payload.layers.map(layer => {
          const base = { layerId: layer.layerId, clipId: layer.clipId, worldMatrix: new Float32Array(layer.worldMatrix),
            opacity: layer.opacity, blendMode: 'normal' as const, sourceWidth: payload.width, sourceHeight: payload.height };
          if (layer.kind === 'primitive') return { ...base, kind: 'primitive', meshType: layer.meshType, wireframe: layer.wireframe };
          if (layer.kind === 'light') return { ...base, kind: 'light', lightSettings: { ...layer.lightSettings } };
          if (layer.kind === 'strands') return { ...base, kind: 'strands', strands: { clipId: layer.clipId, effectId: layer.effectId, program: layer.program } };
          const signature = JSON.stringify(layer.definition);
          let compiled = entry.definitions.get(layer.clipId);
          if (!compiled || compiled.signature !== signature) {
            const result = compileFlockDefinition(layer.definition);
            if (!result.ok) throw new Error(`Worker Flock graph failed: ${result.diagnostics.map(d => d.message).join('; ')}`);
            compiled = { signature, program: result.program };
            entry.definitions.set(layer.clipId, compiled);
          }
          for (const id of compiled.program.assets.images) this.assets.require(id, 'image');
          for (const id of compiled.program.assets.models) this.assets.require(id, 'model');
          entry.audio.require(layer.clipId, compiled.program.assets.audioClips);
          const keySignature = JSON.stringify(layer.keyframes);
          let keys = entry.keyframes.get(layer.clipId);
          if (!keys || keys.signature !== keySignature) {
            keys = { signature: keySignature, values: layer.keyframes };
            entry.keyframes.set(layer.clipId, keys);
          }
          return { ...base, kind: 'flock', flock: { clipId: layer.clipId, definition: layer.definition,
            program: compiled.program, diagnostics: compiled.program.diagnostics, keyframes: keys.values,
            sourceTime: layer.sourceTime, consumer: frame.frame.intent === 'export' ? 'export' : 'preview' } };
        });
        const retained = new Set(payload.layers.filter(layer => layer.kind === 'flock').map(layer => layer.clipId));
        for (const id of entry.definitions.keys()) if (!retained.has(id)) {
          entry.definitions.delete(id); entry.keyframes.delete(id); entry.statuses.delete(id);
          entry.simulation.releaseClip(id);
        }
        for (const layer of entry.layers) {
          if (layer.kind !== 'flock') continue;
          let ready = false;
          while (!ready) {
            guard();
            const encoder = this.device.createCommandEncoder();
            const sessionKey = `${layer.clipId}|${layer.flock.consumer}`;
            const beforeStep = entry.simulation.entries.get(sessionKey)?.session.step ?? 0;
            const encodeStarted = performance.now();
            const plan = entry.simulation.prepare(this.device, encoder, layer, {
              realtime: false, submissionWindow: 1, previewStepBudget: 4,
            });
            if (!plan) throw new Error(entry.statuses.get(layer.clipId)?.message ?? 'Worker Flock simulation could not prepare');
            this.device.queue.submit([encoder.finish()]);
            const session = entry.simulation.entries.get(sessionKey);
            const afterStep = session?.session.step ?? 0;
            const steps = Math.max(0, afterStep < beforeStep ? afterStep : afterStep - beforeStep);
            this.preparation.encodeMs += performance.now() - encodeStarted;
            this.preparation.steps += steps;
            this.preparation.prepareCalls++;
            ready = session?.caughtUp === true;
            if (ready) {
              // Simulation and rendering share this queue. The compositor's final
              // fence proves completion; a CPU round trip here would idle it.
              // Do not count these steps as resumable completed GPU work yet.
              this.preparation.deferredSteps += steps;
            } else {
              const waitStarted = performance.now();
              await this.device.queue.onSubmittedWorkDone();
              this.preparation.waitMs += performance.now() - waitStarted;
              deadline.completed(beforeStep, afterStep);
              // The asynchronous GPU fence already yields to the browser. A fixed
              // timer here adds latency to every catch-up block and increases
              // the backlog required by the next playback frame.
            }
          }
        }
        guard();
        entry.payload = payload;
        entry.preparingPayload = null;
      }
    };
    await visit(stack);
    guard();
    for (const [key, entry] of this.scenes) if (!active.has(key)) {
      entry.scene.dispose(); entry.simulation.dispose(); entry.audio.dispose(); this.scenes.delete(key);
    }
  }

  render(input: WorkerGpuFrameStackNativeSceneInput): LayerRenderData {
    const entry = this.scenes.get(this.key(input.frameStack, input.binding.layerId));
    if (this.disposed || !entry?.camera || entry.payload !== input.payload) throw new Error('Native scene was not prepared for this frozen frame');
    const textureView = entry.scene.renderScene(this.device, entry.layers, entry.camera, [], false, null, null, 'main', undefined,
      { renderSettings: input.payload.renderSettings });
    if (!textureView) throw new Error('Worker native scene produced no texture');
    return { layer: input.layer, isVideo: false, isDynamic: true, externalTexture: null, textureView,
      sourceWidth: input.payload.width, sourceHeight: input.payload.height, targetMediaTime: input.payload.timelineTime,
      previewPath: 'worker-gpu-frame-stack:native-scene' };
  }

  private pathTraceNeedsFrame = false;

  /** The path tracer's status and whether it asked for another frame since the last report. */
  pathTraceReport(): WorkerPathTraceReport {
    const report = { status: getPtStatus('main'), needsFrame: this.pathTraceNeedsFrame };
    this.pathTraceNeedsFrame = false;
    return report;
  }

  /** Snapshot only prepared occurrences belonging to this exact frame. */
  flockStatusSnapshot(stack: WorkerGpuFrameStackContractV1, includePreparing = false): WorkerFlockStatusSnapshot {
    const occurrences: WorkerFlockStatusSnapshot['occurrences'][number][] = [];
    const visit = (frame: WorkerGpuFrameStackContractV1) => {
      const statuses: FlockRuntimeStatus[] = [];
      occurrences.push({ compositionId: frame.frame.compositionId, occurrenceNamespace: frame.occurrenceNamespace, statuses });
      for (const binding of frame.bindings) {
        if (binding.payload.kind === 'nested-stack') { visit(binding.payload.stack); continue; }
        if (binding.payload.kind !== 'native-scene') continue;
        const entry = this.scenes.get(this.key(frame, binding.layerId));
        if (!entry || (entry.payload !== binding.payload && (!includePreparing || entry.preparingPayload !== binding.payload))) continue;
        for (const layer of binding.payload.layers) {
          if (layer.kind !== 'flock') continue;
          const consumer = frame.frame.intent === 'export' ? 'export' : 'preview';
          const session = entry.simulation.entries.get(`${layer.clipId}|${consumer}`);
          if (!session) continue;
          // Main UI publications are throttled. A frame result must describe this
          // exact session, including a fast backward seek within that interval.
          statuses.push(buildFlockRuntimeStatus({ clipId: layer.clipId,
            state: session.stale ? 'stale' : session.caughtUp && entry.payload === binding.payload ? 'ready' : 'computing',
            program: session.program, entry: session,
            diagnostics: [...session.program.diagnostics, ...session.runtimeDiagnostics],
            job: entry.simulation.jobs.get(layer.clipId) }));
        }
      }
    };
    visit(stack);
    const limits = this.device.limits;
    return { compositionId: stack.frame.compositionId, occurrences, preparation: { ...this.preparation },
      gpuTimings: { ...flockGpuTimings(this.device).snapshot(), capturedAt: Date.now() }, capabilities: {
      webgpu: true, gpuCompute: true, fallback: 'none', cpuFallbackMaxParticles: 0,
      maxStorageBufferBindingSize: limits.maxStorageBufferBindingSize,
      maxBufferSize: limits.maxBufferSize,
      maxStorageBuffersPerShaderStage: limits.maxStorageBuffersPerShaderStage,
      maxComputeWorkgroupsPerDimension: limits.maxComputeWorkgroupsPerDimension,
    } };
  }

  dispose(): void {
    this.disposed = true;
    this.controls.dispose();
    for (const entry of this.scenes.values()) { entry.scene.dispose(); entry.simulation.dispose(); entry.audio.dispose(); }
    this.scenes.clear(); this.assets.dispose();
  }
}
