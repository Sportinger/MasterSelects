// Effects Pipeline - GPU effect processing using the modular effect registry

import { EFFECT_REGISTRY, getEffect } from './index';
import type { EffectDefinition } from './types';
import commonShader from './_shared/common.wgsl?raw';
import { Logger } from '../services/logger';

const log = Logger.create('EffectsPipeline');

// Effects handled inline in the composite shader (no separate GPU pipeline needed)
// These are applied as uniforms in the composite pass, eliminating separate render passes.
export const INLINE_EFFECT_IDS = new Set(['brightness', 'contrast', 'saturation', 'invert']);

// Effect instance interface (runtime data attached to clips)
interface EffectInstance {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
  params: Record<string, number | boolean | string>;
}

interface FeedbackState {
  texture: GPUTexture;
  view: GPUTextureView;
  width: number;
  height: number;
  clearPending: boolean;
  resetActive: boolean;
}

export class EffectsPipeline {
  private device: GPUDevice;
  private pipelines = new Map<string, GPURenderPipeline>();
  private bindGroupLayouts = new Map<string, GPUBindGroupLayout>();
  private shaderModules = new Map<string, GPUShaderModule>();
  private pipelineSignatures = new Map<string, string>();
  private feedbackStates = new Map<string, FeedbackState>();
  private initialized = false;

  constructor(device: GPUDevice) {
    this.device = device;
  }

  /**
   * Initialize pipelines for all registered effects
   */
  async createPipelines(): Promise<void> {
    if (this.initialized) return;

    for (const [id, effect] of EFFECT_REGISTRY) {
      // Skip effects handled inline in the composite shader
      if (INLINE_EFFECT_IDS.has(id)) continue;
      this.createEffectPipeline(id, effect);
    }

    this.initialized = true;
    log.info(`Created ${this.pipelines.size} effect pipelines`);
  }

  /**
   * Create GPU pipeline for a single effect
   */
  private createEffectPipeline(id: string, effect: EffectDefinition): void {
    try {
      // Combine common shader with effect shader
      const shaderCode = `${commonShader}\n${effect.shader}`;

      const shaderModule = this.device.createShaderModule({
        label: `effect-${id}`,
        code: shaderCode,
      });
      this.shaderModules.set(id, shaderModule);

      // Create bind group layout
      const entries: GPUBindGroupLayoutEntry[] = [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      ];

      if (effect.uniformSize > 0) {
        entries.push({
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        });
      }

      if (effect.usesFeedback) {
        entries.push({
          binding: 3,
          visibility: GPUShaderStage.FRAGMENT,
          texture: {},
        });
      }

      const bindGroupLayout = this.device.createBindGroupLayout({
        label: `effect-${id}-layout`,
        entries,
      });
      this.bindGroupLayouts.set(id, bindGroupLayout);

      // Create render pipeline
      const pipeline = this.device.createRenderPipeline({
        label: `effect-${id}-pipeline`,
        layout: this.device.createPipelineLayout({
          bindGroupLayouts: [bindGroupLayout],
        }),
        vertex: {
          module: shaderModule,
          entryPoint: 'vertexMain',
        },
        fragment: {
          module: shaderModule,
          entryPoint: effect.entryPoint,
          targets: [{ format: 'rgba8unorm' }],
        },
        primitive: { topology: 'triangle-list' },
      });

      this.pipelines.set(id, pipeline);
      this.pipelineSignatures.set(id, this.getPipelineSignature(effect));
    } catch (error) {
      log.error(`Failed to create pipeline for ${id}`, error);
    }
  }

  private getPipelineSignature(effect: EffectDefinition): string {
    return [
      effect.entryPoint,
      effect.uniformSize,
      effect.usesFeedback === true ? 'feedback' : 'no-feedback',
      effect.shader,
    ].join('\u0000');
  }

  private ensureEffectPipeline(id: string, effect: EffectDefinition): boolean {
    const signature = this.getPipelineSignature(effect);
    if (this.pipelines.has(id) && this.pipelineSignatures.get(id) === signature) {
      return false;
    }

    this.pipelines.delete(id);
    this.bindGroupLayouts.delete(id);
    this.shaderModules.delete(id);
    this.pipelineSignatures.delete(id);
    this.createEffectPipeline(id, effect);
    return this.pipelines.has(id);
  }

  /**
   * Get pipeline for an effect type
   */
  getEffectPipeline(effectType: string): GPURenderPipeline | undefined {
    return this.pipelines.get(effectType);
  }

  /**
   * Get bind group layout for an effect type
   */
  getEffectBindGroupLayout(effectType: string): GPUBindGroupLayout | undefined {
    return this.bindGroupLayouts.get(effectType);
  }

  /**
   * Create uniform data for an effect using its packUniforms function
   */
  createEffectUniformData(
    effect: EffectInstance,
    outputWidth: number,
    outputHeight: number
  ): Float32Array | null {
    const definition = getEffect(effect.type);
    if (!definition) return null;

    return definition.packUniforms(effect.params, outputWidth, outputHeight);
  }

  /**
   * Create bind group for an effect
   */
  createEffectBindGroup(
    effectType: string,
    sampler: GPUSampler,
    inputView: GPUTextureView,
    uniformBuffer?: GPUBuffer,
    feedbackView?: GPUTextureView
  ): GPUBindGroup | null {
    const layout = this.bindGroupLayouts.get(effectType);
    if (!layout) return null;

    const entries: GPUBindGroupEntry[] = [
      { binding: 0, resource: sampler },
      { binding: 1, resource: inputView },
    ];

    if (uniformBuffer) {
      entries.push({ binding: 2, resource: { buffer: uniformBuffer } });
    }

    if (feedbackView) {
      entries.push({ binding: 3, resource: feedbackView });
    }

    return this.device.createBindGroup({
      layout,
      entries,
    });
  }

  private getFeedbackState(effect: EffectInstance, width: number, height: number): FeedbackState {
    const key = effect.id;
    const existing = this.feedbackStates.get(key);

    if (existing && existing.width === width && existing.height === height) {
      return existing;
    }

    existing?.texture.destroy();

    const texture = this.device.createTexture({
      label: `effect-feedback-${effect.type}-${effect.id}`,
      size: { width, height },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.COPY_SRC,
    });

    const state: FeedbackState = {
      texture,
      view: texture.createView(),
      width,
      height,
      clearPending: true,
      resetActive: false,
    };
    this.feedbackStates.set(key, state);
    return state;
  }

  private clearFeedback(commandEncoder: GPUCommandEncoder, state: FeedbackState): void {
    const pass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: state.view,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.end();
    state.clearPending = false;
  }

  private getOutputTexture(
    outputView: GPUTextureView,
    pingView: GPUTextureView,
    pongView: GPUTextureView,
    pingTexture?: GPUTexture,
    pongTexture?: GPUTexture
  ): GPUTexture | null {
    if (outputView === pingView) return pingTexture ?? null;
    if (outputView === pongView) return pongTexture ?? null;
    return null;
  }

  private getNextOutputView(currentOutput: GPUTextureView, pingView: GPUTextureView, pongView: GPUTextureView): GPUTextureView {
    return currentOutput === pingView ? pongView : pingView;
  }

  /**
   * Apply effects to a texture using ping-pong rendering
   */
  applyEffects(
    commandEncoder: GPUCommandEncoder,
    effects: EffectInstance[],
    sampler: GPUSampler,
    inputView: GPUTextureView,
    outputView: GPUTextureView,
    pingView: GPUTextureView,
    pongView: GPUTextureView,
    outputWidth: number,
    outputHeight: number,
    pingTexture?: GPUTexture,
    pongTexture?: GPUTexture
  ): { finalView: GPUTextureView; swapped: boolean } {
    // Filter out audio effects (handled by AudioRoutingManager) and disabled effects
    const enabledEffects = effects.filter(e => e.enabled && !e.type.startsWith('audio-'));
    if (enabledEffects.length === 0) {
      return { finalView: inputView, swapped: false };
    }

    let effectInput = inputView;
    let effectOutput = outputView;
    let swapped = false;

    for (const effect of enabledEffects) {
      const definition = getEffect(effect.type);
      const rebuiltPipeline = definition
        ? this.ensureEffectPipeline(effect.type, definition)
        : false;
      const pipeline = this.pipelines.get(effect.type);
      const bindGroupLayout = this.bindGroupLayouts.get(effect.type);

      if (!definition || !pipeline || !bindGroupLayout) {
        log.warn(`No pipeline for effect type: ${effect.type}`);
        continue;
      }

      // Create uniform buffer for effect parameters
      const effectParams = this.createEffectUniformData(effect, outputWidth, outputHeight);
      let effectUniformBuffer: GPUBuffer | null = null;

      if (effectParams) {
        effectUniformBuffer = this.device.createBuffer({
          size: effectParams.byteLength,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(effectUniformBuffer, 0, effectParams.buffer);
      }

      const feedbackState = definition.usesFeedback
        ? this.getFeedbackState(effect, outputWidth, outputHeight)
        : null;

      if (feedbackState) {
        if (rebuiltPipeline) {
          feedbackState.clearPending = true;
          feedbackState.resetActive = false;
        }

        const resetRequested = effect.params.reset === true;
        if (feedbackState.clearPending || (resetRequested && !feedbackState.resetActive)) {
          this.clearFeedback(commandEncoder, feedbackState);
        }
        feedbackState.resetActive = resetRequested;
      }

      // Create bind group
      const entries: GPUBindGroupEntry[] = [
        { binding: 0, resource: sampler },
        { binding: 1, resource: effectInput },
      ];

      if (effectUniformBuffer) {
        entries.push({ binding: 2, resource: { buffer: effectUniformBuffer } });
      }

      if (feedbackState) {
        entries.push({ binding: 3, resource: feedbackState.view });
      }

      const effectBindGroup = this.device.createBindGroup({
        layout: bindGroupLayout,
        entries,
      });

      // Render effect pass
      const effectPass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: effectOutput,
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      effectPass.setPipeline(pipeline);
      effectPass.setBindGroup(0, effectBindGroup);
      effectPass.draw(6);
      effectPass.end();

      if (feedbackState) {
        const outputTexture = this.getOutputTexture(effectOutput, pingView, pongView, pingTexture, pongTexture);
        if (outputTexture) {
          commandEncoder.copyTextureToTexture(
            { texture: outputTexture },
            { texture: feedbackState.texture },
            { width: outputWidth, height: outputHeight }
          );
        }
      }

      // Swap buffers for next effect in chain
      effectInput = effectOutput;
      effectOutput = this.getNextOutputView(effectOutput, pingView, pongView);
      swapped = !swapped;
    }

    // effectInput now contains the final result
    return { finalView: effectInput, swapped };
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    for (const state of this.feedbackStates.values()) {
      state.texture.destroy();
    }
    this.feedbackStates.clear();
    this.pipelines.clear();
    this.bindGroupLayouts.clear();
    this.shaderModules.clear();
    this.pipelineSignatures.clear();
    this.initialized = false;
  }

  /**
   * Check if pipeline is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get number of registered effect pipelines
   */
  getPipelineCount(): number {
    return this.pipelines.size;
  }
}
