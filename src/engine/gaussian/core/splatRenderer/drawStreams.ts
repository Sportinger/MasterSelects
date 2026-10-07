import { getActiveWorkerSortedBindGroup, type SplatSceneGpuResources } from './sceneResources';
import {
  createSplatDataBindGroup,
  reuseSplatDataBindGroup,
  type CachedSplatDataBindGroup,
} from './sceneUpload';
import type { GpuSortOrder } from './sortGlue';

/**
 * Per-stream draw state of the splat renderer. A stream is one uploaded scene drawn
 * through one graph branch: every branch of a splat graph renders the same scene with
 * its own point set, so cull counts, GPU sort cadence and the GPU order belong to the
 * stream instead of the scene or the renderer. The stream key doubles as the sort-pass
 * output key, which gives every stream its own sorted-index buffer.
 */
export interface SplatDrawStream {
  readonly key: string;
  readonly sceneKey: string;
  /** Last visible count read back from this stream's cull pass. */
  visibleCount?: number;
  /** Frames since this stream's last GPU sort (sort frequency throttling). */
  framesSinceSort: number;
  /** Splat count the stream's GPU order was built for; another count needs a new sort. */
  sortedSourceCount: number;
  /** Bind group for (active data buffer, this stream's order); rebuilt when either changes. */
  orderBindGroup: CachedSplatDataBindGroup | null;
  /** Renderer frame of the last draw; idle streams are released. */
  lastFrame: number;
}

/** Renderer frames after which an undrawn stream (e.g. a deleted graph branch) is released. */
const DEFAULT_IDLE_FRAMES = 600;

export class SplatDrawStreams {
  private streams = new Map<string, SplatDrawStream>();
  private frame = 0;
  private readonly idleFrames: number;

  constructor(idleFrames = DEFAULT_IDLE_FRAMES) {
    this.idleFrames = idleFrames;
  }

  get(sceneKey: string, branchId?: string): SplatDrawStream {
    const key = branchId === undefined ? sceneKey : JSON.stringify([sceneKey, branchId]);
    let stream = this.streams.get(key);
    if (!stream) {
      stream = { key, sceneKey, framesSinceSort: 0, sortedSourceCount: -1, orderBindGroup: null, lastFrame: this.frame };
      this.streams.set(key, stream);
    }
    stream.lastFrame = this.frame;
    return stream;
  }

  /** Start a renderer frame and release streams that were not drawn for `idleFrames` frames. */
  beginFrame(releaseKey: (streamKey: string) => void): void {
    this.frame++;
    for (const [key, stream] of this.streams) {
      if (this.frame - stream.lastFrame <= this.idleFrames) continue;
      this.streams.delete(key);
      releaseKey(key);
    }
  }

  /** Forget every stream drawn from `sceneKey`; `releaseKey` frees each stream's GPU order. */
  release(sceneKey: string, releaseKey: (streamKey: string) => void): void {
    for (const [key, stream] of this.streams) {
      if (stream.sceneKey !== sceneKey) continue;
      this.streams.delete(key);
      releaseKey(key);
    }
  }

  clear(): void {
    this.streams.clear();
  }
}

export interface SplatDrawBindGroupOptions {
  device: GPUDevice;
  layout: GPUBindGroupLayout;
  clipId: string;
  scene: SplatSceneGpuResources;
  stream: SplatDrawStream;
  activeSplatBuffer: GPUBuffer;
  canUseWorkerSort: boolean;
  gpuOrder: GpuSortOrder | null;
  cullIndexBuffer: GPUBuffer | null;
}

/** Splat data + index bind group for one draw: worker order, stream GPU order, cull or identity. */
export function resolveSplatDrawBindGroup(options: SplatDrawBindGroupOptions): GPUBindGroup {
  const { device, layout, scene, stream, activeSplatBuffer } = options;
  if (options.canUseWorkerSort && scene.workerSorter && scene.workerSortedBindGroup) {
    return activeSplatBuffer === scene.splatBuffer
      ? scene.workerSortedBindGroup
      : getActiveWorkerSortedBindGroup(device, layout, scene, options.clipId, activeSplatBuffer, scene.workerSorter.orderBuffer);
  }
  if (options.gpuOrder) {
    // Bound to this frame's data buffer, so a reused order never keeps a replaced
    // particle/effector/graph output alive in a cached bind group.
    stream.orderBindGroup = reuseSplatDataBindGroup(device, layout, stream.orderBindGroup,
      activeSplatBuffer, options.gpuOrder.buffer, `splat-sorted-bind-group-${stream.key}`);
    return stream.orderBindGroup.bindGroup;
  }
  if (options.cullIndexBuffer || activeSplatBuffer !== scene.splatBuffer) {
    return createSplatDataBindGroup(device, layout, activeSplatBuffer,
      options.cullIndexBuffer ?? scene.identityIndexBuffer, `splat-active-bind-group-${options.clipId}`);
  }
  return scene.bindGroup; // identity indices + original data
}
