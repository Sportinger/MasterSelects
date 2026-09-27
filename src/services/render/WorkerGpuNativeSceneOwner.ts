import { NativeSceneRuntime } from '../../engine/native3d/NativeSceneRuntime';
import { FlockSimulationRuntime } from '../../engine/flock/runtime/FlockSimulationRuntime';
import { FlockGpuAssetRegistry } from '../../engine/flock/gpu/FlockGpuAssetRegistry';
import type { FlockRuntimeStatus } from '../../engine/flock/runtime/flockRuntimeApi';
import type { SceneCamera, SceneLayer3DData } from '../../engine/scene/types';
import type { LayerRenderData } from '../../engine/core/types';
import { compileFlockDefinition } from '../flock/compiler/flockCompiler';
import type { FlockProgram } from '../flock/compiler/flockProgramTypes';
import type { Keyframe } from '../../types/keyframes';
import type { WorkerGpuFrameStackContractV1 } from './workerGpuFrameStackContract';
import type { WorkerGpuNativeScenePayload } from './workerGpuNativeSceneContract';
import type { WorkerGpuFrameStackNativeSceneInput } from './workerGpuFrameStackMaterializer';

interface SceneEntry {
  simulation: FlockSimulationRuntime;
  scene: NativeSceneRuntime;
  statuses: Map<string, FlockRuntimeStatus>;
  definitions: Map<string, { signature: string; program: FlockProgram }>;
  keyframes: Map<string, { signature: string; values: Keyframe[] }>;
  layers: SceneLayer3DData[];
  camera: SceneCamera | null;
  payload: WorkerGpuNativeScenePayload | null;
}

export function hasWorkerGpuNativeScene(stack: WorkerGpuFrameStackContractV1): boolean {
  return stack.bindings.some(binding => binding.payload.kind === 'native-scene'
    || (binding.payload.kind === 'nested-stack' && hasWorkerGpuNativeScene(binding.payload.stack)));
}

/** Persistent scene/simulation state on the EXISTING target's GPU device. */
export class WorkerGpuNativeSceneOwner {
  private readonly device: GPUDevice;
  private readonly assets: FlockGpuAssetRegistry;
  private readonly scenes = new Map<string, SceneEntry>();
  private disposed = false;

  constructor(device: GPUDevice) {
    this.device = device;
    this.assets = new FlockGpuAssetRegistry(device);
  }

  private key(stack: WorkerGpuFrameStackContractV1, layerId: string): string {
    return JSON.stringify([stack.occurrenceNamespace, layerId]);
  }

  private async acquire(key: string): Promise<SceneEntry> {
    const cached = this.scenes.get(key);
    if (cached) return cached;
    const statuses = new Map<string, FlockRuntimeStatus>();
    const simulation = new FlockSimulationRuntime({
      requestRender: () => {}, // Exact requests explicitly await catch-up below.
      renderAssets: () => this.assets, audioSampler: () => () => null, audioRevision: () => 0,
      modelState: () => ({ status: 'missing' }),
      status: { getStatus: id => statuses.get(id), publishStatus: s => { statuses.set(s.clipId, s); }, clearStatus: id => { statuses.delete(id); } },
    });
    const scene = new NativeSceneRuntime({ flockRuntime: () => simulation, isRealtime: () => false, sourceFingerprint: () => undefined });
    const entry: SceneEntry = { simulation, scene, statuses, definitions: new Map(), keyframes: new Map(), layers: [], camera: null, payload: null };
    this.scenes.set(key, entry);
    await scene.initialize(1, 1);
    return entry;
  }

  /** Prepare all occurrences before encoding the frozen compositor stack. */
  async prepare(stack: WorkerGpuFrameStackContractV1, current: () => boolean): Promise<void> {
    const active = new Set<string>();
    const guard = () => { if (this.disposed || !current()) throw new Error('Native scene frame expired or target was replaced'); };
    const visit = async (frame: WorkerGpuFrameStackContractV1): Promise<void> => {
      for (const binding of frame.bindings) {
        guard();
        if (binding.payload.kind === 'nested-stack') { await visit(binding.payload.stack); continue; }
        if (binding.payload.kind !== 'native-scene') continue;
        const key = this.key(frame, binding.layerId), payload = binding.payload;
        active.add(key);
        const entry = await this.acquire(key);
        guard();
        entry.payload = null;
        entry.camera = { ...payload.camera, viewMatrix: new Float32Array(payload.camera.viewMatrix), projectionMatrix: new Float32Array(payload.camera.projectionMatrix) };
        entry.layers = payload.layers.map(layer => {
          const base = { layerId: layer.layerId, clipId: layer.clipId, worldMatrix: new Float32Array(layer.worldMatrix),
            opacity: layer.opacity, blendMode: 'normal' as const, sourceWidth: payload.width, sourceHeight: payload.height };
          if (layer.kind === 'primitive') return { ...base, kind: 'primitive', meshType: layer.meshType, wireframe: layer.wireframe };
          const signature = JSON.stringify(layer.definition);
          let compiled = entry.definitions.get(layer.clipId);
          if (!compiled || compiled.signature !== signature) {
            const result = compileFlockDefinition(layer.definition);
            if (!result.ok) throw new Error(`Worker Flock graph failed: ${result.diagnostics.map(d => d.message).join('; ')}`);
            // Resource snapshots are a separate integration step. Never silently
            // substitute missing image/model/audio inputs with different pixels.
            if (result.program.assets.images.length || result.program.assets.models.length || result.program.assets.audioClips.length) {
              throw new Error('Worker native scene asset/audio snapshots are not available for this graph');
            }
            compiled = { signature, program: result.program };
            entry.definitions.set(layer.clipId, compiled);
          }
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
            const plan = entry.simulation.prepare(this.device, encoder, layer, { realtime: false });
            if (!plan) throw new Error(entry.statuses.get(layer.clipId)?.message ?? 'Worker Flock simulation could not prepare');
            this.device.queue.submit([encoder.finish()]);
            await this.device.queue.onSubmittedWorkDone();
            ready = entry.simulation.entries.get(`${layer.clipId}|${layer.flock.consumer}`)?.caughtUp === true;
          }
        }
        guard();
        entry.payload = payload;
      }
    };
    await visit(stack);
    guard();
    for (const [key, entry] of this.scenes) if (!active.has(key)) {
      entry.scene.dispose(); entry.simulation.dispose(); this.scenes.delete(key);
    }
  }

  render(input: WorkerGpuFrameStackNativeSceneInput): LayerRenderData {
    const entry = this.scenes.get(this.key(input.frameStack, input.binding.layerId));
    if (this.disposed || !entry?.camera || entry.payload !== input.payload) throw new Error('Native scene was not prepared for this frozen frame');
    const textureView = entry.scene.renderScene(this.device, entry.layers, entry.camera, [], false);
    if (!textureView) throw new Error('Worker native scene produced no texture');
    return { layer: input.layer, isVideo: false, isDynamic: true, externalTexture: null, textureView,
      sourceWidth: input.payload.width, sourceHeight: input.payload.height, targetMediaTime: input.payload.timelineTime,
      previewPath: 'worker-gpu-frame-stack:native-scene' };
  }

  dispose(): void {
    this.disposed = true;
    for (const entry of this.scenes.values()) { entry.scene.dispose(); entry.simulation.dispose(); }
    this.scenes.clear(); this.assets.dispose();
  }
}
