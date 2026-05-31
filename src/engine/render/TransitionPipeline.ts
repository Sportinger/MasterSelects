// Transition Pipeline - GPU blend pass for clip transitions.
// Mirrors EffectsPipeline: builds one render pipeline per registered transition
// (shared bind group layout) and blends an isolated "from" texture and "to"
// texture into an output target using the transition's shader.

import { TRANSITION_REGISTRY } from '../../transitions';
import type { TransitionDefinition } from '../../transitions';
import commonShader from '../../transitions/_shared/transitionCommon.wgsl?raw';
import { Logger } from '../../services/logger';

const log = Logger.create('TransitionPipeline');

export class TransitionPipeline {
  private device: GPUDevice;
  private pipelines = new Map<string, GPURenderPipeline>();
  private bindGroupLayout: GPUBindGroupLayout | null = null;
  private initialized = false;

  constructor(device: GPUDevice) {
    this.device = device;
  }

  /**
   * Build pipelines for all registered transitions.
   */
  async createPipelines(): Promise<void> {
    if (this.initialized) return;

    // Shared bind group layout: sampler, fromTex, toTex, uniform.
    this.bindGroupLayout = this.device.createBindGroupLayout({
      label: 'transition-layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });

    for (const [id, transition] of TRANSITION_REGISTRY) {
      this.createTransitionPipeline(id, transition);
    }

    this.initialized = true;
    log.info(`Created ${this.pipelines.size} transition pipelines`);
  }

  private createTransitionPipeline(id: string, transition: TransitionDefinition): void {
    if (!this.bindGroupLayout) return;
    try {
      const shaderCode = `${commonShader}\n${transition.shader}`;
      const shaderModule = this.device.createShaderModule({
        label: `transition-${id}`,
        code: shaderCode,
      });

      const pipeline = this.device.createRenderPipeline({
        label: `transition-${id}-pipeline`,
        layout: this.device.createPipelineLayout({
          bindGroupLayouts: [this.bindGroupLayout],
        }),
        vertex: { module: shaderModule, entryPoint: 'vertexMain' },
        fragment: {
          module: shaderModule,
          entryPoint: transition.entryPoint,
          targets: [{ format: 'rgba8unorm' }],
        },
        primitive: { topology: 'triangle-list' },
      });

      this.pipelines.set(id, pipeline);
    } catch (error) {
      log.error(`Failed to create pipeline for transition ${id}`, error);
    }
  }

  hasTransition(type: string): boolean {
    return this.pipelines.has(type);
  }

  /**
   * Blend `fromView` and `toView` into `outView` using the given transition.
   * `uniformData` must follow the layout produced by the transition's packUniforms
   * (float[0] = eased progress, float[1..7] = transition-specific slots).
   */
  blend(
    commandEncoder: GPUCommandEncoder,
    type: string,
    sampler: GPUSampler,
    fromView: GPUTextureView,
    toView: GPUTextureView,
    outView: GPUTextureView,
    uniformData: Float32Array,
  ): boolean {
    const pipeline = this.pipelines.get(type);
    if (!pipeline || !this.bindGroupLayout) {
      log.warn(`No pipeline for transition type: ${type}`);
      return false;
    }

    const uniformBuffer = this.device.createBuffer({
      size: Math.max(uniformData.byteLength, 32),
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(uniformBuffer, 0, uniformData.buffer, uniformData.byteOffset, uniformData.byteLength);

    const bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: sampler },
        { binding: 1, resource: fromView },
        { binding: 2, resource: toView },
        { binding: 3, resource: { buffer: uniformBuffer } },
      ],
    });

    const pass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: outView,
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(6);
    pass.end();
    return true;
  }

  destroy(): void {
    this.pipelines.clear();
    this.bindGroupLayout = null;
    this.initialized = false;
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}
