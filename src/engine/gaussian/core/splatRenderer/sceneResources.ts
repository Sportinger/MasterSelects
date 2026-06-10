import { SplatOrderSorter } from '../SplatOrderSorter.ts';
import {
  createIdentityIndexBuffer,
  createSplatDataBindGroup,
  createSplatDataBuffer,
  type UploadableSplatData,
} from './sceneUpload';

interface SceneResourceLogger {
  warn(message: string, data?: unknown): void;
}

export interface SplatSceneGpuResources {
  splatBuffer: GPUBuffer;
  splatCount: number;
  /** Identity index buffer: [0, 1, 2, ..., splatCount-1] */
  identityIndexBuffer: GPUBuffer;
  /** Bind group for the render pipeline (splatData + identityIndices) */
  bindGroup: GPUBindGroup;
  /** Frame counter for sort frequency throttling */
  framesSinceSort: number;
  /** Cached sorted bind group — reused between sort frames */
  sortedBindGroup: GPUBindGroup | null;
  workerSorter: SplatOrderSorter | null;
  workerSortedBindGroup: GPUBindGroup | null;
  activeWorkerSortedBindGroup: {
    dataBuffer: GPUBuffer;
    orderBuffer: GPUBuffer;
    bindGroup: GPUBindGroup;
  } | null;
}

/** Create all per-clip GPU resources for an uploaded splat scene. */
export function createSplatSceneResources(
  device: GPUDevice,
  splatDataBindGroupLayout: GPUBindGroupLayout,
  clipId: string,
  data: UploadableSplatData,
  log: SceneResourceLogger,
): SplatSceneGpuResources {
  const splatBuffer = createSplatDataBuffer(device, clipId, data);
  const identityIndexBuffer = createIdentityIndexBuffer(device, data.splatCount, clipId);
  const bindGroup = createSplatDataBindGroup(
    device,
    splatDataBindGroupLayout,
    splatBuffer,
    identityIndexBuffer,
    `splat-bind-group-${clipId}`,
  );

  let workerSorter: SplatOrderSorter | null = null;
  let workerSortedBindGroup: GPUBindGroup | null = null;
  try {
    workerSorter = new SplatOrderSorter(device, clipId, data.data, data.splatCount);
    workerSortedBindGroup = createSplatDataBindGroup(
      device,
      splatDataBindGroupLayout,
      splatBuffer,
      workerSorter.orderBuffer,
      `splat-worker-sorted-bind-group-${clipId}`,
    );
  } catch (sorterError) {
    log.warn('Worker sorter unavailable; realtime splats will use GPU/identity ordering', {
      clipId,
      error: sorterError instanceof Error ? sorterError.message : String(sorterError),
    });
  }

  return {
    splatBuffer,
    splatCount: data.splatCount,
    identityIndexBuffer,
    bindGroup,
    framesSinceSort: 0,
    sortedBindGroup: null,
    workerSorter,
    workerSortedBindGroup,
    activeWorkerSortedBindGroup: null,
  };
}

/** Destroy all GPU handles owned by a splat scene cache entry. */
export function releaseSplatSceneResources(scene: SplatSceneGpuResources): void {
  scene.splatBuffer.destroy();
  scene.identityIndexBuffer.destroy();
  scene.workerSorter?.destroy();
}

/**
 * Bind group for worker-sorted rendering with a compute-overridden data buffer
 * (effector/particle output). Cached per scene and rebuilt only when the data
 * or order buffer changes.
 */
export function getActiveWorkerSortedBindGroup(
  device: GPUDevice,
  splatDataBindGroupLayout: GPUBindGroupLayout,
  scene: SplatSceneGpuResources,
  clipId: string,
  dataBuffer: GPUBuffer,
  orderBuffer: GPUBuffer,
): GPUBindGroup {
  const cached = scene.activeWorkerSortedBindGroup;
  if (cached && cached.dataBuffer === dataBuffer && cached.orderBuffer === orderBuffer) {
    return cached.bindGroup;
  }

  const bindGroup = createSplatDataBindGroup(
    device,
    splatDataBindGroupLayout,
    dataBuffer,
    orderBuffer,
    `splat-worker-sorted-active-bind-group-${clipId}`,
  );
  scene.activeWorkerSortedBindGroup = { dataBuffer, orderBuffer, bindGroup };
  return bindGroup;
}
