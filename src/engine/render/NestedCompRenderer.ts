// Pre-renders nested compositions to offscreen textures

import type { TimelineClip, TimelineTrack } from '../../types';
import type { Layer, LayerRenderData } from '../core/types';
import type { CompositorPipeline } from '../pipeline/CompositorPipeline';
import type { EffectsPipeline } from '../../effects/EffectsPipeline';
import type { ColorPipeline } from '../color/ColorPipeline';
import type { TextureManager } from '../texture/TextureManager';
import type { MaskTextureManager } from '../texture/MaskTextureManager';
import type { ScrubbingCache } from '../texture/ScrubbingCache';
import { flags } from '../featureFlags';
import { MAX_NESTING_DEPTH } from '../../stores/timeline/constants';
import { Logger } from '../../services/logger';
import {
  isActiveNestedComposition,
} from '../../services/render/nestedCompRenderStoreAccess';
import type { MotionRenderer } from '../motion/MotionRenderer';
import { Compositor } from './Compositor';
import {
  createMotionFrameRuntimeAdmission,
  describeMotionFrameRuntimeFailure,
  getMotionDeviceMaxInstances,
  getMotionDeviceTextureLimits,
  hasMotionFrameLayers,
  type MotionFrameRuntimeAdmission,
} from '../motion/MotionFrameRuntime';
import { compositeNestedLayers } from './nestedComp/compositeNestedLayers';
import { NestedCompositionTexturePool } from './nestedComp/NestedCompositionTexturePool';
import { process3DLayersForNestedScene } from './nestedComp/sharedScene';
import { NestedLayerCollector } from './nestedComp/NestedLayerCollector';

const log = Logger.create('NestedCompRenderer');

interface NestedCompTexture {
  compositionId: string;
  renderOccurrenceKey?: string;
  texture: GPUTexture;
  view: GPUTextureView;
  initialized: boolean;
  lastRenderedTimeSeconds?: number;
}

function getNestedCompCacheKey(compositionId: string, renderOccurrenceKey?: string): string {
  return renderOccurrenceKey === undefined
    ? compositionId
    : `occurrence:${JSON.stringify([compositionId, renderOccurrenceKey])}`;
}

const MAX_NESTED_PLAYBACK_PREVIEW_SCALE = 0.5;
const MAX_OCCURRENCE_HANDOFF_DELTA_SECONDS = 1;

export function resolveNestedPreviewRenderScale(input: {
  compositionWidth: number;
  compositionHeight: number;
  outputWidth: number;
  outputHeight: number;
  isPlaying: boolean;
  particleQuality: 'preview' | 'export';
}): number {
  if (input.particleQuality === 'export') return 1;

  const widthScale = input.compositionWidth > 0
    ? input.outputWidth / input.compositionWidth
    : 1;
  const heightScale = input.compositionHeight > 0
    ? input.outputHeight / input.compositionHeight
    : 1;
  const outputScale = Math.max(0.01, Math.min(1, widthScale, heightScale));

  return input.isPlaying
    ? Math.min(outputScale, MAX_NESTED_PLAYBACK_PREVIEW_SCALE)
    : outputScale;
}

function isRenderableNestedLayer(layer: Layer): boolean {
  return !!layer?.source && layer.visible !== false && layer.opacity !== 0;
}

function isActiveNestedLayer(layer: Layer): boolean {
  return !!layer && layer.visible !== false && layer.opacity !== 0;
}

function isCriticalNestedLayer(layer: Layer): boolean {
  if (!isRenderableNestedLayer(layer)) return false;
  const source = layer.source;
  return !!(
    source?.nestedComposition ||
    source?.type === 'video' ||
    source?.videoElement ||
    source?.videoFrame ||
    source?.webCodecsPlayer ||
    source?.runtimeSourceId ||
    source?.nativeDecoder
  );
}

function hasMutableAuthoredContent(layers: readonly Layer[]): boolean {
  // Text canvases are painted in place and Motion definitions can be edited
  // without advancing the playhead. They do not expose a renderer revision,
  // so a time-only cache would retain stale native authoring content.
  return layers.some(layer => layer.source?.type === 'text' || layer.source?.type === 'motion');
}

function hasMissingCriticalNestedLayer(
  layers: readonly Layer[],
  layerData: readonly LayerRenderData[],
): boolean {
  const collectedLayerIds = new Set(layerData.map((entry) => entry.layer.id));
  return layers.some((layer) => isCriticalNestedLayer(layer) && !collectedLayerIds.has(layer.id));
}

function scaleNested3DSourceGeometryForPreview(
  layerData: LayerRenderData[],
  renderScale: number,
): void {
  if (renderScale === 1) return;
  for (const data of layerData) {
    if (!data.layer.is3D) continue;
    const source = data.layer.source;
    if (source) {
      const intrinsicWidth = source.intrinsicWidth;
      const intrinsicHeight = source.intrinsicHeight;
      if (
        (Number.isFinite(intrinsicWidth) && (intrinsicWidth ?? 0) > 0) ||
        (Number.isFinite(intrinsicHeight) && (intrinsicHeight ?? 0) > 0)
      ) {
        data.layer = {
          ...data.layer,
          source: {
            ...source,
            ...(Number.isFinite(intrinsicWidth) && (intrinsicWidth ?? 0) > 0
              ? { intrinsicWidth: intrinsicWidth! * renderScale }
              : {}),
            ...(Number.isFinite(intrinsicHeight) && (intrinsicHeight ?? 0) > 0
              ? { intrinsicHeight: intrinsicHeight! * renderScale }
              : {}),
          },
        };
      }
    }
    if (Number.isFinite(data.sourceWidth) && data.sourceWidth > 0) {
      data.sourceWidth *= renderScale;
    }
    if (Number.isFinite(data.sourceHeight) && data.sourceHeight > 0) {
      data.sourceHeight *= renderScale;
    }
  }
}

export class NestedCompRenderer {
  private device: GPUDevice;
  private effectsPipeline: EffectsPipeline;
  private compositor: Compositor;
  private maskTextureManager: MaskTextureManager;
  private motionRenderer: MotionRenderer | null;
  private nestedCompTextures: Map<string, NestedCompTexture> = new Map();

  private texturePool: NestedCompositionTexturePool;

  // Frame caching: track last render time to skip redundant re-renders
  private lastRenderTime: Map<string, number> = new Map();
  private lastLayerCount: Map<string, number> = new Map();
  private lastMotionFrameRevision: Map<string, string> = new Map();
  private activeOccurrenceCacheKeys = new Set<string>();
  private readonly layerCollector: NestedLayerCollector;

  private initializeFromRecentOccurrence(
    target: NestedCompTexture,
    commandEncoder: GPUCommandEncoder,
    currentTime: number | undefined,
  ): boolean {
    if (target.initialized || !Number.isFinite(currentTime)) return target.initialized;

    let source: NestedCompTexture | undefined;
    let closestDelta = Number.POSITIVE_INFINITY;
    for (const candidate of this.nestedCompTextures.values()) {
      if (
        candidate === target ||
        candidate.compositionId !== target.compositionId ||
        !candidate.initialized ||
        candidate.texture.width !== target.texture.width ||
        candidate.texture.height !== target.texture.height ||
        !Number.isFinite(candidate.lastRenderedTimeSeconds)
      ) {
        continue;
      }
      const delta = Math.abs(candidate.lastRenderedTimeSeconds! - currentTime!);
      if (delta <= MAX_OCCURRENCE_HANDOFF_DELTA_SECONDS && delta < closestDelta) {
        source = candidate;
        closestDelta = delta;
      }
    }

    if (!source) return false;

    commandEncoder.copyTextureToTexture(
      { texture: source.texture },
      { texture: target.texture },
      { width: target.texture.width, height: target.texture.height },
    );
    target.initialized = true;
    target.lastRenderedTimeSeconds = source.lastRenderedTimeSeconds;
    return true;
  }


  constructor(
    device: GPUDevice,
    compositorPipeline: CompositorPipeline,
    effectsPipeline: EffectsPipeline,
    textureManager: TextureManager,
    maskTextureManager: MaskTextureManager,
    scrubbingCache: ScrubbingCache | null = null,
    colorPipeline: ColorPipeline | null = null,
    motionRenderer: MotionRenderer | null = null
  ) {
    this.device = device;
    this.effectsPipeline = effectsPipeline;
    this.compositor = new Compositor(
      compositorPipeline,
      effectsPipeline,
      maskTextureManager,
      colorPipeline,
    );
    this.maskTextureManager = maskTextureManager;
    this.texturePool = new NestedCompositionTexturePool(device);
    this.motionRenderer = motionRenderer;
    this.layerCollector = new NestedLayerCollector(
      textureManager, scrubbingCache, motionRenderer, (...args) => this.preRender(...args),
    );
  }

  preRender(
    compositionId: string,
    nestedLayers: Layer[],
    width: number,
    height: number,
    commandEncoder: GPUCommandEncoder,
    sampler: GPUSampler,
    currentTime?: number,
    sceneClips?: TimelineClip[],
    sceneTracks?: TimelineTrack[],
    depth: number = 0,
    skipEffects = false,
    particleQuality: 'preview' | 'export' = 'preview',
    suppliedMotionFrameAdmission?: MotionFrameRuntimeAdmission,
    renderOccurrenceKey?: string,
    previewRenderScale = 1,
  ): GPUTextureView | null {
    if (depth >= MAX_NESTING_DEPTH) {
      log.warn('Max nesting depth reached in preRender', { compositionId, depth });
      return null;
    }
    const cacheKey = getNestedCompCacheKey(compositionId, renderOccurrenceKey);
    if (renderOccurrenceKey !== undefined) this.activeOccurrenceCacheKeys.add(cacheKey);
    const effectiveRenderScale = particleQuality === 'export'
      ? 1
      : Math.max(0.01, Math.min(1, previewRenderScale));
    const renderWidth = Math.max(1, Math.round(width * effectiveRenderScale));
    const renderHeight = Math.max(1, Math.round(height * effectiveRenderScale));

    // The active composition was already composited by the main render pass.
    // When an inactive parent needs that exact child frame, sample the raw
    // active output directly instead of rendering every child layer again.
    // The parent compositor still applies the wrapper transform/effects.
    const activeOutput = renderOccurrenceKey !== undefined
      && particleQuality === 'preview'
      && isActiveNestedComposition(compositionId)
      ? this.nestedCompTextures.get(compositionId)
      : undefined;
    if (
      activeOutput?.initialized
      && activeOutput.texture.width === renderWidth
      && activeOutput.texture.height === renderHeight
      && Number.isFinite(currentTime)
      && Number.isFinite(activeOutput.lastRenderedTimeSeconds)
      && Math.round(activeOutput.lastRenderedTimeSeconds! * 60) === Math.round(currentTime! * 60)
    ) {
      return activeOutput.view;
    }

    // Get or create one output texture per render occurrence. Two wrapper layers
    // can reference the same composition at different local times in one frame,
    // so composition identity alone is not a safe render-target cache key.
    let compTexture = this.nestedCompTextures.get(cacheKey);
    if (!compTexture || compTexture.texture.width !== renderWidth || compTexture.texture.height !== renderHeight) {
      // Destroy old texture to free VRAM (safe - not in current command encoder yet)
      if (compTexture) compTexture.texture.destroy();

      const texture = this.device.createTexture({
        size: { width: renderWidth, height: renderHeight },
        format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
      });
      compTexture = {
        compositionId,
        ...(renderOccurrenceKey !== undefined ? { renderOccurrenceKey } : {}),
        texture,
        view: texture.createView(),
        initialized: false,
      };
      this.nestedCompTextures.set(cacheKey, compTexture);
    }

    // Frame caching: skip re-render if same time and layer count
    // Quantize time to ~60fps frames to avoid floating point issues
    const quantizedTime = currentTime !== undefined ? Math.round(currentTime * 60) : -1;
    const lastTime = this.lastRenderTime.get(cacheKey);
    const lastCount = this.lastLayerCount.get(cacheKey);
    const motionFrameAdmission = suppliedMotionFrameAdmission ?? (
      hasMotionFrameLayers(nestedLayers)
        ? createMotionFrameRuntimeAdmission({
            consumer: particleQuality === 'export' ? 'export' : 'nested-preview',
            compositionId,
            timelineTimeSeconds: currentTime ?? 0,
            layers: nestedLayers,
            deviceMaxInstances: getMotionDeviceMaxInstances(this.device),
            ...getMotionDeviceTextureLimits(this.device),
          })
        : undefined
    );
    const motionFrameRevision = motionFrameAdmission === undefined
      ? 'none'
      : motionFrameAdmission.ok
        ? motionFrameAdmission.consumerInput.frameState.evaluationRevision
        : `failed:${motionFrameAdmission.failures.map((failure) => failure.code).join(',')}`;
    const lastMotionFrameRevision = this.lastMotionFrameRevision.get(cacheKey);
    if (motionFrameAdmission && !motionFrameAdmission.ok) {
      const failure = describeMotionFrameRuntimeFailure(motionFrameAdmission);
      if (particleQuality === 'export') {
        throw new Error(`Nested export Motion frame admission failed: ${failure}`);
      }
      log.warn('Nested Motion frame admission failed; affected Motion layers are hidden', {
        compositionId,
        failure,
      });
    }

    if (!nestedLayers.some(isCriticalNestedLayer) && !hasMutableAuthoredContent(nestedLayers) && compTexture.initialized && quantizedTime >= 0 && lastTime === quantizedTime && lastCount === nestedLayers.length && lastMotionFrameRevision === motionFrameRevision) {
      // Same frame, return cached texture
      return compTexture.view;
    }

    // Acquire ping-pong textures from pool
    const texturePair = this.texturePool.acquire(renderWidth, renderHeight);
    const effectTexturePair = this.texturePool.acquire(renderWidth, renderHeight);
    const nestedPingView = texturePair.pingView;
    const nestedPongView = texturePair.pongView;
    const effectTempView = effectTexturePair.pingView;
    const effectTempView2 = effectTexturePair.pongView;

    try {
      // Collect layer data (including sub-nested compositions)
      const nestedLayerData = this.collectNestedLayerData(
        nestedLayers,
        commandEncoder,
        sampler,
        depth,
        skipEffects,
        particleQuality,
        motionFrameAdmission,
        renderOccurrenceKey,
        effectiveRenderScale,
      );
      if (hasMissingCriticalNestedLayer(nestedLayers, nestedLayerData)) {
        if (particleQuality === 'preview') {
          this.initializeFromRecentOccurrence(compTexture, commandEncoder, currentTime);
        }
        return particleQuality === 'preview' && compTexture.initialized ? compTexture.view : null;
      }

      // Process 3D layers through the shared scene renderer.
      if (flags.use3DLayers) {
        // The nested-scene helper currently builds its camera from the render
        // viewport. Keep its plane/voxel footprint stable at reduced quality;
        // the synthetic scene texture is restored to composition-space size
        // immediately afterward for the reference-aware 2D compositor.
        scaleNested3DSourceGeometryForPreview(nestedLayerData, effectiveRenderScale);
        this.process3DLayersForNested(
          nestedLayerData,
          renderWidth,
          renderHeight,
          currentTime,
          compositionId,
          sceneClips,
          sceneTracks,
          sampler,
        );
        const nestedSceneLayer = nestedLayerData.find(
          (data) => data.layer.id === '__scene_3d_nested__',
        );
        if (nestedSceneLayer) {
          nestedSceneLayer.sourceWidth = width;
          nestedSceneLayer.sourceHeight = height;
        }
      }

      // Handle empty composition
      if (nestedLayerData.length === 0) {
        const hasActiveNestedLayer = nestedLayers.some(isActiveNestedLayer);
        const hasPendingSceneWithoutLayers = nestedLayers.length === 0 && (sceneClips?.length ?? 0) > 0;
        if (hasActiveNestedLayer || hasPendingSceneWithoutLayers) {
          // Input layers exist but none could be collected (transient decode gap)
          // Retain the existing texture which holds the last good frame
          if (particleQuality === 'preview') {
            this.initializeFromRecentOccurrence(compTexture, commandEncoder, currentTime);
          }
          return particleQuality === 'preview' && compTexture.initialized ? compTexture.view : null;
        }
        // Genuinely empty composition - clear to transparent
        const clearPass = commandEncoder.beginRenderPass({
          colorAttachments: [{
            view: compTexture.view,
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear',
            storeOp: 'store',
          }],
        });
        clearPass.end();
        compTexture.initialized = true;
        compTexture.lastRenderedTimeSeconds = Number.isFinite(currentTime) ? currentTime : undefined;
        this.lastRenderTime.set(cacheKey, quantizedTime);
        this.lastLayerCount.set(cacheKey, nestedLayers.length);
        this.lastMotionFrameRevision.set(cacheKey, motionFrameRevision);
        return compTexture.view;
      }

      const sourceTexture = compositeNestedLayers({
        layerData: nestedLayerData,
        device: this.device,
        compositionId,
        width: renderWidth,
        height: renderHeight,
        referenceWidth: width,
        referenceHeight: height,
        commandEncoder,
        sampler,
        compositor: this.compositor,
        maskTextureManager: this.maskTextureManager,
        skipEffects,
        texturePair,
        effectTexturePair,
        nestedPingView,
        nestedPongView,
        effectTempView,
        effectTempView2,
        motionTime: currentTime,
        particleQuality,
        resourceNamespace: cacheKey,
      });
      commandEncoder.copyTextureToTexture(
        { texture: sourceTexture },
        { texture: compTexture.texture },
        { width: renderWidth, height: renderHeight }
      );

      compTexture.initialized = true;
      compTexture.lastRenderedTimeSeconds = Number.isFinite(currentTime) ? currentTime : undefined;
      this.lastRenderTime.set(cacheKey, quantizedTime);
      this.lastLayerCount.set(cacheKey, nestedLayers.length);
      this.lastMotionFrameRevision.set(cacheKey, motionFrameRevision);
      return compTexture.view;
    } finally {
      this.texturePool.release(effectTexturePair);
      this.texturePool.release(texturePair);
    }
  }

  /**
   * Process 3D layers inside nested compositions via the shared scene renderer.
   */
  private process3DLayersForNested(
    layerData: LayerRenderData[],
    width: number,
    height: number,
    currentTime?: number,
    compositionId?: string,
    sceneClips?: TimelineClip[],
    sceneTracks?: TimelineTrack[],
    sampler?: GPUSampler,
  ): void {
    process3DLayersForNestedScene({
      layerData,
      device: this.device,
      maskTextureManager: this.maskTextureManager,
      log,
      width,
      height,
      currentTime,
      compositionId,
      sceneClips,
      sceneTracks,
      effectsPipeline: this.effectsPipeline,
      sampler,
    });
  }

  private collectNestedLayerData(
    layers: Layer[],
    commandEncoder?: GPUCommandEncoder,
    sampler?: GPUSampler,
    depth: number = 0,
    skipEffects = false,
    particleQuality: 'preview' | 'export' = 'preview',
    motionFrameAdmission?: MotionFrameRuntimeAdmission,
    renderOccurrenceKey?: string,
    previewRenderScale = 1,
  ): LayerRenderData[] {
    return this.layerCollector.collect(
      layers, commandEncoder, sampler, depth, skipEffects, particleQuality,
      motionFrameAdmission, renderOccurrenceKey, previewRenderScale,
    );
  }

  hasTexture(compositionId: string): boolean {
    for (const texture of this.nestedCompTextures.values()) {
      if (texture.compositionId === compositionId) return true;
    }
    return false;
  }

  getTexture(compositionId: string, renderOccurrenceKey?: string): NestedCompTexture | undefined {
    if (renderOccurrenceKey !== undefined) {
      const cacheKey = getNestedCompCacheKey(compositionId, renderOccurrenceKey);
      const texture = this.nestedCompTextures.get(cacheKey);
      if (texture) this.activeOccurrenceCacheKeys.add(cacheKey);
      return texture;
    }

    let match: { cacheKey: string; texture: NestedCompTexture } | undefined;
    for (const [cacheKey, texture] of this.nestedCompTextures) {
      if (texture.compositionId !== compositionId) continue;
      if (match) return undefined;
      match = { cacheKey, texture };
    }
    if (match) this.activeOccurrenceCacheKeys.add(match.cacheKey);
    return match?.texture;
  }

  cleanupPendingTextures(): void {
    for (const [cacheKey, entry] of this.nestedCompTextures) {
      if (
        entry.renderOccurrenceKey === undefined ||
        this.activeOccurrenceCacheKeys.has(cacheKey)
      ) {
        continue;
      }
      entry.texture.destroy();
      this.nestedCompTextures.delete(cacheKey);
      this.lastRenderTime.delete(cacheKey);
      this.lastLayerCount.delete(cacheKey);
      this.lastMotionFrameRevision.delete(cacheKey);
    }
    this.activeOccurrenceCacheKeys.clear();
    this.motionRenderer?.cleanupPendingCaches();
    this.maskTextureManager.cleanupPendingFrameScopedTextures?.();
  }

  cleanupTexture(compositionId: string): void {
    for (const [cacheKey, entry] of this.nestedCompTextures) {
      if (entry.compositionId !== compositionId) continue;
      entry.texture.destroy();
      this.nestedCompTextures.delete(cacheKey);
      this.activeOccurrenceCacheKeys.delete(cacheKey);
      this.lastRenderTime.delete(cacheKey);
      this.lastLayerCount.delete(cacheKey);
      this.lastMotionFrameRevision.delete(cacheKey);
    }
  }

  /**
   * Cache the current main render output for a composition
   */
  cacheActiveCompOutput(
    compositionId: string,
    sourceTexture: GPUTexture,
    width: number,
    height: number,
    timelineTimeSeconds?: number,
  ): void {
    let compTexture = this.nestedCompTextures.get(compositionId);
    if (!compTexture || compTexture.texture.width !== width || compTexture.texture.height !== height) {
      if (compTexture) compTexture.texture.destroy();

      const texture = this.device.createTexture({
        size: { width, height },
        format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT
          | GPUTextureUsage.TEXTURE_BINDING
          | GPUTextureUsage.COPY_SRC
          | GPUTextureUsage.COPY_DST,
      });
      compTexture = { compositionId, texture, view: texture.createView(), initialized: false };
      this.nestedCompTextures.set(compositionId, compTexture);
    }

    const commandEncoder = this.device.createCommandEncoder();
    commandEncoder.copyTextureToTexture(
      { texture: sourceTexture },
      { texture: compTexture.texture },
      { width, height }
    );
    this.device.queue.submit([commandEncoder.finish()]);
    compTexture.initialized = true;
    compTexture.lastRenderedTimeSeconds = Number.isFinite(timelineTimeSeconds)
      ? timelineTimeSeconds
      : undefined;
  }

  /**
   * Invalidate frame cache for a specific composition or all
   */
  invalidateCache(compositionId?: string): void {
    if (compositionId) {
      for (const [cacheKey, texture] of this.nestedCompTextures) {
        if (texture.compositionId !== compositionId) continue;
        this.lastRenderTime.delete(cacheKey);
        this.lastLayerCount.delete(cacheKey);
        this.lastMotionFrameRevision.delete(cacheKey);
      }
    } else {
      this.lastRenderTime.clear();
      this.lastLayerCount.clear();
      this.lastMotionFrameRevision.clear();
    }
  }

  destroy(): void {
    // Clear frame cache
    this.lastRenderTime.clear();
    this.lastLayerCount.clear();
    this.lastMotionFrameRevision.clear();
    this.activeOccurrenceCacheKeys.clear();

    this.layerCollector.destroy();

    // Destroy nested comp textures
    for (const tex of this.nestedCompTextures.values()) {
      tex.texture.destroy();
    }
    this.nestedCompTextures.clear();

    this.compositor.destroy();
    this.texturePool.destroy();
  }
}
