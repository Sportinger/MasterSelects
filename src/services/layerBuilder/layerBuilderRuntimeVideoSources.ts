import type { LayerSource } from '../../types/layers';
import type { TimelineClip } from '../../types/timeline';
import { flags } from '../../engine/featureFlags';
import {
  getPreviewRuntimeSource,
  getRuntimeFrameProvider,
  getScrubRuntimeSource,
} from '../mediaRuntime/runtimePlayback';
import type { RuntimeFrameProvider } from '../mediaRuntime/types';
import { scrubSettleState } from '../scrubSettleState';
import type { FrameContext } from './types';
import { getReverseWorkerRuntimeSource } from './reverseWorkerWebCodecsRuntime';

export interface RuntimeLayerBuilderVideoSourceResolution {
  source: LayerSource;
  intrinsicSize?: {
    width?: number;
    height?: number;
  };
}

function shouldPresentReverseRuntimeProvider(input: {
  readonly provider: RuntimeFrameProvider | null | undefined;
  readonly hasFrame: boolean;
}): boolean {
  if (!input.provider?.isFullMode?.()) {
    return false;
  }
  return input.hasFrame;
}

export function resolveRuntimeLayerBuilderVideoSource(params: {
  readonly clip: TimelineClip;
  readonly ctx: FrameContext;
  readonly targetTime: number;
  readonly allowSharedPreviewSession: boolean;
  readonly continuationVideo?: HTMLVideoElement | null;
  readonly getVideoElement: (clip: TimelineClip) => HTMLVideoElement | null;
  readonly selectPausedVisualProvider: (
    source: TimelineClip['source'],
    runtimeProvider: RuntimeFrameProvider | null,
    targetTime: number,
    options?: { preferFreshRuntime?: boolean },
  ) => RuntimeFrameProvider | undefined;
}): RuntimeLayerBuilderVideoSourceResolution | null {
  const { clip, ctx, targetTime } = params;
  const htmlVideoElement = params.continuationVideo ?? params.getVideoElement(clip) ?? undefined;
  const isInteractivePreview = ctx.isDraggingPlayhead || ctx.hasClipDragPreview;
  const keepScrubRuntimeActive = isInteractivePreview || scrubSettleState.isPending(clip.id);
  const reverseWorkerRuntimeSource = getReverseWorkerRuntimeSource(clip, ctx);
  const baseRuntimeSource = reverseWorkerRuntimeSource ?? clip.source;
  const allowSharedRuntimeSession = reverseWorkerRuntimeSource ? false : params.allowSharedPreviewSession;
  const runtimeSource = keepScrubRuntimeActive
    ? getScrubRuntimeSource(baseRuntimeSource, clip.trackId, allowSharedRuntimeSession)
    : getPreviewRuntimeSource(baseRuntimeSource, clip.trackId, allowSharedRuntimeSession);
  const runtimeProvider = getRuntimeFrameProvider(runtimeSource);
  const reversePresentationProvider =
    runtimeProvider ?? runtimeSource?.webCodecsPlayer ?? clip.source?.webCodecsPlayer;
  const runtimeProviderHasFrame =
    reversePresentationProvider?.hasFrame?.() === true ||
    Boolean(reversePresentationProvider?.getCurrentFrame());
  const forceTurboResRuntimeFrame =
    !!reversePresentationProvider &&
    'backend' in reversePresentationProvider &&
    (reversePresentationProvider.backend === 'turbores'
      || reversePresentationProvider.backend === 'hap') &&
    reversePresentationProvider.isFullMode();
  const presentReverseRuntimeFrame = reverseWorkerRuntimeSource
    ? shouldPresentReverseRuntimeProvider({
        provider: reversePresentationProvider,
        hasFrame: runtimeProviderHasFrame,
      })
    : true;

  const preferHtmlScrubPreview =
    !flags.disableHtmlPreviewFallback &&
    isInteractivePreview &&
    !!htmlVideoElement &&
    !forceTurboResRuntimeFrame &&
    (!flags.useFullWebCodecsPlayback || !clip.source?.webCodecsPlayer?.isFullMode?.());
  const playingVisualProvider =
    runtimeProvider?.isFullMode()
      ? runtimeProvider
      : runtimeSource?.webCodecsPlayer ?? clip.source?.webCodecsPlayer;
  const visualProvider = ctx.isPlaying
    ? playingVisualProvider
    : preferHtmlScrubPreview
      ? undefined
      : params.selectPausedVisualProvider(clip.source, runtimeProvider, targetTime, {
          preferFreshRuntime: keepScrubRuntimeActive,
        });
  const presentedVisualProvider = reverseWorkerRuntimeSource && !presentReverseRuntimeFrame
    ? undefined
    : visualProvider;
  const presentedRuntimeSourceId = reverseWorkerRuntimeSource && !presentReverseRuntimeFrame
    ? undefined
    : runtimeSource?.runtimeSourceId;
  const presentedRuntimeSessionKey = reverseWorkerRuntimeSource && !presentReverseRuntimeFrame
    ? undefined
    : runtimeSource?.runtimeSessionKey;

  if (!htmlVideoElement && !presentedVisualProvider) {
    return null;
  }

  return {
    source: {
      type: 'video',
      videoElement: htmlVideoElement,
      mediaTime: targetTime,
      webCodecsPlayer: presentedVisualProvider,
      runtimeSourceId: preferHtmlScrubPreview ? undefined : presentedRuntimeSourceId,
      runtimeSessionKey: preferHtmlScrubPreview ? undefined : presentedRuntimeSessionKey,
      ...(forceTurboResRuntimeFrame || (
        reverseWorkerRuntimeSource &&
        presentReverseRuntimeFrame &&
        !preferHtmlScrubPreview &&
        runtimeProviderHasFrame
      )
        ? { forceRuntimeFramePreview: true }
        : {}),
    },
    intrinsicSize: {
      width: htmlVideoElement?.videoWidth,
      height: htmlVideoElement?.videoHeight,
    },
  };
}
