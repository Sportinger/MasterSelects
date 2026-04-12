// Particle compute pass — applies deterministic offsets to splat positions.
// Reads from a source storage buffer, writes modified data to output buffer.
// The source buffer is never mutated; all effects are applied to the copy.

import { Logger } from '../../../services/logger';
import type { GaussianSplatParticleSettings } from '../types';
import shaderSource from '../shaders/particleCompute.wgsl?raw';

const log = Logger.create('ParticleCompute');

/** Workgroup size must match the shader */
const WORKGROUP_SIZE = 256;

/** Effect type enum matching WGSL */
const EFFECT_TYPE_MAP: Record<GaussianSplatParticleSettings['effectType'], number> = {
  none: 0,
  explode: 1,
  drift: 2,
  swirl: 3,
  dissolve: 4,
};

/**
 * GPU settings uniform layout (must match WGSL struct ParticleSettings):
 *   time:        f32  (offset 0)
 *   intensity:   f32  (offset 4)
 *   speed:       f32  (offset 8)
 *   seed:        f32  (offset 12)
 *   effect_type: u32  (offset 16)
 *   splat_count: u32  (offset 20)
 *   _pad0:       u32  (offset 24)
 *   _pad1:       u32  (offset 28)
 * Total: 32 bytes
 */
const SETTINGS_BUFFER_SIZE = 32;

export class ParticleCompute {
  private pipeline: GPUComputePipeline | null = null;
  private settingsBuffer: GPUBuffer | null = null;
  private dataBindGroupLayout: GPUBindGroupLayout | null = null;
  private settingsBindGroupLayout: GPUBindGroupLayout | null = null;
  private settingsBindGroup: GPUBindGroup | null = null;
  private _initialized = false;

  get isInitialized(): boolean {
    return this._initialized;
  }

  /**
   * Create the compute pipeline and uniform buffer.
   * Must be called before execute().
   */
  initialize(device: GPUDevice): void {
    if (this._initialized) return;

    try {
      const shaderModule = device.createShaderModule({
        code: shaderSource,
        label: 'particle-compute-shader',
      });

      // Group 0: source + output storage buffers
      this.dataBindGroupLayout = device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: 'read-only-storage' },
          },
          {
            binding: 1,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: 'storage' },
          },
        ],
        label: 'particle-data-bind-group-layout',
      });

      // Group 1: settings uniform
      this.settingsBindGroupLayout = device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: 'uniform' },
          },
        ],
        label: 'particle-settings-bind-group-layout',
      });

      const pipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [this.dataBindGroupLayout, this.settingsBindGroupLayout],
        label: 'particle-compute-pipeline-layout',
      });

      this.pipeline = device.createComputePipeline({
        layout: pipelineLayout,
        compute: {
          module: shaderModule,
          entryPoint: 'main',
        },
        label: 'particle-compute-pipeline',
      });

      // Allocate settings uniform buffer
      this.settingsBuffer = device.createBuffer({
        size: SETTINGS_BUFFER_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: 'particle-settings-uniform',
      });

      this.settingsBindGroup = device.createBindGroup({
        layout: this.settingsBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.settingsBuffer } },
        ],
        label: 'particle-settings-bind-group',
      });

      this._initialized = true;
      log.info('ParticleCompute initialized');
    } catch (err) {
      log.error('Failed to initialize ParticleCompute', err);
      this._initialized = false;
    }
  }

  /**
   * Apply particle offsets: reads from sourceBuffer, writes modified data to outputBuffer.
   * sourceBuffer is NOT modified. Both buffers must have STORAGE usage
   * and be large enough for splatCount * 14 floats.
   *
   * @param device - GPU device
   * @param commandEncoder - Active command encoder for this frame
   * @param sourceBuffer - Read-only splat data buffer
   * @param outputBuffer - Writable output buffer for modified splat data
   * @param splatCount - Number of splats
   * @param clipLocalTime - Clip-local time in seconds (deterministic)
   * @param settings - Particle effect settings
   */
  execute(
    device: GPUDevice,
    commandEncoder: GPUCommandEncoder,
    sourceBuffer: GPUBuffer,
    outputBuffer: GPUBuffer,
    splatCount: number,
    clipLocalTime: number,
    settings: GaussianSplatParticleSettings,
  ): void {
    if (!this._initialized || !this.pipeline || !this.settingsBuffer || !this.dataBindGroupLayout || !this.settingsBindGroup) {
      log.warn('ParticleCompute not initialized, skipping');
      return;
    }

    if (splatCount <= 0) return;

    // Update settings uniform
    const data = new ArrayBuffer(SETTINGS_BUFFER_SIZE);
    const f32 = new Float32Array(data);
    const u32 = new Uint32Array(data);

    f32[0] = clipLocalTime;                          // time
    f32[1] = settings.intensity;                     // intensity
    f32[2] = settings.speed;                         // speed
    f32[3] = settings.seed;                          // seed
    u32[4] = EFFECT_TYPE_MAP[settings.effectType];   // effect_type
    u32[5] = splatCount;                             // splat_count
    // _pad0 and _pad1 are zero-initialized

    device.queue.writeBuffer(this.settingsBuffer, 0, data);

    // Create per-dispatch bind group for source/output buffers
    const dataBindGroup = device.createBindGroup({
      layout: this.dataBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: sourceBuffer } },
        { binding: 1, resource: { buffer: outputBuffer } },
      ],
      label: 'particle-data-bind-group',
    });

    // Dispatch compute
    const workgroups = Math.ceil(splatCount / WORKGROUP_SIZE);
    const pass = commandEncoder.beginComputePass({ label: 'particle-compute-pass' });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, dataBindGroup);
    pass.setBindGroup(1, this.settingsBindGroup);
    pass.dispatchWorkgroups(workgroups);
    pass.end();

    log.debug('Particle compute dispatched', {
      splatCount,
      workgroups,
      effectType: settings.effectType,
      time: clipLocalTime,
    });
  }

  /** Release GPU resources */
  dispose(): void {
    if (this.settingsBuffer) {
      this.settingsBuffer.destroy();
      this.settingsBuffer = null;
    }
    this.pipeline = null;
    this.dataBindGroupLayout = null;
    this.settingsBindGroupLayout = null;
    this.settingsBindGroup = null;
    this._initialized = false;
    log.info('ParticleCompute disposed');
  }
}
