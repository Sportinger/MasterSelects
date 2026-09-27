import { FlockGpuAssetRegistry } from '../../engine/flock/gpu/FlockGpuAssetRegistry';
import { loadFlockPigmentBitmap } from '../../engine/flock/gpu/flockPigmentBitmap';
import { buildFlockInstanceMeshFromModel } from '../../engine/flock/gpu/flockModelMeshGeometry';
import { loadModelRuntime } from '../../engine/native3d/assets/modelRuntimeCache/loadRuntime';
import type { WorkerGpuNativeSceneAsset } from './workerGpuNativeSceneContract';
import type { WorkerGpuFrameStackContractV1 } from './workerGpuFrameStackContract';

/** Resources are retained by media identity/revision across exact frame requests. */
export class WorkerGpuNativeSceneAssets {
  readonly registry: FlockGpuAssetRegistry;
  private readonly loaded = new Map<string, { signature: string; kind: 'image' | 'model'; decimated?: boolean }>();

  constructor(device: GPUDevice) { this.registry = new FlockGpuAssetRegistry(device); }

  modelState(id: string) {
    const asset = this.loaded.get(id);
    return asset?.kind === 'model' ? { status: 'ready' as const, decimated: asset.decimated } : { status: 'missing' as const };
  }

  require(id: string, kind: 'image' | 'model'): void {
    if (this.loaded.get(id)?.kind !== kind) throw new Error(`Worker native scene ${kind} asset '${id}' is missing`);
  }

  async prepare(stack: WorkerGpuFrameStackContractV1, guard: () => void): Promise<void> {
    const required = new Map<string, WorkerGpuNativeSceneAsset>();
    const collect = (frame: WorkerGpuFrameStackContractV1) => {
      for (const binding of frame.bindings) {
        if (binding.payload.kind === 'nested-stack') collect(binding.payload.stack);
        if (binding.payload.kind !== 'native-scene') continue;
        for (const asset of binding.payload.assets ?? []) {
          const prior = required.get(asset.id);
          if (prior && this.signature(prior) !== this.signature(asset)) throw new Error(`Conflicting native scene asset '${asset.id}'`);
          required.set(asset.id, asset);
        }
      }
    };
    collect(stack);
    for (const asset of required.values()) {
      guard();
      const signature = this.signature(asset);
      if (this.loaded.get(asset.id)?.signature === signature) continue;
      if (asset.kind === 'image') {
        const bitmap = await loadFlockPigmentBitmap(asset.url);
        try {
          guard();
          if (this.loaded.get(asset.id)?.kind === 'model') this.registry.remove(asset.id);
          this.registry.setPigment(asset.id, bitmap);
          this.loaded.set(asset.id, { signature, kind: asset.kind });
        } finally { bitmap.close(); }
      } else {
        // Keep only the compact instance mesh; full importer data is temporary.
        const runtime = await loadModelRuntime(asset.url, asset.fileName);
        try {
          guard();
          if (!runtime?.primitives.length) throw new Error(`Worker model '${asset.id}' could not be loaded`);
          const { mesh, decimated } = buildFlockInstanceMeshFromModel(runtime);
          if (this.loaded.get(asset.id)?.kind === 'image') this.registry.remove(asset.id);
          this.registry.setModel(asset.id, mesh);
          this.loaded.set(asset.id, { signature, kind: asset.kind, decimated });
        } finally {
          const images = new Set(runtime?.primitives.map(p => p.baseColorTexture?.image).filter(Boolean));
          for (const image of images) image!.close();
        }
      }
    }
    guard();
    for (const id of this.loaded.keys()) if (!required.has(id)) {
      this.registry.remove(id); this.loaded.delete(id);
    }
  }

  private signature(asset: WorkerGpuNativeSceneAsset): string {
    return JSON.stringify([asset.kind, asset.url, asset.fileName]);
  }

  dispose(): void { this.loaded.clear(); this.registry.dispose(); }
}
