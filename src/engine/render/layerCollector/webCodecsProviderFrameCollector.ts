import { providerFramePresentation } from './providerFramePresentation';
import type { Layer, LayerRenderData } from '../../core/types';
import { scrubSettleState } from '../../../services/scrubSettleState';
import { wcPipelineMonitor } from '../../../services/wcPipelineMonitor';
import type { LayerCollectorDeps } from '../LayerCollector';
import {
  getFrameTimestampSeconds,
  isAcceptableWebCodecsFrame,
  isPlaybackStartupWarmupActive,
  isSeverelyStaleForCurrentTarget,
  type WebCodecsFrameProvider,
} from './collectionPredicates';
import type { CollectorState, LayerCollectorMutationSink } from './collectorStatus';

export interface WebCodecsProviderFrameContext {
  status: LayerCollectorMutationSink;
  setCollectorState(
    layerId: string,
    state: CollectorState,
    detail?: Record<string, number | string>
  ): void;
  setLastSuccessfulVideoProviderKey(layerReuseKey: string, providerKey: string): void;
  tryPlaybackHtmlVideoFallback(
    layer: Layer,
    video: HTMLVideoElement | null | undefined,
    deps: LayerCollectorDeps,
    layerReuseKey: string,
    reason: string
  ): LayerRenderData | null;
}

export function collectProviderFrame(options: {
  layer: Layer;
  deps: LayerCollectorDeps;
  clipProvider: WebCodecsFrameProvider | null;
  frameProvider: WebCodecsFrameProvider;
  providerKey: string | null;
  sourceVideo: HTMLVideoElement | null | undefined;
  layerReuseKey: string;
  canReuseLastFrame: boolean;
  frameProviderStable: boolean;
  holdingFrame: boolean;
  allowPendingScrubFrame: boolean;
  isDragging: boolean;
  context: WebCodecsProviderFrameContext;
}): LayerRenderData | null | undefined {
  const {
    layer,
    deps,
    clipProvider,
    frameProvider,
    providerKey,
    sourceVideo,
    layerReuseKey,
    canReuseLastFrame,
    frameProviderStable,
    holdingFrame,
    allowPendingScrubFrame,
    isDragging,
    context,
  } = options;

  if (!frameProviderStable && !canReuseLastFrame && !allowPendingScrubFrame) {
    const fallback = context.tryPlaybackHtmlVideoFallback(
      layer,
      sourceVideo,
      deps,
      layerReuseKey,
      'pending_unstable'
    );
    if (fallback) return fallback;
    context.setCollectorState(layerReuseKey, 'drop', {
      reason: 'pending_unstable',
    });
    return null;
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
    const frameAcceptable = isAcceptableWebCodecsFrame(
      displayedMediaTime,
      targetMediaTime,
      frameProvider,
      { isPlaying: deps.isPlaying, isDragging }
    );
    const severelyStaleForCurrentTarget = isSeverelyStaleForCurrentTarget(
      displayedMediaTime,
      targetMediaTime,
      isDragging
    );
    const effectiveHoldingFrame =
      holdingFrame &&
      !(
        !isDragging &&
        !frameAcceptable &&
        (
          (deps.isPlaying && isPlaybackStartupWarmupActive(frameProvider)) ||
          severelyStaleForCurrentTarget
        )
      );
    if (
      !allowPendingScrubFrame &&
      !effectiveHoldingFrame &&
      !frameAcceptable
    ) {
      const fallback = context.tryPlaybackHtmlVideoFallback(
        layer,
        sourceVideo,
        deps,
        layerReuseKey,
        'stale_provider_frame'
      );
      if (fallback) return fallback;
      context.setCollectorState(layerReuseKey, 'drop', {
        reason: 'stale_provider_frame',
      });
      return null;
    }
    const extTex = deps.textureManager.importVideoTexture(frame);
    if (extTex) {
      wcPipelineMonitor.record('frame_read', {
        frameTs: frame.timestamp,
      });
      if (providerKey) {
        context.setLastSuccessfulVideoProviderKey(layerReuseKey, providerKey);
      }
      context.setCollectorState(layerReuseKey, effectiveHoldingFrame ? 'hold' : 'render', {
        reason: effectiveHoldingFrame ? 'same_provider_pending' : 'provider_frame',
      });
      context.status.setDecoder('WebCodecs');
      context.status.setWebCodecsInfo(frameProvider.getDebugInfo?.() ?? undefined);
      context.status.markHasVideo();
      return {
        ...providerFramePresentation(layer, frame, frameProvider),
        isVideo: true,
        externalTexture: extTex,
        textureView: null,
        displayedMediaTime,
        targetMediaTime,
        previewPath: 'webcodecs',
      };
    }
    const fallback = context.tryPlaybackHtmlVideoFallback(
      layer,
      sourceVideo,
      deps,
      layerReuseKey,
      'import_failed'
    );
    if (fallback) return fallback;
    context.setCollectorState(layerReuseKey, 'drop', {
      reason: 'import_failed',
    });
    return undefined;
  }

  if (
    clipProvider &&
    clipProvider !== frameProvider &&
    deps.isPlaying &&
    scrubSettleState.isPending(layer.sourceClipId)
  ) {
    const bridgeFrame = clipProvider.getCurrentFrame?.();
    if (bridgeFrame) {
      const extTex = deps.textureManager.importVideoTexture(bridgeFrame);
      if (extTex) {
        context.setCollectorState(layerReuseKey, 'hold', {
          reason: 'scrub_bridge_frame',
        });
        context.status.setDecoder('WebCodecs');
        context.status.markHasVideo();
        return {
          ...providerFramePresentation(layer, bridgeFrame, clipProvider),
          isVideo: true,
          externalTexture: extTex,
          textureView: null,
          displayedMediaTime: getFrameTimestampSeconds(bridgeFrame.timestamp, layer.source?.mediaTime),
          targetMediaTime: layer.source?.mediaTime,
          previewPath: 'webcodecs',
        };
      }
    }
    return undefined;
  }

  const fallback = context.tryPlaybackHtmlVideoFallback(
    layer,
    sourceVideo,
    deps,
    layerReuseKey,
    'no_frame'
  );
  if (fallback) return fallback;
  context.setCollectorState(layerReuseKey, 'drop', {
    reason: 'no_frame',
  });
  return undefined;
}
