import { SplatOrderSorter } from '../core/SplatOrderSorter';
import { createSplatDataBindGroup } from '../core/splatRenderer/sceneUpload';
import type { SplatSceneGpuResources } from '../core/splatRenderer/sceneResources';
import { compactCropIndices } from './SplatCropCache';

interface Entry { source: Float32Array; indices?: Uint32Array; key: string; scene: SplatSceneGpuResources }
/** Independent background ordering for each immutable sampled/cropped point stream. */
export class SplatBranchSortCache {
  private entries = new Map<string, Entry>();
  private retired: SplatOrderSorter[] = [];
  prepare(device: GPUDevice, layout: GPUBindGroupLayout, id: string, branch: string,
    source: Float32Array, base: SplatSceneGpuResources, sourceCount: number,
    sampling: { count: number; offset: number; remapped: boolean }, indices?: Uint32Array): SplatSceneGpuResources {
    const cacheId = JSON.stringify([id, branch]);
    const key = JSON.stringify([sourceCount, sampling.count, sampling.offset, sampling.remapped]);
    const old = this.entries.get(cacheId);
    if (old?.source === source && old.indices === indices && old.key === key) return old.scene;
    if (old?.scene.workerSorter) this.retired.push(old.scene.workerSorter);
    if (!old && this.entries.size >= 24) {
      const first = this.entries.keys().next().value!;
      const evicted = this.entries.get(first)!;
      if (evicted.scene.workerSorter) this.retired.push(evicted.scene.workerSorter);
      this.entries.delete(first);
    }
    const ids = indices ?? compactCropIndices(source, sourceCount, sampling, []);
    const scene = { ...base, workerSorter: null, workerSortedBindGroup: null, activeWorkerSortedBindGroup: null,
      sortedBindGroup: null, framesSinceSort: 0 } as SplatSceneGpuResources;
    try {
      scene.workerSorter = new SplatOrderSorter(device, cacheId, source, ids.length, ids);
      scene.workerSortedBindGroup = createSplatDataBindGroup(device, layout, base.splatBuffer, scene.workerSorter.orderBuffer, 'splat-branch-worker');
    } catch {
      scene.workerSorter?.destroy(); scene.workerSorter = null;
    }
    this.entries.set(cacheId, { source, indices, key, scene });
    return scene;
  }
  beginFrame() { for (const sorter of this.retired) sorter.destroy(); this.retired = []; }
  release(id: string) {
    for (const [key, entry] of this.entries) if (JSON.parse(key)[0] === id) {
      if (entry.scene.workerSorter) this.retired.push(entry.scene.workerSorter);
      this.entries.delete(key);
    }
  }
  dispose() { for (const e of this.entries.values()) e.scene.workerSorter?.destroy(); this.entries.clear(); this.beginFrame(); }
}
