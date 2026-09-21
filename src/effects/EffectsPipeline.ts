import { nodeScalarSampleTap } from '../services/nodePreview/NodeScalarSampleTap';
// Effects Pipeline - GPU effect processing using the modular effect registry

import { EFFECT_REGISTRY, getEffect } from './index';
import {
  isComputeEffectDefinition,
  isFullscreenEffectDefinition,
  type ComputeEffectDefinition,
  type FullscreenEffectDefinition,
} from './types';
import { getGlyphAtlas } from './_shared/glyphAtlas';
import { ByteTextureCache } from './_shared/byteTexture';
import { Logger } from '../services/logger';
import { ComputeEffectRuntime } from './ComputeEffectRuntime';
import { SplitComparePipeline } from './SplitComparePipeline';
import type { SplitCompareSettings } from '../stores/splitCompareStore';
import { getLandmarkEffectPoints } from '../services/landmarkTracking/landmarkRuntime';
import { DenseTerrainPipeline } from './tracking/DenseTerrainPipeline';
import { nodePreviewTextureTap } from '../services/nodePreview/NodePreviewTextureTap';
import { imageGraphDefinition } from './_shared/imageGraphDefinition';
import { EffectPipelineCache } from './EffectPipelineCache';
import { captureImageOperatorPreviews } from '../services/nodePreview/imageOperatorTexturePreviews';
import { compileAnalogSignalGraph, createDefaultAnalogSignalGraph } from '../services/operators/analogSignalGraph';
import { captureAnalogSignalStagePreviews } from '../services/nodePreview/analogSignalPreviews';
import { effectOperatorCompileContext, effectOperatorGraph, isImageGraphEffectType } from '../services/operators/effectGraphOwner';
import { effectOperatorParams } from '../services/operators/effectGraphOwner';
import { compileImageOperatorGraph } from '../services/operators/imageOperatorGraph';
import { ImageGraphPassRuntime } from './ImageGraphPassRuntime';

const log = Logger.create('EffectsPipeline');

// Effects handled inline in the composite shader (no separate GPU pipeline needed)
// These are applied as uniforms in the composite pass, eliminating separate render passes.
export const INLINE_EFFECT_IDS = new Set([
  'brightness', 'contrast', 'saturation', 'invert',
  'exposure', 'levels', 'hue-shift', 'temperature', 'vibrance',
  'threshold', 'posterize',
]);

// Effect instance interface (runtime data attached to clips)
interface EffectInstance {
  operatorGraph?: import('../types/operatorGraph').EffectOperatorGraph;
  terrainRender?: import('../types/effects').Effect['terrainRender'];
  id: string;
  type: string;
  name: string;
  enabled: boolean;
  params: Record<string, unknown>;
}

interface FeedbackState {
  texture: GPUTexture;
  view: GPUTextureView;
  width: number;
  height: number;
  clearPending: boolean;
  resetActive: boolean;
}

function toPrimitiveEffectParams(params: Record<string, unknown>): Record<string, number | boolean | string> {
  const primitiveParams: Record<string, number | boolean | string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
      primitiveParams[key] = value;
    }
  }
  return primitiveParams;
}

export class EffectsPipeline {
  private device: GPUDevice;
  private pipelineCache: EffectPipelineCache;
  private feedbackStates = new Map<string, FeedbackState>();
  private landmarkBuffers = new Map<string, GPUBuffer>();
  private byteTextures: ByteTextureCache;
  private computeRuntime: ComputeEffectRuntime;
  private splitComparePipeline: SplitComparePipeline;
  private imageGraphPassRuntime: ImageGraphPassRuntime;
  private initialized = false;
  private denseTerrain?: DenseTerrainPipeline;

  constructor(device: GPUDevice, onPipelineReady?: () => void) {
    this.device = device;
    this.pipelineCache = new EffectPipelineCache(device, onPipelineReady);
    this.computeRuntime = new ComputeEffectRuntime(device);
    this.splitComparePipeline = new SplitComparePipeline(device);
    this.byteTextures = new ByteTextureCache(device);
    this.imageGraphPassRuntime = new ImageGraphPassRuntime(device);
  }

  /**
   * Initialize the effect runtime. Individual effect pipelines are compiled on
   * first use (or explicit prewarm) so editor startup does not synchronously
   * compile the entire catalog on mobile GPUs.
   */
  async createPipelines(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    log.info(`Effect runtime ready; ${EFFECT_REGISTRY.size} catalog pipelines will compile lazily`);
  }

  private ensureEffectPipeline(id: string, effect: FullscreenEffectDefinition, compiledGraph = false): boolean {
    return this.pipelineCache.ensure(id, effect, compiledGraph);
  }
  /**
   * Get pipeline for an effect type
   */
  getEffectPipeline(effectType: string): GPURenderPipeline | undefined {
    return this.pipelineCache.getPipeline(effectType);
  }

  /**
   * Get bind group layout for an effect type
   */
  getEffectBindGroupLayout(effectType: string): GPUBindGroupLayout | undefined {
    return this.pipelineCache.getBindGroupLayout(effectType);
  }

  /**
   * Create uniform data for an effect using its packUniforms function
   */
  createEffectUniformData(
    effect: EffectInstance,
    outputWidth: number,
    outputHeight: number,
    timelineTimeSeconds = 0,
    resolvedDefinition?: FullscreenEffectDefinition,
  ): Float32Array | null {
    const registered = getEffect(effect.type);
    const definition = resolvedDefinition ?? (isImageGraphEffectType(effect.type) && isFullscreenEffectDefinition(registered)
      ? imageGraphDefinition(effect, registered, timelineTimeSeconds)
      : registered);
    if (!isFullscreenEffectDefinition(definition) && !isComputeEffectDefinition(definition)) return null;

    return definition.packUniforms(
      toPrimitiveEffectParams(effect.params),
      outputWidth,
      outputHeight,
      timelineTimeSeconds,
    );
  }

  /** Compile only the requested effect, used by budgeted thumbnail prewarming. */
  prewarmEffect(effectType: string): void {
    if (INLINE_EFFECT_IDS.has(effectType)) return;
    const effect = getEffect(effectType);
    if (isFullscreenEffectDefinition(effect)) {
      this.ensureEffectPipeline(effectType, effect);
    } else if (isComputeEffectDefinition(effect)) {
      this.computeRuntime.ensure(effect);
    }
  }

  /**
   * Create bind group for an effect
   */
  createEffectBindGroup(
    effectType: string,
    sampler: GPUSampler,
    inputView: GPUTextureView,
    uniformBuffer?: GPUBuffer,
    feedbackView?: GPUTextureView,
    glyphAtlasView?: GPUTextureView,
  ): GPUBindGroup | null {
    const layout = this.pipelineCache.getBindGroupLayout(effectType);
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

    if (glyphAtlasView) {
      entries.push({ binding: 4, resource: glyphAtlasView });
    }

    return this.pipelineCache.createBindGroup(effectType, entries);
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

  private getLandmarkBuffer(effectId: string): GPUBuffer {
    let buffer = this.landmarkBuffers.get(effectId);
    if (!buffer) {
      buffer = this.device.createBuffer({
        label: `effect-landmarks-${effectId}`,
        size: (4 + 64 * 4) * Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.landmarkBuffers.set(effectId, buffer);
    }
    const points = getLandmarkEffectPoints(effectId).slice(0, 64);
    const packed = new Float32Array(4 + 64 * 4);
    packed[0] = points.length;
    for (let index = 0; index < points.length; index += 1) {
      const offset = 4 + index * 4;
      packed[offset] = points[index].x;
      packed[offset + 1] = points[index].y;
      packed[offset + 2] = points[index].z;
      packed[offset + 3] = points[index].visibility ?? 1;
    }
    this.device.queue.writeBuffer(buffer, 0, packed);
    return buffer;
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
    pongTexture?: GPUTexture,
    compare?: { outputView: GPUTextureView; settings: SplitCompareSettings },
    timelineTimeSeconds = 0,
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
      const imageGraphEffect = isImageGraphEffectType(effect.type);
      if (imageGraphEffect && effectOperatorGraph(effect).incomplete) continue;
      const imagePlan = imageGraphEffect ? compileImageOperatorGraph(effectOperatorGraph(effect), effectOperatorParams(effect), effectOperatorCompileContext(effect)) : undefined;
      const imagePassBatch = imagePlan?.passes?.length ? this.imageGraphPassRuntime.createBatch() : undefined;
      if (imageGraphEffect) captureImageOperatorPreviews({
        effect,
        device: this.device,
        encoder: commandEncoder,
        sampler,
        source: { kind: 'texture', view: effectInput },
        width: outputWidth,
        height: outputHeight,
        timelineTimeSeconds,
        passRuntime: imagePassBatch ? this.imageGraphPassRuntime : undefined,
        passBatch: imagePassBatch,
      });
      if (effect.type === 'voxel-relief') nodeScalarSampleTap.capture(`voxel-effect:${effect.id}`, this.device, commandEncoder, sampler, effectInput);
      if(effect.terrainRender){
        this.denseTerrain??=new DenseTerrainPipeline(this.device);
        this.denseTerrain.encode(commandEncoder,effect.terrainRender,sampler,effectInput,effectOutput,outputWidth,outputHeight);
        effectInput=effectOutput;
        effectOutput=this.getNextOutputView(effectOutput,pingView,pongView);
        swapped=!swapped;
        nodePreviewTextureTap.capture(`effect:${effect.id}`, this.device, commandEncoder, sampler, effectInput, outputWidth, outputHeight);
        continue;
      }
      const registered = getEffect(effect.type);
      if (imagePlan?.passes?.length) {
        try {
          this.imageGraphPassRuntime.encode({ encoder: commandEncoder, sampler, source: { kind: 'texture', view: effectInput }, width: outputWidth,
            height: outputHeight, timelineTimeSeconds, plan: imagePlan, outputView: effectOutput, outputFormat: 'rgba8unorm', instanceId: effect.id, batch: imagePassBatch });
          effectInput = effectOutput; effectOutput = this.getNextOutputView(effectOutput, pingView, pongView); swapped = !swapped;
          nodePreviewTextureTap.capture(`effect:${effect.id}`, this.device, commandEncoder, sampler, effectInput, outputWidth, outputHeight);
        } catch (error) { log.error(`Multi-pass image effect failed: ${effect.type}`, error); }
        continue;
      }
      const definition = imageGraphEffect && isFullscreenEffectDefinition(registered)
        ? imageGraphDefinition(effect, registered, timelineTimeSeconds) : registered;
      if (isComputeEffectDefinition(definition)) {
        if (definition.computeMode === 'analog-signal' && effect.operatorGraph?.incomplete) continue;
        const effectParams = definition.computeMode === 'analog-signal' ? null : this.createEffectUniformData(effect, outputWidth, outputHeight, timelineTimeSeconds);
        let effectUniformBuffer: GPUBuffer | null = null;
        if (effectParams) {
          effectUniformBuffer = this.device.createBuffer({
            size: effectParams.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          });
          this.device.queue.writeBuffer(effectUniformBuffer, 0, effectParams.buffer);
        }
        try {
          const analogPlan = definition.computeMode === 'analog-signal'
            ? compileAnalogSignalGraph(effect.operatorGraph ?? createDefaultAnalogSignalGraph(), effect.params) : undefined;
          const rendered = this.computeRuntime.encode({
            commandEncoder,
            definition: definition as ComputeEffectDefinition,
            inputView: effectInput,
            outputView: effectOutput,
            uniformBuffer: effectUniformBuffer,
            width: outputWidth,
            height: outputHeight,
            analogPlan,
            instanceId: effect.id,
            timelineTimeSeconds,
            onAnalogStageOutput: (stage, view, width, height) => {
              if (stage.kind === 'analyze') return;
              captureAnalogSignalStagePreviews({ effect, nodeId: stage.nodeId, kind: stage.kind, device: this.device,
                encoder: commandEncoder, sampler, view, width, height });
            },
          });
          if (!rendered) continue;
          effectInput = effectOutput;
          effectOutput = this.getNextOutputView(effectOutput, pingView, pongView);
          swapped = !swapped;
          nodePreviewTextureTap.capture(`effect:${effect.id}`, this.device, commandEncoder, sampler, effectInput, outputWidth, outputHeight);
        } catch (error) {
          log.error(`Compute effect failed: ${effect.type}`, error);
        }
        continue;
      }
      const pipelineKey = definition?.id ?? effect.type;
      const rebuiltPipeline = isFullscreenEffectDefinition(definition)
        ? this.ensureEffectPipeline(pipelineKey, definition, pipelineKey !== effect.type)
        : false;
      const pipeline = this.pipelineCache.getPipeline(pipelineKey);
      const bindGroupLayout = this.pipelineCache.getBindGroupLayout(pipelineKey);

      if (!isFullscreenEffectDefinition(definition) || !pipeline || !bindGroupLayout) {
        if (
          !this.pipelineCache.isPendingOrFailed(pipelineKey)
        ) {
          log.warn(`No pipeline for effect type: ${effect.type}`);
        }
        continue;
      }

      // Create uniform buffer for effect parameters
      const effectParams = this.createEffectUniformData(
        effect,
        outputWidth,
        outputHeight,
        timelineTimeSeconds,
        definition,
      );
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

      if (definition.glyphAtlas) {
        const primitiveParams = toPrimitiveEffectParams(effect.params);
        const atlas = getGlyphAtlas(this.device, definition.glyphAtlas(primitiveParams));
        entries.push({ binding: 4, resource: atlas.view });
      }

      if (definition.byteTexture) {
        const upload = definition.byteTexture(toPrimitiveEffectParams(effect.params), {
          effectInstanceId: effect.id,
          width: outputWidth,
          height: outputHeight,
          timelineTimeSeconds,
        });
        entries.push({ binding: 5, resource: this.byteTextures.getView(effect.id, upload) });
      }

      if (definition.landmarkPoints) {
        entries.push({ binding: 6, resource: { buffer: this.getLandmarkBuffer(effect.id) } });
      }

      const effectBindGroup = this.pipelineCache.createBindGroup(pipelineKey, entries);
      if (!effectBindGroup) continue;

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
      nodePreviewTextureTap.capture(`effect:${effect.id}`, this.device, commandEncoder, sampler, effectInput, outputWidth, outputHeight);
    }

    if (compare?.settings.enabled && effectInput !== inputView) {
      this.splitComparePipeline.encode({
        commandEncoder,
        sampler,
        untreatedView: inputView,
        effectedView: effectInput,
        outputView: compare.outputView,
        settings: compare.settings,
      });
      effectInput = compare.outputView;
    }

    // effectInput now contains the final result
    return { finalView: effectInput, swapped };
  }

  projectTerrainContent(
    commandEncoder: GPUCommandEncoder,
    projection: import('../types/terrainAttachment').TerrainProjectionDescriptor,
    sampler: GPUSampler,
    contentView: GPUTextureView,
    backgroundView: GPUTextureView,
    outputView: GPUTextureView,
    outputWidth: number,
    outputHeight: number,
    opacity: number,
    resourceKey?: string,
  ): boolean {
    this.denseTerrain ??= new DenseTerrainPipeline(this.device);
    return this.denseTerrain.encodeContentProjection(commandEncoder, projection, sampler, contentView, backgroundView, outputView, outputWidth, outputHeight, opacity, resourceKey);
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.denseTerrain?.destroy();this.denseTerrain=undefined;
    for (const state of this.feedbackStates.values()) {
      state.texture.destroy();
    }
    this.feedbackStates.clear();
    for (const buffer of this.landmarkBuffers.values()) buffer.destroy();
    this.landmarkBuffers.clear();
    this.byteTextures.destroy();
    this.pipelineCache.clear();
    this.computeRuntime.clear();
    this.splitComparePipeline.destroy();
    this.imageGraphPassRuntime.dispose();
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
    return this.pipelineCache.size;
  }
}
