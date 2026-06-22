import type { Layer, LayerRenderData } from '../../core/types';
import { flags } from '../../featureFlags';
import { hasParticleRenderEffect, splitLayerEffects } from '../layerEffectStack';
import {
  getRuntimeFrameProvider,
  readRuntimeFrameForSource,
} from '../../../services/mediaRuntime/runtimePlayback';
import { scrubSettleState } from '../../../services/scrubSettleState';
import { wcPipelineMonitor } from '../../../services/wcPipelineMonitor';
import { useTimelineStore } from '../../../stores/timeline';
import type { LayerCollectorDeps } from '../LayerCollector';
import {
  ENABLE_VISUAL_HTML_VIDEO_FALLBACK,
  SCRUB_GRACE_MS,
} from './constants';
import {
  getFrameTimestampSeconds,
  getLayerReuseKey,
  isAcceptableWebCodecsFrame,
  isPendingWebCodecsFrameStable,
  isPlaybackStartupWarmupActive,
  isSeverelyStaleForCurrentTarget,
  type WebCodecsFrameProvider,
} from './collectionPredicates';
import type { CollectorState, LayerCollectorMutationSink } from './collectorStatus';
import type { HtmlVideoCollector } from './htmlVideoCollector';
import {
  collectProviderFrame,
  type WebCodecsProviderFrameContext,
} from './webCodecsProviderFrameCollector';

export class WebCodecsLayerCollector {
  private providerIds = new WeakMap<object, number>();
  private nextProviderId = 1;
  private lastSuccessfulVideoProviderKey = new Map<string, string>();
  private lastCollectorState = new Map<string, CollectorState>();
  private scrubGraceUntil = 0;
  private readonly status: LayerCollectorMutationSink;
  private readonly htmlVideoCollector: HtmlVideoCollector;
  private readonly providerFrameContext: WebCodecsProviderFrameContext;

  constructor(
    status: LayerCollectorMutationSink,
    htmlVideoCollector: HtmlVideoCollector
  ) {
    this.status = status;
    this.htmlVideoCollector = htmlVideoCollector;
    this.providerFrameContext = {
      status,
      setCollectorState: (layerId, state, detail) => {
        this.setCollectorState(layerId, state, detail);
      },
      setLastSuccessfulVideoProviderKey: (layerReuseKey, providerKey) => {
        this.lastSuccessfulVideoProviderKey.set(layerReuseKey, providerKey);
      },
      tryPlaybackHtmlVideoFallback: (layer, video, deps, layerReuseKey, reason) =>
        this.tryPlaybackHtmlVideoFallback(layer, video, deps, layerReuseKey, reason),
    };
  }

  collect(layer: Layer, deps: LayerCollectorDeps): LayerRenderData | null {
    const source = layer.source;
    if (!source || source.type !== 'video') {
      return null;
    }

    const isDragging = useTimelineStore.getState().isDraggingPlayhead;
    const runtimeProvider = getRuntimeFrameProvider(source);
    const clipProvider = source.webCodecsPlayer?.isFullMode()
      ? source.webCodecsPlayer
      : null;
    const htmlPreviewDebugDisabled =
      flags.useFullWebCodecsPlayback &&
      flags.disableHtmlPreviewFallback;
    const hasForcedRuntimeFramePreview =
      source.forceRuntimeFramePreview === true &&
      !!runtimeProvider?.isFullMode();
    const hasFullWebCodecsPreview =
      hasForcedRuntimeFramePreview ||
      (
        flags.useFullWebCodecsPlayback &&
        (!!clipProvider || !!runtimeProvider?.isFullMode())
      );
    const allowHtmlRenderEffectStill =
      !!source.videoElement &&
      !deps.isPlaying &&
      !deps.isExporting &&
      !isDragging &&
      hasParticleRenderEffect(splitLayerEffects(layer.effects));

    if (isDragging) {
      this.scrubGraceUntil = performance.now() + SCRUB_GRACE_MS;
    }
    const inScrubGrace = !isDragging && performance.now() < this.scrubGraceUntil;
    const isSettling = scrubSettleState.isPending(layer.sourceClipId);
    const allowHtmlScrubPreview =
      !htmlPreviewDebugDisabled &&
      !hasFullWebCodecsPreview &&
      !deps.isPlaying &&
      (isDragging || inScrubGrace || isSettling) &&
      !!source.videoElement;
    const allowHtmlVideoPreview =
      !!source.videoElement &&
      !htmlPreviewDebugDisabled &&
      !hasForcedRuntimeFramePreview &&
      (!hasFullWebCodecsPreview ||
        ENABLE_VISUAL_HTML_VIDEO_FALLBACK ||
        allowHtmlScrubPreview);

    if (allowHtmlVideoPreview || allowHtmlRenderEffectStill) {
      const htmlFrame = this.htmlVideoCollector.collect(layer, source.videoElement!, deps);
      if (htmlFrame || !allowHtmlRenderEffectStill) {
        return htmlFrame;
      }
    }

    const layerReuseKey = getLayerReuseKey(layer);
    const runtimeProviderStable = isPendingWebCodecsFrameStable(runtimeProvider ?? undefined);
    const runtimeHasFrame =
      (runtimeProvider?.hasFrame?.() ?? false) ||
      !!runtimeProvider?.getCurrentFrame?.();
    const allowPendingScrubFrame =
      !deps.isPlaying &&
      useTimelineStore.getState().isDraggingPlayhead;
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
    const canReuseLastFrame = this.canReuseLastSuccessfulVideoFrame(layerReuseKey, providerKey);
    const frameProviderStable = isPendingWebCodecsFrameStable(frameProvider ?? undefined);
    const holdingFrame = !frameProviderStable && canReuseLastFrame;
    const allowRuntimeFrameReadDuringSettle =
      scrubSettleState.isPending(layer.sourceClipId) &&
      !!runtimeProvider?.isFullMode() &&
      runtimeProvider !== clipProvider;

    const canReadRuntimeFrame =
      !!source.runtimeSourceId &&
      !!source.runtimeSessionKey &&
      !!runtimeProvider?.isFullMode() &&
      (!frameProvider || frameProvider === runtimeProvider || allowRuntimeFrameReadDuringSettle) &&
      (
        runtimeProviderStable ||
        canReuseLastFrame ||
        allowPendingScrubFrame ||
        allowRuntimeFrameReadDuringSettle
      );

    const runtimeFrameRead = canReadRuntimeFrame
      ? readRuntimeFrameForSource(source)
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
      const frameAcceptable = isAcceptableWebCodecsFrame(
        displayedMediaTime,
        targetMediaTime,
        runtimeProvider ?? frameProvider,
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
            (deps.isPlaying && isPlaybackStartupWarmupActive(runtimeProvider ?? frameProvider)) ||
            severelyStaleForCurrentTarget
          )
        );
      if (
        !allowPendingScrubFrame &&
        !effectiveHoldingFrame &&
        !allowRuntimeFrameReadDuringSettle &&
        !frameAcceptable
      ) {
        const fallback = this.tryPlaybackHtmlVideoFallback(
          layer,
          source.videoElement,
          deps,
          layerReuseKey,
          'stale_runtime_frame'
        );
        if (fallback) return fallback;
        this.setCollectorState(layerReuseKey, 'drop', {
          reason: 'stale_runtime_frame',
        });
        return null;
      }
      const extTex = deps.textureManager.importVideoTexture(runtimeFrame);
      if (extTex) {
        wcPipelineMonitor.record('frame_read', {
          frameTs: runtimeFrame.timestamp,
        });
        if (runtimeProviderKey) {
          this.lastSuccessfulVideoProviderKey.set(layerReuseKey, runtimeProviderKey);
        }
        this.setCollectorState(layerReuseKey, effectiveHoldingFrame ? 'hold' : 'render', {
          reason: effectiveHoldingFrame ? 'same_provider_pending' : 'runtime_frame',
        });
        this.status.setDecoder('WebCodecs');
        this.status.setWebCodecsInfo(frameProvider?.getDebugInfo?.() ?? undefined);
        this.status.markHasVideo();
        return {
          layer,
          isVideo: true,
          externalTexture: extTex,
          textureView: null,
          sourceWidth: runtimeFrame.displayWidth,
          sourceHeight: runtimeFrame.displayHeight,
          displayedMediaTime,
          targetMediaTime,
          previewPath: 'webcodecs',
        };
      }
    }

    if (frameProvider && typeof frameProvider.getCurrentFrame === 'function') {
      const providerFrame = collectProviderFrame({
        layer,
        deps,
        clipProvider,
        frameProvider,
        providerKey,
        sourceVideo: source.videoElement,
        layerReuseKey,
        canReuseLastFrame,
        frameProviderStable,
        holdingFrame,
        allowPendingScrubFrame,
        isDragging,
        context: this.providerFrameContext,
      });
      if (providerFrame !== undefined) {
        return providerFrame;
      }
    }

    const playbackFallback = this.tryPlaybackHtmlVideoFallback(
      layer,
      source.videoElement,
      deps,
      layerReuseKey,
      'no_provider_frame'
    );
    return playbackFallback ?? null;
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
    frameProvider: WebCodecsFrameProvider | null,
    runtimeProvider: WebCodecsFrameProvider | null
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

  private canReuseLastSuccessfulVideoFrame(layerId: string, providerKey: string | null): boolean {
    return !!providerKey && this.lastSuccessfulVideoProviderKey.get(layerId) === providerKey;
  }

  private setCollectorState(
    layerId: string,
    state: CollectorState,
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

  private tryPlaybackHtmlVideoFallback(
    layer: Layer,
    video: HTMLVideoElement | null | undefined,
    deps: LayerCollectorDeps,
    layerReuseKey: string,
    reason: string
  ): LayerRenderData | null {
    if (
      !deps.isPlaying ||
      deps.isExporting ||
      !video ||
      video.readyState < 2 ||
      video.seeking ||
      useTimelineStore.getState().isDraggingPlayhead
    ) {
      return null;
    }

    const fallback = this.htmlVideoCollector.collect(layer, video, deps, {
      playbackFallback: true,
    });
    if (!fallback) {
      return null;
    }

    const previewPath = fallback.previewPath === 'live-import'
      ? 'playback-html-fallback'
      : fallback.previewPath;
    const state = previewPath?.includes('cache') || previewPath?.includes('hold')
      ? 'hold'
      : 'render';

    this.setCollectorState(layerReuseKey, state, {
      reason: `html_fallback_${reason}`,
    });

    return {
      ...fallback,
      previewPath,
    };
  }
}
