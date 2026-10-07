import { SORT_THRESHOLD } from './renderParams';

interface WorkerSorterLike {
  readonly hasSortedOrder: boolean;
  requestSort(viewMatrix: Float32Array, worldMatrix: Float32Array, requestedCount: number): void;
  applyPending(queue: GPUQueue): number;
}

export interface WorkerSortSceneState {
  framesSinceSort: number;
  workerSorter: WorkerSorterLike | null;
  workerSortedBindGroup: GPUBindGroup | null;
}

export interface WorkerSortFrameResult {
  canUseWorkerSort: boolean;
  usedWorkerSort: boolean;
  drawCount: number;
}

export function updateWorkerSortFrame(
  scene: WorkerSortSceneState,
  queue: GPUQueue,
  viewMatrix: Float32Array,
  worldMatrix: Float32Array,
  effectiveSplatCount: number,
  sortFrequency: number,
  precise: boolean,
): WorkerSortFrameResult {
  const canUseWorkerSort = !precise &&
    sortFrequency !== 0 &&
    scene.workerSorter !== null &&
    scene.workerSortedBindGroup !== null;

  let drawCount = effectiveSplatCount;
  let usedWorkerSort = false;

  if (canUseWorkerSort && scene.workerSorter) {
    const requestThisFrame = !scene.workerSorter.hasSortedOrder ||
      sortFrequency <= 1 ||
      scene.framesSinceSort + 1 >= sortFrequency;

    if (requestThisFrame) {
      scene.workerSorter.requestSort(viewMatrix, worldMatrix, effectiveSplatCount);
      scene.framesSinceSort = 0;
    } else {
      scene.framesSinceSort++;
    }

    const sortedCount = scene.workerSorter.applyPending(queue);
    if (sortedCount >= 0) {
      drawCount = Math.min(sortedCount, effectiveSplatCount);
    }
    usedWorkerSort = scene.workerSorter.hasSortedOrder;
  }

  return { canUseWorkerSort, usedWorkerSort, drawCount };
}

export interface GpuSortOrder {
  buffer: GPUBuffer;
  /** Valid sorted entries in `buffer`. */
  count: number;
}

interface GpuSortPassLike {
  readonly isInitialized: boolean;
  execute(
    device: GPUDevice,
    commandEncoder: GPUCommandEncoder,
    splatBuffer: GPUBuffer,
    indexBuffer: GPUBuffer,
    visibleCount: number,
    viewMatrix: Float32Array,
    worldMatrix: Float32Array,
    outputKey: string,
  ): GPUBuffer | null;
  getOrder(outputKey: string): GpuSortOrder | null;
}

/** GPU sort cadence of one draw stream; `key` is also its sort-pass output key. */
export interface GpuSortStreamState {
  readonly key: string;
  framesSinceSort: number;
  sortedSourceCount: number;
}

export interface GpuSortFrameOptions {
  stream: GpuSortStreamState;
  sortPass: GpuSortPassLike;
  device: GPUDevice;
  commandEncoder: GPUCommandEncoder;
  activeSplatBuffer: GPUBuffer;
  identityIndexBuffer: GPUBuffer;
  cullIndexBuffer: GPUBuffer | null;
  effectiveSplatCount: number;
  drawCount: number;
  canUseWorkerSort: boolean;
  precise: boolean;
  hasValidatedCullResult: boolean;
  sortFrequency: number;
  viewMatrix: Float32Array;
  worldMatrix: Float32Array;
}

/**
 * GPU depth order for this draw: sorted now, or on frames that skip sorting the stream's
 * own last order (each stream sorts into its own buffer, so a skipped frame never picks up
 * another layer's order). Null when the draw uses cull or identity indices instead.
 */
export function updateGpuSortFrame(options: GpuSortFrameOptions): GpuSortOrder | null {
  const { stream, sortPass, sortFrequency } = options;
  const shouldSort = !options.canUseWorkerSort &&
    options.effectiveSplatCount > SORT_THRESHOLD &&
    (options.precise || options.hasValidatedCullResult);
  // Frequency 0 turns sorting off: draw the current visible set, never a frozen order.
  if (!shouldSort || sortFrequency === 0) return null;

  // An order is only valid for the splat set it was built from.
  const lastOrder = stream.sortedSourceCount === options.effectiveSplatCount
    ? sortPass.getOrder(stream.key)
    : null;
  const sortThisFrame = !lastOrder || sortFrequency <= 1 || stream.framesSinceSort + 1 >= sortFrequency;

  if (sortThisFrame && sortPass.isInitialized) {
    const sourceIndexBuffer = options.precise
      ? options.identityIndexBuffer
      : (options.cullIndexBuffer ?? options.identityIndexBuffer);
    const sortCount = options.precise
      ? options.effectiveSplatCount
      : (options.hasValidatedCullResult ? options.drawCount : options.effectiveSplatCount);

    const sorted = sortPass.execute(
      options.device,
      options.commandEncoder,
      options.activeSplatBuffer,
      sourceIndexBuffer,
      sortCount,
      options.viewMatrix,
      options.worldMatrix,
      stream.key,
    );

    if (sorted) {
      stream.framesSinceSort = 0;
      stream.sortedSourceCount = options.effectiveSplatCount;
      return { buffer: sorted, count: sortCount };
    }
  } else {
    stream.framesSinceSort++;
  }

  return lastOrder;
}
