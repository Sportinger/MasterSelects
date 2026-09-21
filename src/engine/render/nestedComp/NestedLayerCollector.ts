import type { TimelineClip, TimelineTrack } from '../../../types';
import type { Layer, LayerRenderData } from '../../core/types';
import type { TextureManager } from '../../texture/TextureManager';
import type { ScrubbingCache } from '../../texture/ScrubbingCache';
import type { MotionRenderer } from '../../motion/MotionRenderer';
import {
  getMotionRenderSizeForAdmission,
  type MotionFrameRuntimeAdmission,
} from '../../motion/MotionFrameRuntime';
import { applyMotionRenderPlacement } from '../../motion/MotionTypes';
import { Logger } from '../../../services/logger';
import { getRuntimeFrameProvider, readRuntimeFrameForSource } from '../../../services/mediaRuntime/runtimePlayback';
import { scrubSettleState } from '../../../services/scrubSettleState';
import { wcPipelineMonitor } from '../../../services/wcPipelineMonitor';
import { isTimelinePlayheadDragging } from '../../../services/render/nestedCompRenderStoreAccess';
import { collectCanvasElementLayer } from '../layerCollector/staticSourceCollectors';
import { collectExportHtmlVideoFrame } from '../layerCollector/htmlVideoExportCollector';
import { tryCollectHtmlVideoPreview, type StableHtmlVideoCanvasFrame } from './htmlVideoPreview';
import { getFrameTimestampSeconds, isPendingWebCodecsFrameStable } from './videoProviderPolicy';

const log = Logger.create('NestedCompRenderer');

type RenderNestedComposition = (
  compositionId: string, layers: Layer[], width: number, height: number,
  encoder: GPUCommandEncoder, sampler: GPUSampler, currentTime?: number,
  sceneClips?: TimelineClip[], sceneTracks?: TimelineTrack[], depth?: number,
  skipEffects?: boolean, particleQuality?: 'preview' | 'export',
  motionFrameAdmission?: MotionFrameRuntimeAdmission, renderOccurrenceKey?: string,
  previewRenderScale?: number,
  frameRate?: number,
) => GPUTextureView | null;

function getNestedRenderOccurrenceKey(parentOccurrenceKey: string | undefined, layerId: string): string {
  return JSON.stringify([parentOccurrenceKey ?? null, layerId]);
}

/** Collects nested source textures and owns their video-provider continuity state. */
export class NestedLayerCollector {
  private providerIds = new WeakMap<object, number>();
  private nextProviderId = 1;
  private lastSuccessfulVideoProviderKey = new Map<string, string>();
  private lastCollectorState = new Map<string, 'render' | 'hold' | 'drop'>();
  private htmlHoldUntil = new Map<string, number>();
  private stableCanvasFrames = new Map<string, StableHtmlVideoCanvasFrame>();
  private readonly textureManager: TextureManager;
  private readonly scrubbingCache: ScrubbingCache | null;
  private readonly motionRenderer: MotionRenderer | null;
  private readonly preRender: RenderNestedComposition;

  constructor(
    textureManager: TextureManager,
    scrubbingCache: ScrubbingCache | null,
    motionRenderer: MotionRenderer | null,
    preRender: RenderNestedComposition,
  ) {
    this.textureManager = textureManager;
    this.scrubbingCache = scrubbingCache;
    this.motionRenderer = motionRenderer;
    this.preRender = preRender;
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

  collect(
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
          particleQuality,
          motionFrameAdmission,
          getNestedRenderOccurrenceKey(renderOccurrenceKey, layer.id),
          previewRenderScale,
          nc.frameRate ?? 30,
        );
        if (subTextureView) {
          result.push({
            layer,
            isVideo: false,
            externalTexture: null,
            textureView: subTextureView,
            sourceWidth: nc.width * previewRenderScale,
            sourceHeight: nc.height * previewRenderScale,
          });
        }
        continue;
      }

      if (layer.source.type === 'motion') {
        if (!motionFrameAdmission?.ok) {
          continue;
        }
        const rendered = commandEncoder && this.motionRenderer
          ? this.motionRenderer.renderLayer(layer, commandEncoder, motionFrameAdmission)
          : null;
        const size = rendered ?? getMotionRenderSizeForAdmission(layer, motionFrameAdmission);
        result.push({
          layer: applyMotionRenderPlacement(layer, size),
          isVideo: false,
          externalTexture: null,
          textureView: rendered?.textureView ?? null,
          sourceWidth: size.width,
          sourceHeight: size.height,
        });
        continue;
      }

      if (layer.source.type === 'motion-adjustment') {
        result.push({
          layer,
          isVideo: false,
          externalTexture: null,
          textureView: null,
          sourceWidth: layer.source.intrinsicWidth ?? 0,
          sourceHeight: layer.source.intrinsicHeight ?? 0,
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
      if (layer.source.canvasElement) {
        const canvasLayer = collectCanvasElementLayer(
          layer,
          layer.source.canvasElement,
          this.textureManager,
        );
        if (canvasLayer) {
          result.push(canvasLayer);
          continue;
        }
      }

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

      // Export videos have already been sought by the export session. They do
      // not have preview presented-owner metadata, and must never use a scrub
      // cache or a previous split's hold frame while waiting for GPU import.
      if (particleQuality === 'export' && layer.source.videoElement) {
        const video = layer.source.videoElement;
        if (video.readyState >= 2 && !video.seeking) {
          const exportFrame = collectExportHtmlVideoFrame(
            layer, video, this.textureManager, this.scrubbingCache, true,
          );
          if (exportFrame) result.push(exportFrame);
        }
        continue;
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
        stableCanvasFrames: this.stableCanvasFrames,
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
      const allowPendingScrubFrame = isTimelinePlayheadDragging();
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

  destroy(): void {
    for (const frame of this.stableCanvasFrames.values()) {
      this.textureManager.removeCanvasTexture(frame.canvas);
    }
    this.stableCanvasFrames.clear();
  }
}
