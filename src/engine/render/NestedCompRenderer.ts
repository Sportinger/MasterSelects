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
  getRuntimeFrameProvider,
  readRuntimeFrameForSource,
} from '../../services/mediaRuntime/runtimePlayback';
import { scrubSettleState } from '../../services/scrubSettleState';
import { wcPipelineMonitor } from '../../services/wcPipelineMonitor';
import { useTimelineStore } from '../../stores/timeline';
import type { MotionRenderer } from '../motion/MotionRenderer';
import { getMotionRenderSize } from '../motion/MotionTypes';
import { compositeNestedLayers } from './nestedComp/compositeNestedLayers';
import { tryCollectHtmlVideoPreview } from './nestedComp/htmlVideoPreview';
import { process3DLayersForNestedScene } from './nestedComp/sharedScene';
import {
  getFrameTimestampSeconds,
  isPendingWebCodecsFrameStable,
} from './nestedComp/videoProviderPolicy';

const log = Logger.create('NestedCompRenderer');

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
  private device: GPUDevice;
  private compositorPipeline: CompositorPipeline;
  private effectsPipeline: EffectsPipeline;
  private colorPipeline: ColorPipeline | null;
  private textureManager: TextureManager;
  private maskTextureManager: MaskTextureManager;
  private scrubbingCache: ScrubbingCache | null;
  private motionRenderer: MotionRenderer | null;
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
    scrubbingCache: ScrubbingCache | null = null,
    colorPipeline: ColorPipeline | null = null,
    motionRenderer: MotionRenderer | null = null
  ) {
    this.device = device;
    this.compositorPipeline = compositorPipeline;
    this.effectsPipeline = effectsPipeline;
    this.textureManager = textureManager;
    this.maskTextureManager = maskTextureManager;
    this.scrubbingCache = scrubbingCache;
    this.colorPipeline = colorPipeline;
    this.motionRenderer = motionRenderer;
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
    sceneClips?: TimelineClip[],
    sceneTracks?: TimelineTrack[],
    depth: number = 0,
    skipEffects = false,
    particleQuality: 'preview' | 'export' = 'preview'
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
      const nestedLayerData = this.collectNestedLayerData(
        nestedLayers,
        commandEncoder,
        sampler,
        depth,
        skipEffects,
        particleQuality,
      );

      // Process 3D layers through the shared scene renderer.
      if (flags.use3DLayers) {
        this.process3DLayersForNested(
          nestedLayerData,
          width,
          height,
          currentTime,
          compositionId,
          sceneClips,
          sceneTracks,
        );
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

      const sourceTexture = compositeNestedLayers({
        layerData: nestedLayerData,
        device: this.device,
        compositionId,
        width,
        height,
        commandEncoder,
        sampler,
        compositorPipeline: this.compositorPipeline,
        effectsPipeline: this.effectsPipeline,
        colorPipeline: this.colorPipeline,
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
      });
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
    });
  }

  private collectNestedLayerData(
    layers: Layer[],
    commandEncoder?: GPUCommandEncoder,
    sampler?: GPUSampler,
    depth: number = 0,
    skipEffects = false,
    particleQuality: 'preview' | 'export' = 'preview'
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
          nc.sceneClips,
          nc.sceneTracks,
          depth + 1,
          skipEffects,
          particleQuality
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

      if (layer.source.type === 'motion') {
        const rendered = commandEncoder && this.motionRenderer
          ? this.motionRenderer.renderLayer(layer, commandEncoder)
          : null;
        const size = rendered ?? getMotionRenderSize(layer.source.motion);
        result.push({
          layer,
          isVideo: false,
          externalTexture: null,
          textureView: rendered?.textureView ?? null,
          sourceWidth: size.width,
          sourceHeight: size.height,
        });
        continue;
      }

      // Shared-scene native 3D layers do not contribute a 2D source texture of their own.
      if (layer.source.type === 'model' || layer.source.type === 'gaussian-splat') {
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
      const htmlVideoPreview = tryCollectHtmlVideoPreview({
        layer,
        runtimeProvider,
        clipProvider,
        textureManager: this.textureManager,
        scrubbingCache: this.scrubbingCache,
        htmlHoldUntil: this.htmlHoldUntil,
        debug: (message, context) => log.debug(message, context),
        warn: (message, context) => log.warn(message, context),
      });
      if (htmlVideoPreview !== undefined) {
        if (htmlVideoPreview) {
          result.push(htmlVideoPreview);
        }
        continue;
      }

      const runtimeProviderStable = isPendingWebCodecsFrameStable(runtimeProvider ?? undefined);
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
      const frameProviderStable = isPendingWebCodecsFrameStable(frameProvider ?? undefined);
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
        const displayedMediaTime = getFrameTimestampSeconds(
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
          const displayedMediaTime = getFrameTimestampSeconds(
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
            isDynamic: layer.source?.proxyFrameIndex !== undefined,
            textureView: this.textureManager.getImageView(texture),
            sourceWidth: img.naturalWidth, sourceHeight: img.naturalHeight,
            displayedMediaTime: layer.source?.mediaTime,
            targetMediaTime: layer.source?.targetMediaTime ?? layer.source?.mediaTime,
            previewPath: layer.source?.previewPath,
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
