// Double-buffer strategy for smooth 4D gaussian splat frame transitions.
// Manages two GPU storage buffers so that frame data can be swapped
// without GPU pipeline stalls. Only re-uploads when frames actually change.

import { Logger } from '../../../services/logger';

const log = Logger.create('FrameBufferSwapper');

/** Floats per splat in the canonical layout */
const FLOATS_PER_SPLAT = 14;

export interface PreparedFrameBuffers {
  bufferA: GPUBuffer;
  bufferB: GPUBuffer | null;
}

export class FrameBufferSwapper {
  private bufferA: GPUBuffer | null = null;
  private bufferB: GPUBuffer | null = null;
  private currentFrameA = -1;
  private currentFrameB = -1;
  private splatCount = 0;

  /**
   * Allocate double-buffered GPU storage for N splats.
   * Must be called before prepareFrames.
   */
  initialize(device: GPUDevice, splatCount: number): void {
    // If already initialized with same count, skip
    if (this.splatCount === splatCount && this.bufferA && this.bufferB) {
      return;
    }

    // Dispose old buffers
    this.disposeBuffers();

    if (splatCount <= 0) {
      log.warn('Cannot initialize with zero splats');
      return;
    }

    const byteSize = splatCount * FLOATS_PER_SPLAT * 4;

    this.bufferA = device.createBuffer({
      size: byteSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      label: 'frame-buffer-swapper-A',
    });

    this.bufferB = device.createBuffer({
      size: byteSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      label: 'frame-buffer-swapper-B',
    });

    this.splatCount = splatCount;
    this.currentFrameA = -1;
    this.currentFrameB = -1;

    log.debug('Initialized double buffers', { splatCount, byteSize });
  }

  /**
   * Ensure the requested frames are loaded into GPU buffers.
   * Returns the buffers ready for temporal blending or direct use.
   *
   * @param device - GPU device for uploads
   * @param frameA - Primary frame index
   * @param frameB - Secondary frame index (same as A for no blending)
   * @param getFrameData - Callback that returns Float32Array for a given frame index, or null if unavailable
   * @returns Object with bufferA (always set) and bufferB (null if frameB == frameA or data unavailable)
   */
  prepareFrames(
    device: GPUDevice,
    frameA: number,
    frameB: number,
    getFrameData: (frameIndex: number) => Float32Array | null,
  ): PreparedFrameBuffers | null {
    if (!this.bufferA || !this.bufferB) {
      log.warn('Buffers not initialized, call initialize() first');
      return null;
    }

    // Upload frame A if it changed
    if (frameA !== this.currentFrameA) {
      const dataA = getFrameData(frameA);
      if (dataA) {
        const expectedLength = this.splatCount * FLOATS_PER_SPLAT;
        if (dataA.length >= expectedLength) {
          const byteOffset = dataA.byteOffset;
          const byteLength = expectedLength * 4;
          device.queue.writeBuffer(this.bufferA, 0, dataA.buffer, byteOffset, byteLength);
          this.currentFrameA = frameA;
          log.debug('Uploaded frame A', { frameA });
        } else {
          log.warn('Frame A data too short', { frameA, got: dataA.length, expected: expectedLength });
        }
      } else {
        log.debug('Frame A data not available', { frameA });
        // Keep using whatever was last loaded
      }
    }

    // If both frames are the same, no need for buffer B
    if (frameA === frameB) {
      return { bufferA: this.bufferA, bufferB: null };
    }

    // Upload frame B if it changed
    if (frameB !== this.currentFrameB) {
      const dataB = getFrameData(frameB);
      if (dataB) {
        const expectedLength = this.splatCount * FLOATS_PER_SPLAT;
        if (dataB.length >= expectedLength) {
          const byteOffset = dataB.byteOffset;
          const byteLength = expectedLength * 4;
          device.queue.writeBuffer(this.bufferB, 0, dataB.buffer, byteOffset, byteLength);
          this.currentFrameB = frameB;
          log.debug('Uploaded frame B', { frameB });
        } else {
          log.warn('Frame B data too short', { frameB, got: dataB.length, expected: expectedLength });
        }
      } else {
        log.debug('Frame B data not available, falling back to A only', { frameB });
        return { bufferA: this.bufferA, bufferB: null };
      }
    }

    return { bufferA: this.bufferA, bufferB: this.bufferB };
  }

  /** Release GPU resources */
  dispose(): void {
    this.disposeBuffers();
    this.splatCount = 0;
    log.debug('FrameBufferSwapper disposed');
  }

  private disposeBuffers(): void {
    if (this.bufferA) {
      this.bufferA.destroy();
      this.bufferA = null;
    }
    if (this.bufferB) {
      this.bufferB.destroy();
      this.bufferB = null;
    }
    this.currentFrameA = -1;
    this.currentFrameB = -1;
  }
}
