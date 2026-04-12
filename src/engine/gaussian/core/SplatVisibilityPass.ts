// Frustum culling compute pass for gaussian splats.
// Tests each splat against the camera frustum and outputs visible splat indices.
// For scenes > CULL_THRESHOLD splats this reduces GPU draw work significantly.

import { Logger } from '../../../services/logger';
import shaderSource from '../shaders/visibilityCull.wgsl?raw';

const log = Logger.create('SplatVisibilityPass');

/** Uniform buffer layout: mat4x4f (64 bytes) + u32 splatCount + 3×u32 padding = 80 bytes */
const CULL_UNIFORM_SIZE = 80;

export class SplatVisibilityPass {
  private device: GPUDevice | null = null;
  private pipeline: GPUComputePipeline | null = null;
  private cullUniformBuffer: GPUBuffer | null = null;
  private visibleIndexBuffer: GPUBuffer | null = null;
  private counterBuffer: GPUBuffer | null = null;
  private counterResetBuffer: GPUBuffer | null = null;

  // Bind group layouts
  private splatDataLayout: GPUBindGroupLayout | null = null;
  private uniformLayout: GPUBindGroupLayout | null = null;
  private outputLayout: GPUBindGroupLayout | null = null;

  // Cached bind groups
  private outputBindGroup: GPUBindGroup | null = null;

  // Current capacity
  private maxSplatCount = 0;

  private _initialized = false;

  get isInitialized(): boolean {
    return this._initialized;
  }

  initialize(device: GPUDevice): void {
    if (this._initialized && this.device === device) return;

    this.dispose();
    this.device = device;

    try {
      this.createPipeline();
      this._initialized = true;
      log.info('SplatVisibilityPass initialized');
    } catch (err) {
      log.error('Failed to initialize SplatVisibilityPass', err);
      this.device = null;
      this._initialized = false;
    }
  }

  /**
   * Run frustum culling on the given splat data.
   * Returns the visible index buffer and counter buffer.
   * Callers that need a visible count should copy counterBuffer into a dedicated
   * MAP_READ buffer after execute().
   */
  execute(
    device: GPUDevice,
    commandEncoder: GPUCommandEncoder,
    splatBuffer: GPUBuffer,
    splatCount: number,
    cameraViewMatrix: Float32Array,
    cameraProjectionMatrix: Float32Array,
  ): { visibleIndexBuffer: GPUBuffer; counterBuffer: GPUBuffer } | null {
    if (!this._initialized || !this.pipeline) {
      log.warn('Cannot execute: pass not initialized');
      return null;
    }

    try {
      // Ensure output buffers are large enough
      this.ensureBuffers(device, splatCount);

      // Compute view-projection matrix (column-major multiplication)
      const viewProj = multiplyMat4(cameraProjectionMatrix, cameraViewMatrix);

      // Write cull uniforms
      const uniformData = new ArrayBuffer(CULL_UNIFORM_SIZE);
      const f32View = new Float32Array(uniformData);
      const u32View = new Uint32Array(uniformData);

      // mat4x4f viewProj (16 floats = 64 bytes)
      f32View.set(viewProj, 0);
      // u32 splatCount at offset 16 (in f32 units)
      u32View[16] = splatCount;
      // padding at 17, 18, 19

      device.queue.writeBuffer(this.cullUniformBuffer!, 0, uniformData);

      // Reset the atomic counter to 0 (copy from zero-initialized staging buffer)
      commandEncoder.copyBufferToBuffer(
        this.counterResetBuffer!, 0,
        this.counterBuffer!, 0,
        4,
      );

      // Create bind groups
      const splatDataBindGroup = device.createBindGroup({
        layout: this.splatDataLayout!,
        entries: [
          { binding: 0, resource: { buffer: splatBuffer } },
        ],
        label: 'cull-splat-data-bg',
      });

      const uniformBindGroup = device.createBindGroup({
        layout: this.uniformLayout!,
        entries: [
          { binding: 0, resource: { buffer: this.cullUniformBuffer! } },
        ],
        label: 'cull-uniform-bg',
      });

      // Dispatch compute
      const pass = commandEncoder.beginComputePass({ label: 'splat-visibility-cull' });
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, splatDataBindGroup);
      pass.setBindGroup(1, uniformBindGroup);
      pass.setBindGroup(2, this.outputBindGroup!);

      const workgroupCount = Math.ceil(splatCount / 256);
      pass.dispatchWorkgroups(workgroupCount);
      pass.end();

      return {
        visibleIndexBuffer: this.visibleIndexBuffer!,
        counterBuffer: this.counterBuffer!,
      };
    } catch (err) {
      log.error('Visibility cull execute failed', err);
      return null;
    }
  }

  dispose(): void {
    this.visibleIndexBuffer?.destroy();
    this.counterBuffer?.destroy();
    this.counterResetBuffer?.destroy();
    this.cullUniformBuffer?.destroy();

    this.visibleIndexBuffer = null;
    this.counterBuffer = null;
    this.counterResetBuffer = null;
    this.cullUniformBuffer = null;
    this.outputBindGroup = null;
    this.pipeline = null;
    this.splatDataLayout = null;
    this.uniformLayout = null;
    this.outputLayout = null;
    this.device = null;
    this.maxSplatCount = 0;
    this._initialized = false;

    log.debug('SplatVisibilityPass disposed');
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private createPipeline(): void {
    if (!this.device) return;

    const shaderModule = this.device.createShaderModule({
      code: shaderSource,
      label: 'visibility-cull-shader',
    });

    // Group 0: splat data (storage, read-only)
    this.splatDataLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'read-only-storage' },
        },
      ],
      label: 'cull-splat-data-layout',
    });

    // Group 1: cull uniforms
    this.uniformLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'uniform' },
        },
      ],
      label: 'cull-uniform-layout',
    });

    // Group 2: output (visible indices + atomic counter)
    this.outputLayout = this.device.createBindGroupLayout({
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
      label: 'cull-output-layout',
    });

    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.splatDataLayout, this.uniformLayout, this.outputLayout],
      label: 'visibility-cull-pipeline-layout',
    });

    this.pipeline = this.device.createComputePipeline({
      layout: pipelineLayout,
      compute: {
        module: shaderModule,
        entryPoint: 'main',
      },
      label: 'visibility-cull-pipeline',
    });

    // Create uniform buffer
    this.cullUniformBuffer = this.device.createBuffer({
      size: CULL_UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: 'cull-uniforms',
    });

    // Create the zero-reset staging buffer for the counter
    this.counterResetBuffer = this.device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.COPY_SRC,
      mappedAtCreation: true,
      label: 'cull-counter-reset',
    });
    new Uint32Array(this.counterResetBuffer.getMappedRange()).set([0]);
    this.counterResetBuffer.unmap();
  }

  private ensureBuffers(device: GPUDevice, splatCount: number): void {
    if (splatCount <= this.maxSplatCount && this.visibleIndexBuffer) return;

    // Round up to next power of 2 for fewer re-allocations
    const capacity = nextPowerOf2(Math.max(splatCount, 1024));

    this.visibleIndexBuffer?.destroy();
    this.counterBuffer?.destroy();

    // Visible index buffer: u32 per splat
    this.visibleIndexBuffer = device.createBuffer({
      size: capacity * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      label: 'cull-visible-indices',
    });

    // Atomic counter buffer: single u32
    this.counterBuffer = device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
      label: 'cull-counter',
    });

    // Recreate output bind group
    this.outputBindGroup = device.createBindGroup({
      layout: this.outputLayout!,
      entries: [
        { binding: 0, resource: { buffer: this.visibleIndexBuffer } },
        { binding: 1, resource: { buffer: this.counterBuffer } },
      ],
      label: 'cull-output-bg',
    });

    this.maxSplatCount = capacity;
    log.debug('Allocated cull buffers', { capacity });
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

/** Multiply two 4x4 column-major matrices: result = a * b */
function multiplyMat4(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += a[k * 4 + row] * b[col * 4 + k];
      }
      out[col * 4 + row] = sum;
    }
  }
  return out;
}
