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
import shaderSource from '../shaders/radixSort.wgsl?raw';

const log = Logger.create('SplatSortPass');

/** Uniform buffer: mat4x4f (64) + u32 splatCount + u32 blockSize + u32 subBlockSize + u32 pad = 80 bytes */
const SORT_UNIFORM_SIZE = 80;

export class SplatSortPass {
  private device: GPUDevice | null = null;
  private depthKeyPipeline: GPUComputePipeline | null = null;
  private bitonicStepPipeline: GPUComputePipeline | null = null;

  // Sort buffers
  private keyBuffer: GPUBuffer | null = null;
  private sortedIndexBuffer: GPUBuffer | null = null;
  private uniformBuffer: GPUBuffer | null = null;

  // Bind group layouts
  private splatDataLayout: GPUBindGroupLayout | null = null;
  private uniformLayout: GPUBindGroupLayout | null = null;
  private sortBufferLayout: GPUBindGroupLayout | null = null;

  // Cached sort bind group (recreated when buffers change)
  private sortBindGroup: GPUBindGroup | null = null;

  private maxCapacity = 0;
  private _initialized = false;

  get isInitialized(): boolean {
    return this._initialized;
  }

  initialize(device: GPUDevice, maxSplatCount: number): void {
    if (this._initialized && this.device === device && maxSplatCount <= this.maxCapacity) {
      return;
    }

    this.dispose();
    this.device = device;

    try {
      this.createPipelines();
      this.ensureBuffers(device, maxSplatCount);
      this._initialized = true;
      log.info('SplatSortPass initialized', { maxSplatCount });
    } catch (err) {
      log.error('Failed to initialize SplatSortPass', err);
      this.device = null;
      this._initialized = false;
    }
  }

  /**
   * Sort visible splat indices by depth (back-to-front).
   * The sorted indices are written to an internal buffer which is returned.
   *
   * @param indexBuffer   — visible indices from the cull pass (or identity)
   * @param visibleCount  — number of visible splats to sort
   * @param viewMatrix    — the camera view matrix (for depth computation)
   * @returns the GPUBuffer containing sorted indices, or null on failure
   */
  execute(
    device: GPUDevice,
    commandEncoder: GPUCommandEncoder,
    splatBuffer: GPUBuffer,
    indexBuffer: GPUBuffer,
    visibleCount: number,
    viewMatrix: Float32Array,
  ): GPUBuffer | null {
    if (!this._initialized || !this.depthKeyPipeline || !this.bitonicStepPipeline) {
      log.warn('Cannot execute: sort pass not initialized');
      return null;
    }

    if (visibleCount <= 1) {
      // Nothing to sort — copy indices directly
      return indexBuffer;
    }

    try {
      this.ensureBuffers(device, visibleCount);

      // Copy visible indices to our sortable buffer
      commandEncoder.copyBufferToBuffer(
        indexBuffer, 0,
        this.sortedIndexBuffer!, 0,
        visibleCount * 4,
      );

      const workgroupCount = Math.ceil(visibleCount / 256);

      // Create splat data bind group
      const splatDataBindGroup = device.createBindGroup({
        layout: this.splatDataLayout!,
        entries: [
          { binding: 0, resource: { buffer: splatBuffer } },
        ],
        label: 'sort-splat-data-bg',
      });

      const uniformBindGroup = device.createBindGroup({
        layout: this.uniformLayout!,
        entries: [
          { binding: 0, resource: { buffer: this.uniformBuffer! } },
        ],
        label: 'sort-uniform-bg',
      });

      // ── Step 1: Compute depth keys ─────────────────────────────────────────
      this.writeUniforms(device, viewMatrix, visibleCount, 0, 0);

      {
        const pass = commandEncoder.beginComputePass({ label: 'splat-depth-keys' });
        pass.setPipeline(this.depthKeyPipeline);
        pass.setBindGroup(0, splatDataBindGroup);
        pass.setBindGroup(1, uniformBindGroup);
        pass.setBindGroup(2, this.sortBindGroup!);
        pass.dispatchWorkgroups(workgroupCount);
        pass.end();
      }

      // ── Step 2: Bitonic sort steps ─────────────────────────────────────────
      // Pad visibleCount to next power of 2 for bitonic sort
      const n = nextPowerOf2(visibleCount);

      // For elements beyond visibleCount, we rely on keys[idx] being 0 (initialized)
      // and the bounds check in the shader (idx >= splatCount → return)

      // Outer loop: k = 2, 4, 8, ..., n
      for (let k = 2; k <= n; k *= 2) {
        // Inner loop: j = k/2, k/4, ..., 1
        for (let j = k >> 1; j > 0; j >>= 1) {
          this.writeUniforms(device, viewMatrix, visibleCount, k, j);

          const pass = commandEncoder.beginComputePass({
            label: `splat-bitonic-k${k}-j${j}`,
          });
          pass.setPipeline(this.bitonicStepPipeline);
          pass.setBindGroup(0, splatDataBindGroup);
          pass.setBindGroup(1, uniformBindGroup);
          pass.setBindGroup(2, this.sortBindGroup!);
          pass.dispatchWorkgroups(workgroupCount);
          pass.end();
        }
      }

      return this.sortedIndexBuffer;
    } catch (err) {
      log.error('Sort execute failed', err);
      return null;
    }
  }

  dispose(): void {
    this.keyBuffer?.destroy();
    this.sortedIndexBuffer?.destroy();
    this.uniformBuffer?.destroy();

    this.keyBuffer = null;
    this.sortedIndexBuffer = null;
    this.uniformBuffer = null;
    this.sortBindGroup = null;
    this.depthKeyPipeline = null;
    this.bitonicStepPipeline = null;
    this.splatDataLayout = null;
    this.uniformLayout = null;
    this.sortBufferLayout = null;
    this.device = null;
    this.maxCapacity = 0;
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

    // Create uniform buffer
    this.uniformBuffer = this.device.createBuffer({
      size: SORT_UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: 'sort-uniforms',
    });
  }

  private ensureBuffers(device: GPUDevice, count: number): void {
    // Pad to next power of 2 for bitonic sort
    const capacity = nextPowerOf2(Math.max(count, 1024));

    if (capacity <= this.maxCapacity && this.keyBuffer) return;

    this.keyBuffer?.destroy();
    this.sortedIndexBuffer?.destroy();

    // Key buffer: u32 per element
    this.keyBuffer = device.createBuffer({
      size: capacity * 4,
      usage: GPUBufferUsage.STORAGE,
      label: 'sort-keys',
    });

    // Sorted index buffer: u32 per element
    this.sortedIndexBuffer = device.createBuffer({
      size: capacity * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: 'sort-indices',
    });

    // Recreate bind group
    this.sortBindGroup = device.createBindGroup({
      layout: this.sortBufferLayout!,
      entries: [
        { binding: 0, resource: { buffer: this.keyBuffer } },
        { binding: 1, resource: { buffer: this.sortedIndexBuffer } },
      ],
      label: 'sort-buffers-bg',
    });

    this.maxCapacity = capacity;
    log.debug('Allocated sort buffers', { capacity });
  }

  private writeUniforms(
    device: GPUDevice,
    viewMatrix: Float32Array,
    splatCount: number,
    blockSize: number,
    subBlockSize: number,
  ): void {
    if (!this.uniformBuffer) return;

    const data = new ArrayBuffer(SORT_UNIFORM_SIZE);
    const f32 = new Float32Array(data);
    const u32 = new Uint32Array(data);

    // mat4x4f viewMatrix (16 floats)
    f32.set(viewMatrix, 0);

    // u32 params at offset 16 (in f32 units)
    u32[16] = splatCount;
    u32[17] = blockSize;
    u32[18] = subBlockSize;
    // u32[19] = pad

    device.queue.writeBuffer(this.uniformBuffer, 0, data);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function nextPowerOf2(n: number): number {
  let v = n - 1;
  v |= v >> 1;
  v |= v >> 2;
  v |= v >> 4;
  v |= v >> 8;
  v |= v >> 16;
  return v + 1;
}
