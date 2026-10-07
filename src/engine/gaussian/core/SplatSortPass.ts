// GPU bitonic sort compute pass for gaussian splats.
// Sorts visible splat indices by view-space depth (back-to-front)
// for correct alpha-blended compositing.
//
// Uses bitonic merge sort:
//   1. Compute depth keys (float → sortable u32)
//   2. Iterative bitonic compare-and-swap steps
//
// Complexity: O(n log²n) comparisons, fully parallel on GPU.

import { Logger } from '../../../services/logger';
import { GpuFrameBuffers, GpuUniformRing } from '../../core/gpuUniformRing';
import shaderSource from '../shaders/radixSort.wgsl?raw';

const log = Logger.create('SplatSortPass');

/** Uniform buffer: mat4x4f view (64) + mat4x4f world (64) + 4x u32 params = 144 bytes */
const SORT_UNIFORM_SIZE = 144;

export interface BitonicSortPlan {
  visibleCount: number;
  paddedCount: number;
  workgroupCount: number;
}

export class SplatSortPass {
  private device: GPUDevice | null = null;
  private depthKeyPipeline: GPUComputePipeline | null = null;
  private bitonicStepPipeline: GPUComputePipeline | null = null;

  // Depth keys are scratch shared by every sort; each output key (one per draw stream)
  // owns its sorted-index buffer, so a caller that skips sorting can redraw its own last
  // order instead of whatever another layer sorted last. Growing or releasing a buffer
  // retires it until the next frame: passes recorded earlier still reference it.
  private sortBuffers: GpuFrameBuffers | null = null;
  /** Valid entries in each output key's buffer since its last sort. */
  private orderCounts = new Map<string, number>();
  /** One uniform slot per dispatch (depth keys + every bitonic step of every layer). */
  private uniformRing: GpuUniformRing | null = null;
  beginFrame(): void { this.uniformRing?.beginFrame(); this.sortBuffers?.beginFrame(); }

  // Bind group layouts
  private splatDataLayout: GPUBindGroupLayout | null = null;
  private uniformLayout: GPUBindGroupLayout | null = null;
  private sortBufferLayout: GPUBindGroupLayout | null = null;

  private _initialized = false;

  get isInitialized(): boolean {
    return this._initialized;
  }

  initialize(device: GPUDevice, maxSplatCount = 0): void {
    if (this._initialized && this.device === device) {
      // Scenes may upload mid-frame; grow without disposing buffers already recorded.
      try {
        this.ensureKeyBuffer(maxSplatCount);
      } catch (err) {
        log.error('Failed to grow SplatSortPass buffers', err);
      }
      return;
    }

    this.dispose();
    this.device = device;

    try {
      this.createPipelines();
      this.ensureKeyBuffer(maxSplatCount);
      this._initialized = true;
      log.info('SplatSortPass initialized', { maxSplatCount });
    } catch (err) {
      log.error('Failed to initialize SplatSortPass', err);
      this.device = null;
      this._initialized = false;
    }
  }

  /**
   * Sort visible splat indices by depth (back-to-front) into `outputKey`'s own buffer.
   *
   * @param indexBuffer   — visible indices from the cull pass (or identity)
   * @param visibleCount  — number of visible splats to sort
   * @param viewMatrix    — the camera view matrix (for depth computation)
   * @param outputKey     — draw stream that owns the result; see getOrder()
   * @returns the key's GPUBuffer with the sorted indices, or null on failure
   */
  execute(
    device: GPUDevice,
    commandEncoder: GPUCommandEncoder,
    splatBuffer: GPUBuffer,
    indexBuffer: GPUBuffer,
    visibleCount: number,
    viewMatrix: Float32Array,
    worldMatrix: Float32Array,
    outputKey: string,
  ): GPUBuffer | null {
    if (!this._initialized || !this.depthKeyPipeline || !this.bitonicStepPipeline) {
      log.warn('Cannot execute: sort pass not initialized');
      return null;
    }

    try {
      const sortPlan = buildBitonicSortPlan(visibleCount);
      const output = this.sortBuffers!.ensure(orderBufferKey(outputKey), sortCapacity(sortPlan.paddedCount) * 4);
      const sortedCount = Math.max(0, Math.floor(visibleCount));

      // Copy visible indices into this key's sortable buffer
      if (sortedCount > 0) {
        commandEncoder.copyBufferToBuffer(indexBuffer, 0, output, 0, sortedCount * 4);
      }
      if (sortedCount <= 1) {
        // Nothing to sort; the key still owns its (trivial) order.
        this.orderCounts.set(outputKey, sortedCount);
        return output;
      }

      const workgroupCount = sortPlan.workgroupCount;
      const sortBindGroup = device.createBindGroup({
        layout: this.sortBufferLayout!,
        entries: [
          { binding: 0, resource: { buffer: this.ensureKeyBuffer(sortPlan.paddedCount) } },
          { binding: 1, resource: { buffer: output } },
        ],
        label: `sort-buffers-bg-${outputKey}`,
      });

      // Create splat data bind group
      const splatDataBindGroup = device.createBindGroup({
        layout: this.splatDataLayout!,
        entries: [
          { binding: 0, resource: { buffer: splatBuffer } },
        ],
        label: 'sort-splat-data-bg',
      });

      // ── Step 1: Compute depth keys ─────────────────────────────────────────
      const uniformBindGroup = this.writeUniforms(device, viewMatrix, worldMatrix, visibleCount, sortPlan.paddedCount, 0, 0);

      {
        const pass = commandEncoder.beginComputePass({ label: 'splat-depth-keys' });
        pass.setPipeline(this.depthKeyPipeline);
        pass.setBindGroup(0, splatDataBindGroup);
        pass.setBindGroup(1, uniformBindGroup);
        pass.setBindGroup(2, sortBindGroup);
        pass.dispatchWorkgroups(workgroupCount);
        pass.end();
      }

      // ── Step 2: Bitonic sort steps ─────────────────────────────────────────
      // Outer loop: k = 2, 4, 8, ..., paddedCount
      for (let k = 2; k <= sortPlan.paddedCount; k *= 2) {
        // Inner loop: j = k/2, k/4, ..., 1
        for (let j = k >> 1; j > 0; j >>= 1) {
          const stepUniforms = this.writeUniforms(device, viewMatrix, worldMatrix, visibleCount, sortPlan.paddedCount, k, j);

          const pass = commandEncoder.beginComputePass({
            label: `splat-bitonic-k${k}-j${j}`,
          });
          pass.setPipeline(this.bitonicStepPipeline);
          pass.setBindGroup(0, splatDataBindGroup);
          pass.setBindGroup(1, stepUniforms);
          pass.setBindGroup(2, sortBindGroup);
          pass.dispatchWorkgroups(workgroupCount);
          pass.end();
        }
      }

      this.orderCounts.set(outputKey, sortedCount);
      return output;
    } catch (err) {
      // A partially recorded sort leaves no order a later frame could trust.
      this.orderCounts.delete(outputKey);
      log.error('Sort execute failed', err);
      return null;
    }
  }

  /** Last order sorted for `outputKey` (still valid on frames that skip sorting). */
  getOrder(outputKey: string): { buffer: GPUBuffer; count: number } | null {
    const buffer = this.sortBuffers?.get(orderBufferKey(outputKey));
    const count = this.orderCounts.get(outputKey);
    return buffer && count !== undefined ? { buffer, count } : null;
  }

  /** Drop `outputKey`'s order; its buffer is destroyed at the next frame start. */
  release(outputKey: string): void {
    this.sortBuffers?.release(orderBufferKey(outputKey));
    this.orderCounts.delete(outputKey);
  }

  dispose(): void {
    this.sortBuffers?.dispose();
    this.uniformRing?.dispose();

    this.sortBuffers = null;
    this.orderCounts.clear();
    this.uniformRing = null;
    this.depthKeyPipeline = null;
    this.bitonicStepPipeline = null;
    this.splatDataLayout = null;
    this.uniformLayout = null;
    this.sortBufferLayout = null;
    this.device = null;
    this._initialized = false;

    log.debug('SplatSortPass disposed');
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private createPipelines(): void {
    if (!this.device) return;

    const shaderModule = this.device.createShaderModule({
      code: shaderSource,
      label: 'radix-sort-shader',
    });

    // Group 0: splat data
    this.splatDataLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'read-only-storage' },
        },
      ],
      label: 'sort-splat-data-layout',
    });

    // Group 1: uniforms
    this.uniformLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'uniform' },
        },
      ],
      label: 'sort-uniform-layout',
    });

    // Group 2: sort buffers (keys + indices, read-write)
    this.sortBufferLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'storage' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'storage' },
        },
      ],
      label: 'sort-buffer-layout',
    });

    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.splatDataLayout, this.uniformLayout, this.sortBufferLayout],
      label: 'sort-pipeline-layout',
    });

    // Depth key computation pipeline
    this.depthKeyPipeline = this.device.createComputePipeline({
      layout: pipelineLayout,
      compute: {
        module: shaderModule,
        entryPoint: 'computeDepthKeys',
      },
      label: 'depth-key-pipeline',
    });

    // Bitonic step pipeline
    this.bitonicStepPipeline = this.device.createComputePipeline({
      layout: pipelineLayout,
      compute: {
        module: shaderModule,
        entryPoint: 'bitonicStep',
      },
      label: 'bitonic-step-pipeline',
    });

    this.uniformRing = new GpuUniformRing(this.device, { label: 'sort-uniforms', size: SORT_UNIFORM_SIZE });
    this.sortBuffers = new GpuFrameBuffers(this.device, {
      label: 'sort',
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
  }

  /** Shared depth-key scratch buffer; growing retires the smaller one until the next frame. */
  private ensureKeyBuffer(count: number): GPUBuffer {
    return this.sortBuffers!.ensure('keys', sortCapacity(count) * 4);
  }

  private writeUniforms(
    device: GPUDevice,
    viewMatrix: Float32Array,
    worldMatrix: Float32Array,
    visibleCount: number,
    sortCount: number,
    blockSize: number,
    subBlockSize: number,
  ): GPUBindGroup {
    const data = new ArrayBuffer(SORT_UNIFORM_SIZE);
    const f32 = new Float32Array(data);
    const u32 = new Uint32Array(data);

    // mat4x4f viewMatrix (16 floats)
    f32.set(viewMatrix, 0);

    // mat4x4f worldMatrix (16 floats)
    f32.set(worldMatrix, 16);

    // u32 params at offset 32 (in f32 units)
    u32[32] = visibleCount;
    u32[33] = sortCount;
    u32[34] = blockSize;
    u32[35] = subBlockSize;

    const buffer = this.uniformRing!.write(data);
    return device.createBindGroup({ layout: this.uniformLayout!, entries: [{ binding: 0, resource: { buffer } }] });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function orderBufferKey(outputKey: string): string {
  return `order:${outputKey}`;
}

/** Elements to allocate for `count`: power of two, at least 1024 so small sorts share sizes. */
function sortCapacity(count: number): number {
  return nextPowerOf2(Math.max(count, 1024));
}

function nextPowerOf2(n: number): number {
  let v = n - 1;
  v |= v >> 1;
  v |= v >> 2;
  v |= v >> 4;
  v |= v >> 8;
  v |= v >> 16;
  return v + 1;
}

export function buildBitonicSortPlan(visibleCount: number): BitonicSortPlan {
  const paddedCount = nextPowerOf2(Math.max(visibleCount, 1));
  return {
    visibleCount,
    paddedCount,
    workgroupCount: Math.ceil(paddedCount / 256),
  };
}
