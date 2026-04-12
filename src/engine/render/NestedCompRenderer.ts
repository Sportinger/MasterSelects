// Pre-renders nested compositions to offscreen textures

import type { Layer, LayerRenderData } from '../core/types';
import type { CompositorPipeline } from '../pipeline/CompositorPipeline';
import type { EffectsPipeline } from '../../effects/EffectsPipeline';
import type { TextureManager } from '../texture/TextureManager';
import type { MaskTextureManager } from '../texture/MaskTextureManager';
import type { ScrubbingCache } from '../texture/ScrubbingCache';
import { flags } from '../featureFlags';
import { MAX_NESTING_DEPTH } from '../../stores/timeline/constants';
import { Logger } from '../../services/logger';
import {
  getRuntimeFrameProvider,
  readRuntimeFrameForSource,
} from '../../services/mediaRuntime/runtimePlayback';
import { scrubSettleState } from '../../services/scrubSettleState';
import { wcPipelineMonitor } from '../../services/wcPipelineMonitor';
import { useTimelineStore } from '../../stores/timeline';
import { getCopiedHtmlVideoPreviewFrame } from './htmlVideoPreviewFallback';
import { splitLayerEffects } from './layerEffectStack';
import { getThreeSceneRenderer } from '../three/ThreeSceneRenderer';
import { DEFAULT_CAMERA_CONFIG } from '../three/types';
import type { Layer3DData } from '../three/types';

const log = Logger.create('NestedCompRenderer');
const ENABLE_VISUAL_HTML_VIDEO_FALLBACK = false;

interface NestedCompTexture {
  texture: GPUTexture;
  view: GPUTextureView;
}

interface PooledTexturePair {
  pingTexture: GPUTexture;
  pongTexture: GPUTexture;
  pingView: GPUTextureView;
  pongView: GPUTextureView;
  width: number;
  height: number;
  inUse: boolean;
}

export class NestedCompRenderer {
  private static readonly MAX_DRAG_FALLBACK_DRIFT_SECONDS = 1.2;
  private static readonly MAX_DRAG_LIVE_IMPORT_DRIFT_SECONDS = 0.9;
  private device: GPUDevice;
  private compositorPipeline: CompositorPipeline;
  private effectsPipeline: EffectsPipeline;
  private textureManager: TextureManager;
  private maskTextureManager: MaskTextureManager;
  private scrubbingCache: ScrubbingCache | null;
  private nestedCompTextures: Map<string, NestedCompTexture> = new Map();

  // Texture pool for ping-pong buffers, keyed by "widthxheight"
  private texturePool: Map<string, PooledTexturePair[]> = new Map();

  // Frame caching: track last render time to skip redundant re-renders
  private lastRenderTime: Map<string, number> = new Map();
  private lastLayerCount: Map<string, number> = new Map();
  private providerIds = new WeakMap<object, number>();
  private nextProviderId = 1;
  private lastSuccessfulVideoProviderKey = new Map<string, string>();
  private lastCollectorState = new Map<string, 'render' | 'hold' | 'drop'>();
  private htmlHoldUntil = new Map<string, number>();
  private static readonly HTML_HOLD_RECOVERY_MS = 120;

  private getSafeLastFrameFallback(layer: Layer, video: HTMLVideoElement, targetTime: number) {
    if (!this.scrubbingCache) {
      return null;
    }
    const isDragging = useTimelineStore.getState().isDraggingPlayhead;
    const tolerance = video.seeking || isDragging ? 0.35 : 0.2;
    return this.scrubbingCache.getLastFrameNearTime(video, targetTime, tolerance, layer.sourceClipId);
  }

  private getTargetVideoTime(layer: Layer, video: HTMLVideoElement): number {
    return layer.source?.mediaTime ?? video.currentTime;
  }

  private resolveStable3DSourceDimensions(
    data: LayerRenderData,
    width: number,
    height: number,
  ): { sourceWidth: number; sourceHeight: number } {
    const fallbackWidth =
      typeof data.sourceWidth === 'number' && Number.isFinite(data.sourceWidth) && data.sourceWidth > 0
        ? data.sourceWidth
        : width;
    const fallbackHeight =
      typeof data.sourceHeight === 'number' && Number.isFinite(data.sourceHeight) && data.sourceHeight > 0
        ? data.sourceHeight
        : height;

    const intrinsicWidth = data.layer.source?.intrinsicWidth;
    const intrinsicHeight = data.layer.source?.intrinsicHeight;

    return {
      sourceWidth:
        typeof intrinsicWidth === 'number' && Number.isFinite(intrinsicWidth) && intrinsicWidth > 0
          ? intrinsicWidth
          : fallbackWidth,
      sourceHeight:
        typeof intrinsicHeight === 'number' && Number.isFinite(intrinsicHeight) && intrinsicHeight > 0
          ? intrinsicHeight
          : fallbackHeight,
    };
  }

  private getFrameTimestampSeconds(timestamp: unknown, fallback?: number): number | undefined {
    return typeof timestamp === 'number' && Number.isFinite(timestamp)
      ? timestamp / 1_000_000
      : fallback;
  }

  private getDragHoldFrame(layer: Layer, video: HTMLVideoElement) {
    if (!layer.sourceClipId) {
      return null;
    }
    return this.scrubbingCache?.getLastFrame(video, layer.sourceClipId) ?? null;
  }

  private isFrameNearTarget(
    frame: { mediaTime?: number } | null | undefined,
    targetTime: number,
    maxDeltaSeconds: number = 0.35
  ): boolean {
    return (
      typeof frame?.mediaTime === 'number' &&
      Number.isFinite(frame.mediaTime) &&
      Math.abs(frame.mediaTime - targetTime) <= maxDeltaSeconds
    );
  }

  private isPendingWebCodecsFrameStable(
    provider: NonNullable<Layer['source']>['webCodecsPlayer'] | undefined
  ): boolean {
    if (!provider) {
      return true;
    }

    const pendingTarget = provider.getPendingSeekTime?.();
    if (pendingTarget == null) {
      return true;
    }

    const fps = provider.getFrameRate?.() ?? 30;
    const tolerance = Math.max(1.5 / Math.max(fps, 1), 0.05);
    return Math.abs(pendingTarget - provider.currentTime) <= tolerance;
  }

  private getProviderObjectId(provider: object): number {
    const existing = this.providerIds.get(provider);
    if (existing !== undefined) {
      return existing;
    }
    const next = this.nextProviderId++;
    this.providerIds.set(provider, next);
    return next;
  }

  private getVideoProviderKey(
    layer: Layer,
    frameProvider: NonNullable<Layer['source']>['webCodecsPlayer'] | null,
    runtimeProvider: NonNullable<Layer['source']>['webCodecsPlayer'] | null
  ): string | null {
    if (!frameProvider) {
      return null;
    }
    if (
      runtimeProvider &&
      frameProvider === runtimeProvider &&
      layer.source?.runtimeSourceId &&
      layer.source.runtimeSessionKey
    ) {
      return `runtime:${layer.source.runtimeSourceId}:${layer.source.runtimeSessionKey}`;
    }
    return `provider:${this.getProviderObjectId(frameProvider as object)}`;
  }

  private getLayerReuseKey(layer: Layer): string {
    return layer.sourceClipId ? `${layer.id}:${layer.sourceClipId}` : layer.id;
  }

  private canReuseLastSuccessfulVideoFrame(layerId: string, providerKey: string | null): boolean {
    return !!providerKey && this.lastSuccessfulVideoProviderKey.get(layerId) === providerKey;
  }

  private armHtmlHold(layerId: string): void {
    this.htmlHoldUntil.set(
      layerId,
      performance.now() + NestedCompRenderer.HTML_HOLD_RECOVERY_MS
    );
  }

  private clearHtmlHold(layerId: string): void {
    this.htmlHoldUntil.delete(layerId);
  }

  private shouldPreferHtmlHold(
    layerId: string,
    options: {
      hasHoldFrame: boolean;
      isDragging: boolean;
      isSettling: boolean;
      awaitingPausedTargetFrame: boolean;
      hasFreshPresentedFrame: boolean;
    }
  ): boolean {
    if (!options.hasHoldFrame) {
      this.clearHtmlHold(layerId);
      return false;
    }

    if (
      !options.isDragging &&
      !options.isSettling &&
      !options.awaitingPausedTargetFrame &&
      options.hasFreshPresentedFrame
    ) {
      this.clearHtmlHold(layerId);
      return false;
    }

    return (this.htmlHoldUntil.get(layerId) ?? 0) > performance.now();
  }

  private setCollectorState(
    layerId: string,
    state: 'render' | 'hold' | 'drop',
    detail?: Record<string, number | string>
  ): void {
    if (this.lastCollectorState.get(layerId) === state) {
      return;
    }
    this.lastCollectorState.set(layerId, state);
    if (state === 'hold') {
      wcPipelineMonitor.record('collector_hold', detail);
    } else if (state === 'drop') {
      wcPipelineMonitor.record('collector_drop', detail);
    }
  }

  constructor(
    device: GPUDevice,
    compositorPipeline: CompositorPipeline,
    effectsPipeline: EffectsPipeline,
    textureManager: TextureManager,
    maskTextureManager: MaskTextureManager,
    scrubbingCache: ScrubbingCache | null = null
  ) {
    this.device = device;
    this.compositorPipeline = compositorPipeline;
    this.effectsPipeline = effectsPipeline;
    this.textureManager = textureManager;
    this.maskTextureManager = maskTextureManager;
    this.scrubbingCache = scrubbingCache;
  }

  // Acquire a ping-pong texture pair from pool or create new
  private acquireTexturePair(width: number, height: number): PooledTexturePair {
    const key = `${width}x${height}`;
    let pool = this.texturePool.get(key);
    if (!pool) {
      pool = [];
      this.texturePool.set(key, pool);
    }

    // Find available pair
    for (const pair of pool) {
      if (!pair.inUse) {
        pair.inUse = true;
        return pair;
      }
    }

    // Create new pair
    const pingTexture = this.device.createTexture({
      size: { width, height },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    });
    const pongTexture = this.device.createTexture({
      size: { width, height },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    });

    const pair: PooledTexturePair = {
      pingTexture,
      pongTexture,
      pingView: pingTexture.createView(),
      pongView: pongTexture.createView(),
      width,
      height,
      inUse: true,
    };
    pool.push(pair);
    return pair;
  }

  // Release texture pair back to pool
  private releaseTexturePair(pair: PooledTexturePair): void {
    pair.inUse = false;
  }

  preRender(
    compositionId: string,
    nestedLayers: Layer[],
    width: number,
    height: number,
    commandEncoder: GPUCommandEncoder,
    sampler: GPUSampler,
    currentTime?: number,
    depth: number = 0,
    skipEffects = false
  ): GPUTextureView | null {
    if (depth >= MAX_NESTING_DEPTH) {
      log.warn('Max nesting depth reached in preRender', { compositionId, depth });
      return null;
    }
    // Get or create output texture
    let compTexture = this.nestedCompTextures.get(compositionId);
    if (!compTexture || compTexture.texture.width !== width || compTexture.texture.height !== height) {
      // Destroy old texture to free VRAM (safe - not in current command encoder yet)
      if (compTexture) compTexture.texture.destroy();

      const texture = this.device.createTexture({
        size: { width, height },
        format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
      });
      compTexture = { texture, view: texture.createView() };
      this.nestedCompTextures.set(compositionId, compTexture);
    }

    // Frame caching: skip re-render if same time and layer count
    // Quantize time to ~60fps frames to avoid floating point issues
    const quantizedTime = currentTime !== undefined ? Math.round(currentTime * 60) : -1;
    const lastTime = this.lastRenderTime.get(compositionId);
    const lastCount = this.lastLayerCount.get(compositionId);

    if (quantizedTime >= 0 && lastTime === quantizedTime && lastCount === nestedLayers.length) {
      // Same frame, return cached texture
      return compTexture.view;
    }

    // Update cache tracking
    this.lastRenderTime.set(compositionId, quantizedTime);
    this.lastLayerCount.set(compositionId, nestedLayers.length);

    // Acquire ping-pong textures from pool
    const texturePair = this.acquireTexturePair(width, height);
    const effectTexturePair = this.acquireTexturePair(width, height);
    const nestedPingView = texturePair.pingView;
    const nestedPongView = texturePair.pongView;
    const effectTempView = effectTexturePair.pingView;
    const effectTempView2 = effectTexturePair.pongView;

    try {
      // Collect layer data (including sub-nested compositions)
      const nestedLayerData = this.collectNestedLayerData(nestedLayers, commandEncoder, sampler, depth, skipEffects);

      // Process 3D layers via Three.js (same logic as RenderDispatcher.process3DLayers)
      if (flags.use3DLayers) {
        this.process3DLayersForNested(nestedLayerData, width, height);
      }

      // Handle empty composition
      if (nestedLayerData.length === 0) {
        if (nestedLayers.length > 0) {
          // Input layers exist but none could be collected (transient decode gap)
          // Retain the existing texture which holds the last good frame
          return compTexture.view;
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
        return compTexture.view;
      }

      // Ping-pong compositing
      let readView = nestedPingView;
      let writeView = nestedPongView;

      // Clear first buffer
      const clearPass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: readView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      clearPass.end();

      // Composite nested layers
      const outputAspect = width / height;
      for (const data of nestedLayerData) {
        const layer = data.layer;
        const uniformBuffer = this.compositorPipeline.getOrCreateUniformBuffer(`nested-${compositionId}-${layer.id}`);
        const sourceAspect = data.sourceWidth / data.sourceHeight;
        const maskLookupId = layer.maskClipId || layer.id;
        const maskInfo = this.maskTextureManager.getMaskInfo(maskLookupId);
        const hasMask = maskInfo.hasMask;
        const maskTextureView = maskInfo.view;
        const { inlineEffects, complexEffects } = splitLayerEffects(layer.effects, skipEffects);

        this.compositorPipeline.updateLayerUniforms(
          layer,
          sourceAspect,
          outputAspect,
          hasMask,
          uniformBuffer,
          inlineEffects
        );

        let sourceTextureView = data.textureView;
        let sourceExternalTexture = data.externalTexture;
        let useExternalTexture = data.isVideo && !!data.externalTexture;

        if (complexEffects && complexEffects.length > 0) {
          if (useExternalTexture && sourceExternalTexture) {
            const copyPipeline = this.compositorPipeline.getExternalCopyPipeline?.();
            const copyBindGroup = copyPipeline
              ? this.compositorPipeline.createExternalCopyBindGroup?.(
                sampler,
                sourceExternalTexture,
                layer.id
              )
              : null;

            if (copyPipeline && copyBindGroup) {
              const copyPass = commandEncoder.beginRenderPass({
                colorAttachments: [{
                  view: effectTempView,
                  loadOp: 'clear',
                  storeOp: 'store',
                }],
              });
              copyPass.setPipeline(copyPipeline);
              copyPass.setBindGroup(0, copyBindGroup);
              copyPass.draw(6);
              copyPass.end();

              const effectResult = this.effectsPipeline.applyEffects(
                commandEncoder,
                complexEffects,
                sampler,
                effectTempView,
                effectTempView2,
                effectTempView,
                effectTempView2,
                width,
                height
              );

              sourceTextureView = effectResult.finalView;
              sourceExternalTexture = null;
              useExternalTexture = false;
            }
          } else if (sourceTextureView) {
            const copyPipeline = this.compositorPipeline.getCopyPipeline?.();
            const copyBindGroup = copyPipeline
              ? this.compositorPipeline.createCopyBindGroup?.(
                sampler,
                sourceTextureView,
                layer.id
              )
              : null;

            if (copyPipeline && copyBindGroup) {
              const copyPass = commandEncoder.beginRenderPass({
                colorAttachments: [{
                  view: effectTempView,
                  loadOp: 'clear',
                  storeOp: 'store',
                }],
              });
              copyPass.setPipeline(copyPipeline);
              copyPass.setBindGroup(0, copyBindGroup);
              copyPass.draw(6);
              copyPass.end();

              const effectResult = this.effectsPipeline.applyEffects(
                commandEncoder,
                complexEffects,
                sampler,
                effectTempView,
                effectTempView2,
                effectTempView,
                effectTempView2,
                width,
                height
              );

              sourceTextureView = effectResult.finalView;
            }
          }
        }

        let pipeline: GPURenderPipeline;
        let bindGroup: GPUBindGroup;

        if (useExternalTexture && sourceExternalTexture) {
          pipeline = this.compositorPipeline.getExternalCompositePipeline()!;
          bindGroup = this.compositorPipeline.createExternalCompositeBindGroup(
            sampler,
            readView,
            sourceExternalTexture,
            uniformBuffer,
            maskTextureView
          );
        } else if (sourceTextureView) {
          pipeline = this.compositorPipeline.getCompositePipeline()!;
          bindGroup = this.compositorPipeline.createCompositeBindGroup(
            sampler,
            readView,
            sourceTextureView,
            uniformBuffer,
            maskTextureView
          );
        } else {
          continue;
        }

        const pass = commandEncoder.beginRenderPass({
          colorAttachments: [{ view: writeView, loadOp: 'clear', storeOp: 'store' }],
        });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.draw(6);
        pass.end();

        // Swap
        [readView, writeView] = [writeView, readView];
      }

      // Copy result to output texture using efficient GPU copy
      // Determine which texture readView came from
      const sourceTexture = readView === nestedPingView ? texturePair.pingTexture : texturePair.pongTexture;
      commandEncoder.copyTextureToTexture(
        { texture: sourceTexture },
        { texture: compTexture.texture },
        { width, height }
      );

      return compTexture.view;
    } finally {
      this.releaseTexturePair(effectTexturePair);
      this.releaseTexturePair(texturePair);
    }
  }

  /**
   * Process 3D layers inside nested compositions via Three.js.
   * Same approach as RenderDispatcher.process3DLayers but operates on the nested layerData.
   */
  private process3DLayersForNested(layerData: LayerRenderData[], width: number, height: number): void {
    const indices3D: number[] = [];
    for (let i = 0; i < layerData.length; i++) {
      if (layerData[i].layer.is3D && layerData[i].layer.source?.type !== 'gaussian-avatar') {
        indices3D.push(i);
      }
    }
    if (indices3D.length === 0) {
      // Debug: log what layers we have and why none are 3D
      if (layerData.length > 0) {
        log.debug('No 3D layers in nested comp', {
          totalLayers: layerData.length,
          sourceTypes: layerData.map(d => d.layer.source?.type),
          is3Ds: layerData.map(d => d.layer.is3D),
        });
      }
      return;
    }
    log.debug('Processing 3D layers in nested comp', { count: indices3D.length });

    const renderer = getThreeSceneRenderer();
    if (!renderer.isInitialized) {
      // Trigger lazy initialization (same as RenderDispatcher)
      renderer.initialize(width, height).then((ok) => {
        if (ok) log.info('Three.js initialized from nested comp');
      });
      // Remove 3D layers for this frame — next frame will render them
      for (let i = indices3D.length - 1; i >= 0; i--) layerData.splice(indices3D[i], 1);
      return;
    }

    // Build Layer3DData
    const preciseSplatSorting = useTimelineStore.getState().isExporting === true;
    const layers3D: Layer3DData[] = [];
    for (const idx of indices3D) {
      const data = layerData[idx];
      const layer = data.layer;
      const src = layer.source;
      const stableSourceSize = this.resolveStable3DSourceDimensions(data, width, height);
      const rot = typeof layer.rotation === 'number' ? { x: 0, y: 0, z: layer.rotation } : layer.rotation;
      const radToDeg = 180 / Math.PI;
      layers3D.push({
        layerId: layer.id,
        clipId: layer.sourceClipId || layer.id,
        position: layer.position,
        rotation: {
          x: rot.x * radToDeg,
          y: rot.y * radToDeg,
          z: rot.z * radToDeg,
        },
        scale: { x: layer.scale.x, y: layer.scale.y, z: layer.scale.z ?? 1 },
        opacity: layer.opacity,
        blendMode: layer.blendMode,
        sourceWidth: stableSourceSize.sourceWidth,
        sourceHeight: stableSourceSize.sourceHeight,
        videoElement: src?.videoElement ?? undefined,
        imageElement: src?.imageElement ?? undefined,
        canvas: src?.textCanvas ?? undefined,
        modelUrl: src?.modelUrl ?? undefined,
        modelFileName: layer.name,
        meshType: src?.meshType ?? undefined,
        text3DProperties: src?.text3DProperties ?? undefined,
        wireframe: layer.wireframe,
        gaussianSplatUrl: src?.gaussianSplatUrl ?? undefined,
        gaussianSplatFileName: src?.gaussianSplatFileName ?? undefined,
        gaussianSplatFileHash: src?.gaussianSplatFileHash ?? undefined,
        gaussianSplatMediaFileId: src?.mediaFileId ?? undefined,
        gaussianSplatSettings: src?.gaussianSplatSettings ?? undefined,
        preciseSplatSorting,
      });
    }

    const canvas = renderer.renderScene(layers3D, DEFAULT_CAMERA_CONFIG, width, height, []);
    if (!canvas) {
      for (let i = indices3D.length - 1; i >= 0; i--) layerData.splice(indices3D[i], 1);
      return;
    }

    // Import canvas to GPU texture
    if (!this.threeNestedTexture || this.threeNestedTexture.width !== width || this.threeNestedTexture.height !== height) {
      this.threeNestedTexture?.destroy();
      this.threeNestedTexture = this.device.createTexture({
        size: { width, height },
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.threeNestedView = this.threeNestedTexture.createView();
    }

    this.device.queue.copyExternalImageToTexture(
      { source: canvas },
      { texture: this.threeNestedTexture },
      { width, height },
    );

    // Create synthetic layer and replace 3D layers
    const insertIdx = indices3D[0];
    const firstLayer = layerData[indices3D[0]].layer;
    const isSingle = indices3D.length === 1;
    const syntheticLayer: Layer = {
      id: '__three_nested__',
      name: '3D Scene (Nested)',
      visible: true,
      opacity: isSingle ? firstLayer.opacity : 1,
      blendMode: isSingle ? firstLayer.blendMode : 'normal',
      source: { type: 'image' },
      effects: isSingle ? firstLayer.effects : [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    };

    for (let i = indices3D.length - 1; i >= 0; i--) layerData.splice(indices3D[i], 1);
    layerData.splice(insertIdx, 0, {
      layer: syntheticLayer,
      isVideo: false,
      externalTexture: null,
      textureView: this.threeNestedView,
      sourceWidth: width,
      sourceHeight: height,
    });
  }

  // Texture for nested 3D scene rendering
  private threeNestedTexture: GPUTexture | null = null;
  private threeNestedView: GPUTextureView | null = null;

  private collectNestedLayerData(
    layers: Layer[],
    commandEncoder?: GPUCommandEncoder,
    sampler?: GPUSampler,
    depth: number = 0,
    skipEffects = false
  ): LayerRenderData[] {
    const result: LayerRenderData[] = [];

    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      if (!layer?.visible || !layer.source || layer.opacity === 0) continue;

      // Sub-nested composition (Level 3+)
      if (layer.source.nestedComposition && commandEncoder && sampler) {
        const nc = layer.source.nestedComposition;
        const subTextureView = this.preRender(
          nc.compositionId,
          nc.layers,
          nc.width,
          nc.height,
          commandEncoder,
          sampler,
          nc.currentTime,
          depth + 1,
          skipEffects
        );
        if (subTextureView) {
          result.push({
            layer,
            isVideo: false,
            externalTexture: null,
            textureView: subTextureView,
            sourceWidth: nc.width,
            sourceHeight: nc.height,
          });
        }
        continue;
      }

      // 3D Model layers — no GPU texture needed, handled by ThreeSceneRenderer
      if (layer.source.type === 'model') {
        result.push({
          layer,
          isVideo: false,
          externalTexture: null,
          textureView: null,
          sourceWidth: 0,
          sourceHeight: 0,
        });
        continue;
      }

      // NativeDecoder (turbo mode — ImageBitmap-based)
      if (layer.source.nativeDecoder) {
        const bitmap = layer.source.nativeDecoder.getCurrentFrame();
        if (bitmap) {
          const texture = this.textureManager.createImageBitmapTexture(bitmap, layer.id);
          if (texture) {
            result.push({
              layer, isVideo: false, externalTexture: null,
              textureView: this.textureManager.getDynamicTextureView(layer.id) ?? texture.createView(),
              sourceWidth: bitmap.width, sourceHeight: bitmap.height,
            });
            continue;
          }
        }
      }

      // VideoFrame
      if (layer.source.videoFrame) {
        const frame = layer.source.videoFrame;
        const extTex = this.textureManager.importVideoTexture(frame);
        if (extTex) {
          result.push({
            layer, isVideo: true, externalTexture: extTex, textureView: null,
            sourceWidth: frame.displayWidth, sourceHeight: frame.displayHeight,
          });
          continue;
        }
      }

      const runtimeProvider = getRuntimeFrameProvider(layer.source, 'background');
      const clipProvider = layer.source.webCodecsPlayer?.isFullMode()
        ? layer.source.webCodecsPlayer
        : null;
      const htmlPreviewDebugDisabled =
        flags.useFullWebCodecsPlayback &&
        flags.disableHtmlPreviewFallback;
      const hasFullWebCodecsPreview =
        flags.useFullWebCodecsPlayback &&
        (!!clipProvider || !!runtimeProvider?.isFullMode());
      const allowHtmlScrubPreview =
        !htmlPreviewDebugDisabled &&
        !hasFullWebCodecsPreview &&
        (useTimelineStore.getState().isDraggingPlayhead || scrubSettleState.isPending(layer.sourceClipId)) &&
        !!layer.source.videoElement;
      const allowHtmlVideoPreview =
        !!layer.source.videoElement &&
        !htmlPreviewDebugDisabled &&
        (!hasFullWebCodecsPreview ||
          ENABLE_VISUAL_HTML_VIDEO_FALLBACK ||
          allowHtmlScrubPreview);

      if (allowHtmlVideoPreview) {
        const video = layer.source.videoElement!;
        const layerReuseKey = this.getLayerReuseKey(layer);
        const targetTime = this.getTargetVideoTime(layer, video);
        const isDragging = useTimelineStore.getState().isDraggingPlayhead;
        const isSettling = scrubSettleState.isPending(layer.sourceClipId);
        const isPausedSettle = !useTimelineStore.getState().isPlaying && !isDragging && isSettling;
        const lastPresentedTime = this.scrubbingCache?.getLastPresentedTime(video);
        const lastPresentedOwner = this.scrubbingCache?.getLastPresentedOwner(video);
        const hasPresentedOwnerMismatch =
          !!layer.sourceClipId &&
          !!lastPresentedOwner &&
          lastPresentedOwner !== layer.sourceClipId;
        const hasConfirmedPresentedFrame =
          !hasPresentedOwnerMismatch &&
          typeof lastPresentedTime === 'number' &&
          Number.isFinite(lastPresentedTime);
        const displayedTime = hasConfirmedPresentedFrame ? lastPresentedTime : undefined;
        const reportedDisplayedTime =
          useTimelineStore.getState().isPlaying &&
          !video.paused &&
          !video.seeking &&
          Number.isFinite(video.currentTime)
            ? video.currentTime
            : displayedTime;
        const hasFreshPresentedFrame =
          hasConfirmedPresentedFrame &&
          Math.abs(lastPresentedTime - targetTime) <= 0.12;
        const presentedDriftSeconds = hasConfirmedPresentedFrame
          ? Math.abs(lastPresentedTime - targetTime)
          : undefined;
        const awaitingPausedTargetFrame =
          hasPresentedOwnerMismatch ||
          !useTimelineStore.getState().isPlaying &&
          !isDragging &&
          (!isSettling &&
            (!hasConfirmedPresentedFrame || Math.abs(lastPresentedTime - targetTime) > 0.05));
        const cacheSearchDistanceFrames = isDragging ? 12 : 6;
        const lastSameClipFrame = this.getDragHoldFrame(layer, video);
        const dragHoldFrame = isDragging
          ? this.isFrameNearTarget(
            lastSameClipFrame,
            targetTime,
            NestedCompRenderer.MAX_DRAG_FALLBACK_DRIFT_SECONDS
          )
            ? lastSameClipFrame
            : null
          : (isSettling || awaitingPausedTargetFrame) && this.isFrameNearTarget(lastSameClipFrame, targetTime)
            ? lastSameClipFrame
            : null;
        const emergencyHoldFrame = dragHoldFrame;
        const sameClipHoldFrame =
          !useTimelineStore.getState().isPlaying &&
          (isDragging || isSettling || awaitingPausedTargetFrame || video.seeking)
            ? lastSameClipFrame
            : null;
        const safeFallback = this.getSafeLastFrameFallback(layer, video, targetTime) ?? dragHoldFrame;
        const shouldPreferStableHold = this.shouldPreferHtmlHold(layerReuseKey, {
          hasHoldFrame: !!safeFallback || !!emergencyHoldFrame || !!sameClipHoldFrame,
          isDragging,
          isSettling,
          awaitingPausedTargetFrame,
          hasFreshPresentedFrame,
        });
        const allowDragLiveVideoImport =
          !shouldPreferStableHold &&
          !video.seeking &&
          (
            !hasConfirmedPresentedFrame ||
            (presentedDriftSeconds ?? 0) <= NestedCompRenderer.MAX_DRAG_LIVE_IMPORT_DRIFT_SECONDS
          );
        const allowLiveVideoImport =
          !shouldPreferStableHold &&
          !hasPresentedOwnerMismatch &&
          (isPausedSettle
            ? hasFreshPresentedFrame
            : !awaitingPausedTargetFrame &&
              (((!isDragging && !isSettling) || hasFreshPresentedFrame || (isDragging ? allowDragLiveVideoImport : !safeFallback))));
        const allowConfirmedFrameCaching = !hasPresentedOwnerMismatch && (isPausedSettle
          ? hasFreshPresentedFrame
          : !awaitingPausedTargetFrame &&
            (((!isDragging && !isSettling) || hasFreshPresentedFrame)));
        const captureOwnerId = allowConfirmedFrameCaching ? layer.sourceClipId : undefined;
        if ((video.seeking || awaitingPausedTargetFrame) && this.scrubbingCache) {
          const cachedView =
            this.scrubbingCache.getCachedFrame(video.src, targetTime) ??
            this.scrubbingCache.getNearestCachedFrame(video.src, targetTime, cacheSearchDistanceFrames);
          if (cachedView) {
            this.armHtmlHold(layerReuseKey);
            result.push({
              layer, isVideo: false, externalTexture: null, textureView: cachedView,
              sourceWidth: video.videoWidth, sourceHeight: video.videoHeight,
            });
            continue;
          }
          if (!allowLiveVideoImport) {
            if (safeFallback) {
              this.armHtmlHold(layerReuseKey);
              result.push({
                layer, isVideo: false, externalTexture: null, textureView: safeFallback.view,
                sourceWidth: safeFallback.width, sourceHeight: safeFallback.height,
              });
              continue;
            }
            if (emergencyHoldFrame) {
              this.armHtmlHold(layerReuseKey);
              result.push({
                layer, isVideo: false, externalTexture: null, textureView: emergencyHoldFrame.view,
                sourceWidth: emergencyHoldFrame.width, sourceHeight: emergencyHoldFrame.height,
              });
              continue;
            }
            if (sameClipHoldFrame) {
              this.armHtmlHold(layerReuseKey);
              result.push({
                layer, isVideo: false, externalTexture: null, textureView: sameClipHoldFrame.view,
                sourceWidth: sameClipHoldFrame.width, sourceHeight: sameClipHoldFrame.height,
                displayedMediaTime: sameClipHoldFrame.mediaTime,
                targetMediaTime: targetTime,
                previewPath: 'same-clip-hold',
              });
              continue;
            }
            continue;
          }
        }
        if (video.readyState >= 2) {
          if (allowLiveVideoImport) {
            const copiedFrame = getCopiedHtmlVideoPreviewFrame(
              video,
              this.scrubbingCache,
              targetTime,
              layer.sourceClipId,
            captureOwnerId
          );
          if (copiedFrame) {
            this.clearHtmlHold(layerReuseKey);
            result.push({
              layer, isVideo: false, externalTexture: null, textureView: copiedFrame.view,
              sourceWidth: copiedFrame.width, sourceHeight: copiedFrame.height,
                displayedMediaTime: copiedFrame.mediaTime ?? reportedDisplayedTime,
                targetMediaTime: targetTime,
                previewPath: 'copied-preview',
              });
              continue;
            }
          }

          const extTex = allowLiveVideoImport
            ? this.textureManager.importVideoTexture(video)
            : null;
          if (extTex) {
            this.clearHtmlHold(layerReuseKey);
            if (this.scrubbingCache) {
              const now = performance.now();
              const lastCapture = this.scrubbingCache.getLastCaptureTime(video);
              if (allowConfirmedFrameCaching && now - lastCapture > 50) {
                this.scrubbingCache.captureVideoFrame(video, captureOwnerId);
                this.scrubbingCache.setLastCaptureTime(video, now);
              }
              if (allowConfirmedFrameCaching) {
                this.scrubbingCache.cacheFrameAtTime(video, targetTime);
              } else {
                if (typeof displayedTime === 'number' && Number.isFinite(displayedTime)) {
                  this.scrubbingCache.captureVideoFrameIfCloser(
                    video,
                    targetTime,
                    displayedTime,
                    layer.sourceClipId
                  );
                }
                if (typeof displayedTime === 'number' && Number.isFinite(displayedTime)) {
                  this.scrubbingCache.cacheFrameAtTime(video, displayedTime);
                }
              }
            }
            result.push({
              layer, isVideo: true, externalTexture: extTex, textureView: null,
              sourceWidth: video.videoWidth, sourceHeight: video.videoHeight,
              displayedMediaTime: reportedDisplayedTime,
              targetMediaTime: targetTime,
              previewPath: 'live-import',
            });
            continue;
          } else {
            log.warn('Failed to import video texture', { layerId: layer.id });
          }
        }

        const notReadyCachedFrame =
          this.scrubbingCache?.getCachedFrameEntry(video.src, targetTime) ??
          this.scrubbingCache?.getNearestCachedFrameEntry(video.src, targetTime, cacheSearchDistanceFrames);
        if (notReadyCachedFrame) {
          this.armHtmlHold(layerReuseKey);
          result.push({
            layer,
            isVideo: false,
            externalTexture: null,
            textureView: notReadyCachedFrame.view,
            sourceWidth: video.videoWidth,
            sourceHeight: video.videoHeight,
            displayedMediaTime: notReadyCachedFrame.mediaTime,
            targetMediaTime: targetTime,
            previewPath: 'not-ready-scrub-cache',
          });
          continue;
        }

        if (safeFallback) {
          this.armHtmlHold(layerReuseKey);
          log.debug('Using cached frame fallback for nested video', { layerId: layer.id });
          result.push({
            layer, isVideo: false, externalTexture: null, textureView: safeFallback.view,
            sourceWidth: safeFallback.width, sourceHeight: safeFallback.height,
          });
          continue;
        }
        if (emergencyHoldFrame) {
          this.armHtmlHold(layerReuseKey);
          result.push({
            layer, isVideo: false, externalTexture: null, textureView: emergencyHoldFrame.view,
            sourceWidth: emergencyHoldFrame.width, sourceHeight: emergencyHoldFrame.height,
            displayedMediaTime: emergencyHoldFrame.mediaTime,
            targetMediaTime: targetTime,
            previewPath: 'emergency-hold',
          });
          continue;
        }
        if (sameClipHoldFrame) {
          this.armHtmlHold(layerReuseKey);
          result.push({
            layer, isVideo: false, externalTexture: null, textureView: sameClipHoldFrame.view,
            sourceWidth: sameClipHoldFrame.width, sourceHeight: sameClipHoldFrame.height,
            displayedMediaTime: sameClipHoldFrame.mediaTime,
            targetMediaTime: targetTime,
            previewPath: 'same-clip-hold',
          });
          continue;
        }
      }

      const runtimeProviderStable = this.isPendingWebCodecsFrameStable(runtimeProvider ?? undefined);
      const runtimeHasFrame =
        (runtimeProvider?.hasFrame?.() ?? false) ||
        !!runtimeProvider?.getCurrentFrame?.();
      const allowPendingScrubFrame = useTimelineStore.getState().isDraggingPlayhead;
      const shouldPreferRuntimeProvider =
        !!runtimeProvider?.isFullMode() &&
        runtimeProvider !== clipProvider &&
        runtimeProviderStable &&
        runtimeHasFrame;
      const frameProvider =
        shouldPreferRuntimeProvider
          ? runtimeProvider
          : clipProvider ?? (runtimeProvider?.isFullMode()
            ? runtimeProvider
            : null);
      const providerKey = this.getVideoProviderKey(layer, frameProvider, runtimeProvider);
      const runtimeProviderKey = runtimeProvider
        ? this.getVideoProviderKey(layer, runtimeProvider, runtimeProvider)
        : providerKey;
      const layerReuseKey = this.getLayerReuseKey(layer);
      const canReuseLastFrame = this.canReuseLastSuccessfulVideoFrame(layerReuseKey, providerKey);
      const frameProviderStable = this.isPendingWebCodecsFrameStable(frameProvider ?? undefined);
      const holdingFrame = !frameProviderStable && canReuseLastFrame;
      const allowRuntimeFrameReadDuringSettle =
        scrubSettleState.isPending(layer.sourceClipId) &&
        !!runtimeProvider?.isFullMode() &&
        runtimeProvider !== clipProvider;
      const canReadRuntimeFrame =
        !!layer.source.runtimeSourceId &&
        !!layer.source.runtimeSessionKey &&
        !!runtimeProvider?.isFullMode() &&
        (!frameProvider || frameProvider === runtimeProvider || allowRuntimeFrameReadDuringSettle) &&
        (
          runtimeProviderStable ||
          canReuseLastFrame ||
          allowPendingScrubFrame ||
          allowRuntimeFrameReadDuringSettle
        );
      const runtimeFrameRead = canReadRuntimeFrame
        ? readRuntimeFrameForSource(layer.source, 'background')
        : null;
      const runtimeFrame = runtimeFrameRead?.frameHandle?.frame;
      if (
        runtimeFrame &&
        'displayWidth' in runtimeFrame &&
        'displayHeight' in runtimeFrame
      ) {
        const targetMediaTime =
          layer.source?.mediaTime ??
          runtimeFrameRead?.binding.session.currentTime ??
          runtimeProvider?.getPendingSeekTime?.() ??
          runtimeProvider?.currentTime;
        const displayedMediaTime = this.getFrameTimestampSeconds(
          runtimeFrameRead?.frameHandle?.timestamp,
          targetMediaTime
        );
        const extTex = this.textureManager.importVideoTexture(runtimeFrame);
        if (extTex) {
          if (runtimeProviderKey) {
            this.lastSuccessfulVideoProviderKey.set(layerReuseKey, runtimeProviderKey);
          }
          this.setCollectorState(layerReuseKey, holdingFrame ? 'hold' : 'render', {
            reason: holdingFrame ? 'same_provider_pending' : 'runtime_frame',
          });
          result.push({
            layer, isVideo: true, externalTexture: extTex, textureView: null,
            sourceWidth: runtimeFrame.displayWidth, sourceHeight: runtimeFrame.displayHeight,
            displayedMediaTime, targetMediaTime, previewPath: 'webcodecs',
          });
          continue;
        }
      }

      // WebCodecs
      if (frameProvider?.isFullMode()) {
        if (!frameProviderStable && !canReuseLastFrame && !allowPendingScrubFrame) {
          this.setCollectorState(layerReuseKey, 'drop', {
            reason: 'pending_unstable',
          });
          continue;
        }
        const frame = frameProvider.getCurrentFrame();
        if (frame) {
          const targetMediaTime =
            layer.source?.mediaTime ??
            frameProvider.getPendingSeekTime?.() ??
            frameProvider.currentTime;
          const displayedMediaTime = this.getFrameTimestampSeconds(
            frame.timestamp,
            targetMediaTime
          );
          const extTex = this.textureManager.importVideoTexture(frame);
          if (extTex) {
            if (providerKey) {
              this.lastSuccessfulVideoProviderKey.set(layerReuseKey, providerKey);
            }
            this.setCollectorState(layerReuseKey, holdingFrame ? 'hold' : 'render', {
              reason: holdingFrame ? 'same_provider_pending' : 'provider_frame',
            });
            result.push({
              layer, isVideo: true, externalTexture: extTex, textureView: null,
              sourceWidth: frame.displayWidth, sourceHeight: frame.displayHeight,
              displayedMediaTime, targetMediaTime, previewPath: 'webcodecs',
            });
            continue;
          }
          this.setCollectorState(layerReuseKey, 'drop', {
            reason: 'import_failed',
          });
        } else {
          // WebCodecs has no frame yet - normal during decode startup
          this.setCollectorState(layerReuseKey, 'drop', {
            reason: 'no_frame',
          });
        }
      }

      // Image
      if (layer.source.imageElement) {
        const img = layer.source.imageElement;
        let texture = this.textureManager.getCachedImageTexture(img);
        if (!texture) texture = this.textureManager.createImageTexture(img) ?? undefined;
        if (texture) {
          result.push({
            layer, isVideo: false, externalTexture: null,
            textureView: this.textureManager.getImageView(texture),
            sourceWidth: img.naturalWidth, sourceHeight: img.naturalHeight,
          });
          continue;
        }
      }

      // Text
      if (layer.source.textCanvas) {
        const canvas = layer.source.textCanvas;
        const texture = this.textureManager.createCanvasTexture(canvas);
        if (texture) {
          result.push({
            layer, isVideo: false, externalTexture: null,
            textureView: this.textureManager.getImageView(texture),
            sourceWidth: canvas.width, sourceHeight: canvas.height,
          });
        }
      }
    }

    return result;
  }

  hasTexture(compositionId: string): boolean {
    return this.nestedCompTextures.has(compositionId);
  }

  getTexture(compositionId: string): NestedCompTexture | undefined {
    return this.nestedCompTextures.get(compositionId);
  }

  cleanupPendingTextures(): void {
    // No-op - textures are now managed by the pool
  }

  cleanupTexture(compositionId: string): void {
    const entry = this.nestedCompTextures.get(compositionId);
    if (entry) entry.texture.destroy();
    this.nestedCompTextures.delete(compositionId);
  }

  /**
   * Cache the current main render output for a composition
   */
  cacheActiveCompOutput(compositionId: string, sourceTexture: GPUTexture, width: number, height: number): void {
    let compTexture = this.nestedCompTextures.get(compositionId);
    if (!compTexture || compTexture.texture.width !== width || compTexture.texture.height !== height) {
      if (compTexture) compTexture.texture.destroy();

      const texture = this.device.createTexture({
        size: { width, height },
        format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      compTexture = { texture, view: texture.createView() };
      this.nestedCompTextures.set(compositionId, compTexture);
    }

    const commandEncoder = this.device.createCommandEncoder();
    commandEncoder.copyTextureToTexture(
      { texture: sourceTexture },
      { texture: compTexture.texture },
      { width, height }
    );
    this.device.queue.submit([commandEncoder.finish()]);
  }

  /**
   * Invalidate frame cache for a specific composition or all
   */
  invalidateCache(compositionId?: string): void {
    if (compositionId) {
      this.lastRenderTime.delete(compositionId);
      this.lastLayerCount.delete(compositionId);
    } else {
      this.lastRenderTime.clear();
      this.lastLayerCount.clear();
    }
  }

  destroy(): void {
    // Clear frame cache
    this.lastRenderTime.clear();
    this.lastLayerCount.clear();

    // Destroy nested comp textures
    for (const tex of this.nestedCompTextures.values()) {
      tex.texture.destroy();
    }
    this.nestedCompTextures.clear();

    // Destroy texture pool
    for (const pool of this.texturePool.values()) {
      for (const pair of pool) {
        pair.pingTexture.destroy();
        pair.pongTexture.destroy();
      }
    }
    this.texturePool.clear();
  }
}
