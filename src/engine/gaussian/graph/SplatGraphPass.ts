import { SplatGraphCompute, prepareSplatSampling } from './SplatGraphCompute';
import { SplatCropCache } from './SplatCropCache';
import { SplatBranchSortCache } from './SplatBranchSortCache';
import type { SplatGraphBranch } from '../../../types/splatGraph';
import type { SplatSceneGpuResources } from '../core/splatRenderer/sceneResources';
import type { SplatCameraParams } from '../core/splatRenderer/cameraUniforms';

/** Owns graph attributes, compact source streams and their independent sort state. */
export class SplatGraphPass {
  private compute = new SplatGraphCompute();
  private crops = new SplatCropCache();
  private ordering = new SplatBranchSortCache();
  execute(device: GPUDevice, encoder: GPUCommandEncoder, layout: GPUBindGroupLayout, id: string,
    scene: SplatSceneGpuResources, buffer: GPUBuffer, count: number, source: Float32Array | undefined,
    branch: SplatGraphBranch | undefined, time: number, world: Float32Array, camera: SplatCameraParams, precise: boolean) {
    const operations = branch?.operations ?? [];
    const sampling = prepareSplatSampling(operations, count, branch?.budget);
    const cropped = source ? this.crops.prepare(device, id, source, count, sampling, operations) : undefined;
    const outputCount = cropped?.count ?? sampling.count;
    const moving = operations.some(op => op.kind === 'particles' || (op.kind === 'noise' && op.values[0] === 0));
    const remapped = !!cropped || sampling.remapped;
    if (source && remapped && !moving && !precise && outputCount > 0) {
      scene = this.ordering.prepare(device, layout, id, branch?.id ?? 'surface', source, scene, count, sampling, cropped?.indices);
    }
    if (outputCount > 0 && (operations.length || remapped)) {
      const v = camera.viewMatrix;
      const eye = { x: -(v[0] * v[12] + v[1] * v[13] + v[2] * v[14]), y: -(v[4] * v[12] + v[5] * v[13] + v[6] * v[14]), z: -(v[8] * v[12] + v[9] * v[13] + v[10] * v[14]) };
      buffer = this.compute.execute(device, encoder, buffer, outputCount, sampling.operations, time, world, eye, count, sampling.offset, sampling.remapped, cropped?.buffer);
    }
    // Remapping changes indices, not positions. Use the matching worker whenever available.
    const forceGpuSort = moving || (remapped && (!source || precise || !scene.workerSorter || !scene.workerSortedBindGroup));
    return { scene, buffer, count: outputCount, forceGpuSort };
  }
  beginFrame() { this.compute.beginFrame(); this.crops.beginFrame(); this.ordering.beginFrame(); }
  release(id: string) { this.crops.release(id); this.ordering.release(id); }
  dispose() { this.compute.dispose(); this.crops.dispose(); this.ordering.dispose(); }
}
