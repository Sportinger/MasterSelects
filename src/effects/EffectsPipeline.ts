import { InputHistoryRuntime } from './time/InputHistoryRuntime';
import { TemporalEffectResources } from './time/TemporalEffectResources';
import { isCollectingTemporalPreparations, setTemporalStatus } from './time/temporalResourcePreparation';
import type { ClipMask } from '../types/masks';
import type { TemporalClipSource } from './time/temporalClipSource';
import type { SlitScanGeometryCaptureSink } from './time/slit-scan/geometryCapture';
import { nodeScalarSampleTap } from '../services/nodePreview/NodeScalarSampleTap';

import { EFFECT_REGISTRY, getEffect } from './index';
import {
  isComputeEffectDefinition,
  isFullscreenEffectDefinition,
  type ComputeEffectDefinition,
  type FullscreenEffectDefinition,
} from './types';
import { getGlyphAtlas } from './_shared/glyphAtlas';
import { ByteTextureCache, type EffectRenderClockContext } from './_shared/byteTexture';
import { Logger } from '../services/logger';
import { ComputeEffectRuntime } from './ComputeEffectRuntime';
import { SplitComparePipeline } from './SplitComparePipeline';
import type { SplitCompareSettings } from '../stores/splitCompareStore';
import { EffectLandmarkBuffers } from './EffectLandmarkBuffers';
import { DenseTerrainPipeline } from './tracking/DenseTerrainPipeline';
import { nodePreviewTextureTap } from '../services/nodePreview/NodePreviewTextureTap';
import { imageGraphDefinition } from './_shared/imageGraphDefinition';
import { resolveImageGraphExternalResources } from './_shared/imageGraphExternalResources';
import { EffectPipelineCache } from './EffectPipelineCache';
import { captureImageOperatorPreviews } from '../services/nodePreview/imageOperatorTexturePreviews';
import type { ImageOperatorMemoryWindowResource } from '../services/operators/imageOperatorExternalResources';
import { compileAnalogSignalGraph, createDefaultAnalogSignalGraph } from '../services/operators/analogSignalGraph';
import { captureAnalogSignalStagePreviews } from '../services/nodePreview/analogSignalPreviews';
import { captureAnalogImageOperatorPreviews } from '../services/nodePreview/analogImageOperatorPreviews';
import { captureComputeImageOperatorPreviews, captureComputeImageOutputPreviews } from '../services/nodePreview/computeImageOperatorPreviews';
import { effectOperatorCompileContext, effectOperatorGraph, isComputeImageEffectType, isImageGraphEffectType } from '../services/operators/effectGraphOwner';
import { effectOperatorParams } from '../services/operators/effectGraphOwner';
import { prepareImageEffect } from '../services/operators/imageEffectRuntimePlan';
import { compileComputeImageGraph } from '../services/operators/computeImageGraph';
import { ImageGraphPassRuntime } from './ImageGraphPassRuntime';
import {
  transitionFrameHistory,
  type FrameHistoryDiscontinuity,
  type FrameHistoryState,
} from './frameHistoryTransition';
import { resolveFeedbackHistoryLoop } from './_shared/feedbackParameters';

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
  committedTexture: GPUTexture;
  committedView: GPUTextureView;
  currentTexture: GPUTexture;
  width: number;
  height: number;
  lifecycle: FrameHistoryState | null;
  lastEventRevision?: number;
  planKey?: string;
  committedRevision: number;
}

export interface EffectFrameHistoryContext {
  scopeId: string;
  eventRevision: number;
  discontinuity?: FrameHistoryDiscontinuity;
  ownerRevision: number;
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
  private inputHistory: InputHistoryRuntime;
  private temporalResources: TemporalEffectResources;
  private device: GPUDevice;
  private pipelineCache: EffectPipelineCache;
  private feedbackStates = new Map<string, FeedbackState>();
  private landmarkBuffers = new EffectLandmarkBuffers();
  private byteTextures: ByteTextureCache;
  private computeRuntime: ComputeEffectRuntime;
  private splitComparePipeline: SplitComparePipeline;
  private imageGraphPassRuntime: ImageGraphPassRuntime;
  private initialized = false;
  private denseTerrain?: DenseTerrainPipeline;

  constructor(device: GPUDevice, onPipelineReady?: () => void) {
    this.device = device;
    this.inputHistory = new InputHistoryRuntime(device);
    this.temporalResources = new TemporalEffectResources(device, onPipelineReady);
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
      if (effect.usesInputHistory) return; // The graph supplies the temporal sampler bindings.
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

  private getFeedbackState(effect: EffectInstance, width: number, height: number, scopeId: string): FeedbackState {
    const key = JSON.stringify([scopeId, effect.id]);
    const existing = this.feedbackStates.get(key);

    if (existing && existing.width === width && existing.height === height) {
      return existing;
    }

    existing?.committedTexture.destroy();
    existing?.currentTexture.destroy();

    const createTexture = (role: string) => this.device.createTexture({
      label: `effect-feedback-${role}-${effect.type}-${effect.id}`,
      size: { width, height },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.COPY_SRC,
    });
    const committedTexture = createTexture('committed');
    const currentTexture = createTexture('current');

    const state: FeedbackState = {
      committedTexture,
      committedView: committedTexture.createView(),
      currentTexture,
      width,
      height,
      lifecycle: null,
      committedRevision: 0,
    };
    this.feedbackStates.set(key, state);
    return state;
  }

  private clearFeedback(commandEncoder: GPUCommandEncoder, state: FeedbackState): void {
    const pass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: state.committedView,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.end();
    state.committedRevision += 1;
  }

  private prepareFeedbackState(commandEncoder: GPUCommandEncoder, state: FeedbackState, effect: EffectInstance,
    timelineTimeSeconds: number, frameHistory?: EffectFrameHistoryContext, planKey?: string, rebuiltPipeline = false): void {
    const eventIsNew = frameHistory !== undefined && frameHistory.eventRevision !== state.lastEventRevision;
    const recompiled = planKey !== undefined && state.planKey !== undefined && state.planKey !== planKey;
    const transition = transitionFrameHistory(rebuiltPipeline || recompiled ? null : state.lifecycle, {
      timelineTimeSeconds, ownerRevision: frameHistory?.ownerRevision ?? 0,
      resetRequested: effect.params.reset === true,
      discontinuity: eventIsNew ? frameHistory.discontinuity : undefined,
      loopPolicy: resolveFeedbackHistoryLoop(effect.params),
    });
    state.lifecycle = transition.state;
    state.planKey = planKey ?? state.planKey;
    if (frameHistory) state.lastEventRevision = frameHistory.eventRevision;
    if (transition.action === 'reset') this.clearFeedback(commandEncoder, state);
    else if (transition.action === 'advance') {
      commandEncoder.copyTextureToTexture({ texture: state.currentTexture }, { texture: state.committedTexture },
        { width: state.width, height: state.height });
      state.committedRevision += 1;
    }
  }

  private copyFeedbackOutput(commandEncoder: GPUCommandEncoder, state: FeedbackState, outputView: GPUTextureView,
    pingView: GPUTextureView, pongView: GPUTextureView, width: number, height: number, pingTexture?: GPUTexture, pongTexture?: GPUTexture): void {
    const outputTexture = this.getOutputTexture(outputView, pingView, pongView, pingTexture, pongTexture);
    if (outputTexture) commandEncoder.copyTextureToTexture({ texture: outputTexture }, { texture: state.currentTexture }, { width, height });
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
    pongTexture?: GPUTexture,
    compare?: { outputView: GPUTextureView; settings: SplitCompareSettings },
    timelineTimeSeconds = 0,
    frameHistory?: EffectFrameHistoryContext,
    renderClock?: EffectRenderClockContext,
    sourceMasks?: readonly ClipMask[],
    temporalSource?: TemporalClipSource,
    geometryCapture?: SlitScanGeometryCaptureSink,
  ): { finalView: GPUTextureView; swapped: boolean } {
    const requestedFrameRate = renderClock?.frameRate;
    const clock: EffectRenderClockContext = {
      frameRate: typeof requestedFrameRate === 'number' && Number.isFinite(requestedFrameRate) && requestedFrameRate > 0 ? requestedFrameRate : 30,
      scopeId: renderClock?.scopeId || 'legacy',
    };
    const enabledEffects = effects.filter(e => e.enabled && !e.type.startsWith('audio-'));
    if (enabledEffects.length === 0) {
      return { finalView: inputView, swapped: false };
    }

    let effectInput = inputView;
    let effectOutput = outputView;
    let swapped = false;

    for (const originalEffect of enabledEffects) {
      const effect = originalEffect.type === 'slit-scan' && (isCollectingTemporalPreparations() || geometryCapture)
        ? { ...originalEffect, params: { ...originalEffect.params, scanSmoothingPreview: false } } : originalEffect;
      const previewKey = effect.type === 'slit-scan' && effect.params.temporalStorage === 'resident' && !isCollectingTemporalPreparations()
        ? JSON.stringify([frameHistory?.scopeId ?? clock.scopeId, effect.id, temporalSource?.mediaId, effect.params.scanSmoothingPreview === true]) : undefined;
      const registered = getEffect(effect.type);
      const imageGraphEffect = isImageGraphEffectType(effect.type);
      const preparedImage = imageGraphEffect ? prepareImageEffect(effect) : undefined;
      if (preparedImage?.graph.incomplete) continue;
      const imagePlan = preparedImage?.plan;
      let feedbackState = imagePlan?.frameHistoryResource
        ? this.getFeedbackState(effect, outputWidth, outputHeight, frameHistory?.scopeId ?? 'legacy') : null;
      if (feedbackState && imagePlan) this.prepareFeedbackState(commandEncoder, feedbackState, effect, timelineTimeSeconds, frameHistory, imagePlan.key);
      const resolveMemoryWindow = imageGraphEffect ? (descriptor: ImageOperatorMemoryWindowResource) => {
          if (!registered || !isFullscreenEffectDefinition(registered) || !registered.byteTexture) {
            throw new Error('Memory window graph requires a byte-texture provider.');
          }
          const upload = registered.byteTexture({ ...descriptor.options }, {
            effectInstanceId: effect.id, width: outputWidth, height: outputHeight, timelineTimeSeconds,
            frameRate: clock.frameRate, scopeId: clock.scopeId,
          });
          const key = JSON.stringify([clock.scopeId, effect.id, descriptor.id]);
          return { view: this.byteTextures.getView(key, upload),
            identity: upload ? `memory-window:${upload.version}:${upload.width}x${upload.height}` : 'memory-window:unavailable',
            width: upload?.width ?? 1, height: upload?.height ?? 1, available: upload !== null };
        } : undefined;
      const stabilizationActive = effect.params.stabilizationEnabled !== false && !!effect.params.stabilizationAssetId;
      const nativeTemporal = effect.type === 'slit-scan' && (stabilizationActive
        || imagePlan?.externalResources?.some(resource => resource.kind === 'input-history'));
      const inputHistory = nativeTemporal ? this.inputHistory.emptyResources() : (imagePlan?.externalResources?.some(resource => resource.kind === 'input-history')
        ? this.inputHistory.prepare(JSON.stringify([frameHistory?.scopeId ?? clock.scopeId, effect.id]), commandEncoder,
          effectInput, sampler, outputWidth, outputHeight, timelineTimeSeconds, 4, frameHistory,
          String(effect.params.temporalInterpolation ?? 'linear'),
          effect.params.temporalMode === 'prepared' && effect.params.temporalResolution === 'native') : undefined);
      const imageExternalResources = imagePlan ? new Map(resolveImageGraphExternalResources(this.device, imagePlan, { resolveMemoryWindow,
        resolveSourceMotion: descriptor => this.inputHistory.emptyResources()[descriptor.part], resolveInputHistory: inputHistory ? descriptor => inputHistory[descriptor.part] : undefined })) : undefined;
      let graphInput = effectInput;
      try {
        if (imageExternalResources && imagePlan && !this.temporalResources.resolveNamed(imageExternalResources,
          [...new Set([...(imagePlan.resourceInputs ?? []), ...(imagePlan.passes?.flatMap(pass => pass.inputResources) ?? [])])], effect, frameHistory?.scopeId ?? clock.scopeId,
          timelineTimeSeconds, sourceMasks, outputWidth, outputHeight, commandEncoder, temporalSource,
          { view: effectInput, width: outputWidth, height: outputHeight }, imagePlan.externalResources, preparedImage?.graph)) {
          effectInput = this.temporalResources.previewFrames.get(previewKey, outputWidth, outputHeight) ?? effectInput; continue;
        }
        if (nativeTemporal && imagePlan && preparedImage && imageExternalResources) {
          const nativeHistory = this.temporalResources.resolveNative(effect,
            frameHistory?.scopeId ?? clock.scopeId, temporalSource, commandEncoder,
            { view: effectInput, width: outputWidth, height: outputHeight },
            { queryIds: imagePlan.externalResources?.flatMap(resource => resource.kind === 'input-history' && resource.owner ? [resource.owner] : []),
              graph: preparedImage.graph, sampler, timelineTime: timelineTimeSeconds, externalResources: imageExternalResources, effect });
          if (!nativeHistory || (stabilizationActive && !nativeHistory.current)) {
            effectInput = this.temporalResources.previewFrames.get(previewKey, outputWidth, outputHeight) ?? effectInput;
            continue;
          }
          if (nativeHistory?.current) graphInput = nativeHistory.current.view;
          if (nativeHistory) for (const resource of imagePlan.externalResources ?? []) {
            if (resource.kind === 'input-history') {
              const queries = nativeHistory.queries;
              const selected = queries && resource.owner ? queries[resource.owner] : nativeHistory;
              if (!selected) throw new Error(`Temporal query ${resource.owner} is unavailable.`);
              imageExternalResources.set(resource.id, selected[resource.part]);
            }
          }
        }
      } catch (error) {
        setTemporalStatus(effect.id, `Effect unavailable: ${error instanceof Error ? error.message : String(error)}`);
        if (isCollectingTemporalPreparations()) throw error; // Export must not silently omit an effect.
        continue; // Keep the input and let the rest of the preview stack render.
      }
      if (feedbackState && imagePlan?.frameHistoryResource) imageExternalResources?.set(imagePlan.frameHistoryResource, {
        view: feedbackState.committedView,
        identity: `effect-history:${feedbackState.committedRevision}`,
      });
      const imagePassBatch = imagePlan && (imagePlan.passes?.length || imagePlan.resourceInputs?.length) ? this.imageGraphPassRuntime.createBatch() : undefined;
      if (imageGraphEffect) captureImageOperatorPreviews({
        effect,
        device: this.device,
        encoder: commandEncoder,
        sampler,
        source: { kind: 'texture', view: graphInput },
        width: outputWidth,
        height: outputHeight,
        timelineTimeSeconds,
        passRuntime: imagePassBatch ? this.imageGraphPassRuntime : undefined,
        passBatch: imagePassBatch,
        externalResources: imageExternalResources,
        resolveMemoryWindow,
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
      if (imagePlan && (imagePlan.passes?.length || imagePlan.resourceInputs?.length)) {
        try {
          this.imageGraphPassRuntime.encode({ encoder: commandEncoder, sampler, source: { kind: 'texture', view: graphInput }, width: outputWidth,
            height: outputHeight, timelineTimeSeconds, plan: imagePlan, outputView: effectOutput, outputFormat: 'rgba8unorm',
            instanceId: JSON.stringify([frameHistory?.scopeId ?? 'legacy', effect.id]), batch: imagePassBatch,
            externalResources: imageExternalResources });
          effectInput = this.temporalResources.finishImage(effect.id, timelineTimeSeconds, commandEncoder, effectOutput, outputWidth, outputHeight, previewKey);
          if (geometryCapture && effect.type === 'slit-scan' && preparedImage && imageExternalResources) {
            geometryCapture({ effect, graph: preparedImage.graph, device: this.device, encoder: commandEncoder,
              sampler, input: graphInput, color: effectInput, width: outputWidth, height: outputHeight,
              timelineTime: timelineTimeSeconds, scopeId: frameHistory?.scopeId ?? clock.scopeId,
              source: temporalSource, resources: imageExternalResources,
              historyResources: imagePlan.externalResources?.filter(resource => resource.kind === 'input-history') ?? [],
              passRuntime: this.imageGraphPassRuntime,
              resolveResources: (plan, resources, graph) => this.temporalResources.resolveNamed(resources,
                [...new Set([...(plan.resourceInputs ?? []), ...(plan.passes?.flatMap(pass => pass.inputResources) ?? [])])],
                effect, frameHistory?.scopeId ?? clock.scopeId, timelineTimeSeconds, sourceMasks, outputWidth, outputHeight,
                commandEncoder, temporalSource, { view: graphInput, width: outputWidth, height: outputHeight }, plan.externalResources, graph) });
          }
          if (feedbackState) this.copyFeedbackOutput(commandEncoder, feedbackState, effectOutput, pingView, pongView,
            outputWidth, outputHeight, pingTexture, pongTexture);
          effectOutput = this.getNextOutputView(effectOutput, pingView, pongView); swapped = !swapped;
          nodePreviewTextureTap.capture(`effect:${effect.id}`, this.device, commandEncoder, sampler, effectInput, outputWidth, outputHeight);
        } catch (error) {
          log.error(`Resource-backed image effect failed: ${effect.type}`, error);
          if (isCollectingTemporalPreparations()) throw error;
          if (geometryCapture) setTemporalStatus(`${effect.id}:geometry`, `Geometry unavailable: ${String(error)}`);
        }
        continue;
      }
      const definition = imageGraphEffect && isFullscreenEffectDefinition(registered)
        ? imageGraphDefinition(effect, registered, timelineTimeSeconds, imagePlan) : registered;
      if (isComputeEffectDefinition(definition)) {
        if (definition.computeMode === 'analog-signal' && effect.operatorGraph?.incomplete) continue;
        const computeGraph = isComputeImageEffectType(effect.type) ? effectOperatorGraph(effect) : undefined;
        if (computeGraph?.incomplete) continue;
        const computeImagePlan = computeGraph ? compileComputeImageGraph(computeGraph, effectOperatorParams(effect), effectOperatorCompileContext(effect)) : undefined;
        const effectParams = definition.computeMode === 'analog-signal' || computeImagePlan
          ? null : this.createEffectUniformData(effect, outputWidth, outputHeight, timelineTimeSeconds);
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
            computeImagePlan,
            sampler,
            onComputeImageResources: fieldResources => captureComputeImageOperatorPreviews({
              effect, fieldResources, device: this.device, encoder: commandEncoder, sampler,
              source: { kind: 'texture', view: effectInput }, width: outputWidth, height: outputHeight, timelineTimeSeconds,
            }),
            instanceId: computeImagePlan
              ? JSON.stringify([frameHistory?.scopeId ?? 'legacy', effect.id])
              : effect.id,
            timelineTimeSeconds,
            onAnalogImageInputs: (stage, inputs) => captureAnalogImageOperatorPreviews({
              effect, stage, inputs, device: this.device, encoder: commandEncoder, sampler,
            }),
            onAnalogStageOutput: (stage, view, width, height) => {
              if (stage.kind === 'analyze') return;
              captureAnalogSignalStagePreviews({ effect, nodeId: stage.nodeId, kind: stage.kind, device: this.device,
                encoder: commandEncoder, sampler, view, width, height });
            },
          });
          if (computeImagePlan) captureComputeImageOutputPreviews({ effect, device: this.device, encoder: commandEncoder,
            sampler, view: rendered ? effectOutput : effectInput, width: outputWidth, height: outputHeight });
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

      feedbackState = definition.usesFeedback
        ? this.getFeedbackState(effect, outputWidth, outputHeight, frameHistory?.scopeId ?? 'legacy')
        : null;

      if (feedbackState) {
        this.prepareFeedbackState(commandEncoder, feedbackState, effect, timelineTimeSeconds, frameHistory, undefined, rebuiltPipeline);
      }

      const entries: GPUBindGroupEntry[] = [
        { binding: 0, resource: sampler },
        { binding: 1, resource: graphInput },
      ];

      if (effectUniformBuffer) {
        entries.push({ binding: 2, resource: { buffer: effectUniformBuffer } });
      }

      if (feedbackState) {
        entries.push({ binding: 3, resource: feedbackState.committedView });
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
          frameRate: clock.frameRate,
          scopeId: clock.scopeId,
        });
        entries.push({ binding: 5, resource: this.byteTextures.getView(JSON.stringify([clock.scopeId, effect.id]), upload) });
      }

      if (definition.landmarkPoints) {
        entries.push({ binding: 6, resource: { buffer: this.landmarkBuffers.get(this.device, effect.id) } });
      }

      const effectBindGroup = this.pipelineCache.createBindGroup(pipelineKey, entries);
      if (!effectBindGroup) continue;

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
        this.copyFeedbackOutput(commandEncoder, feedbackState, effectOutput, pingView, pongView,
          outputWidth, outputHeight, pingTexture, pongTexture);
      }

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

  destroy(): void {
    this.inputHistory.destroy();
    this.temporalResources.destroy();
    this.denseTerrain?.destroy();this.denseTerrain=undefined;
    for (const state of this.feedbackStates.values()) {
      state.committedTexture.destroy();
      state.currentTexture.destroy();
    }
    this.feedbackStates.clear();
    this.landmarkBuffers.destroy();
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
