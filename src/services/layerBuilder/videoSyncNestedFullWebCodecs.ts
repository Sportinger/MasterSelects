import type { TimelineClip } from '../../types/timeline';
import {
  ensureRuntimeFrameProvider,
  getPreviewRuntimeSource,
  getRuntimeFrameProvider,
  getScrubRuntimeSource,
  updateRuntimePlaybackTime,
} from '../mediaRuntime/runtimePlayback';
import { scrubSettleState } from '../scrubSettleState';
import type { NestedClipSourceTiming } from './layerBuilderNestedLayers';
import { syncTransitionSourceHold } from './videoSyncTransitionSourceHold';
import type { FrameContext } from './types';
import type { VideoSyncNestedCompositionCoordinatorDeps } from './videoSyncNestedCompositionCoordinator';
import type { RuntimeFrameProvider } from '../mediaRuntime/types';

export function syncNestedFullWebCodecs(input: {
  nestedClip: TimelineClip;
  ctx: FrameContext;
  video: HTMLVideoElement;
  clipRuntimeProvider: RuntimeFrameProvider;
  nestedClipTime: number;
  timeDiff: number;
  isInteractivePreview: boolean;
  timing: NestedClipSourceTiming;
  deps: VideoSyncNestedCompositionCoordinatorDeps;
}): void {
  const {
    nestedClip,
    ctx,
    video,
    clipRuntimeProvider,
    nestedClipTime,
    timeDiff,
    isInteractivePreview,
    timing,
    deps,
  } = input;
  const playbackRuntimeSource = getPreviewRuntimeSource(nestedClip.source, nestedClip.trackId, false);
  const scrubRuntimeSource = getScrubRuntimeSource(nestedClip.source, nestedClip.trackId, false);
  if (timing.isHold) {
    syncTransitionSourceHold({
      clip: nestedClip,
      video,
      clipRuntimeProvider,
      isInteractivePreview,
      playbackRuntimeSource,
      scrubRuntimeSource,
      clipTime: nestedClipTime,
      syncPausedWebCodecsProvider: (...args) => deps.syncPausedWebCodecsProvider(...args),
    });
    return;
  }

  const isReversePlayback =
    ctx.playbackSpeed < 0 || nestedClip.reversed || timing.sourceRate < 0;
  const effectiveAbsRate = Math.abs(timing.sourceRate) *
    (ctx.isPlaying ? Math.max(0.01, Math.abs(ctx.playbackSpeed || 1)) : 1);
  if (effectiveAbsRate > 0.01 && Math.abs(video.playbackRate - effectiveAbsRate) > 0.01) {
    video.playbackRate = Math.min(16, Math.max(0.0625, effectiveAbsRate));
  }

  if (ctx.isPlaying) {
    scrubSettleState.resolve(nestedClip.id);
    if (isReversePlayback) {
      const advanceReverse =
        clipRuntimeProvider.advanceReverseToTime ??
        clipRuntimeProvider.scrubSeek ??
        clipRuntimeProvider.seek;
      advanceReverse?.call(clipRuntimeProvider, nestedClipTime);
      if (!video.paused) video.pause();
      if (timeDiff > 0.3) {
        video.currentTime = deps.safeSeekTime(video, nestedClipTime);
      }
      return;
    }

    clipRuntimeProvider.advanceToTime?.(nestedClipTime);

    const playbackReadyForAudio = deps.isPlaybackProviderReadyForAudioStart(
      clipRuntimeProvider,
      nestedClipTime
    );
    if (video.paused && playbackReadyForAudio) {
      const startupAudioDrift = Math.abs(video.currentTime - nestedClipTime);
      if (startupAudioDrift > 0.05) {
        video.currentTime = deps.safeSeekTime(video, nestedClipTime);
      }
      video.play().catch(() => {});
    }
    if (
      deps.shouldCorrectPlaybackAudioDrift(video, playbackReadyForAudio, false) &&
      timeDiff > 0.3
    ) {
      video.currentTime = deps.safeSeekTime(video, nestedClipTime);
    }
    return;
  }

  if (!video.paused) video.pause();
  if (isInteractivePreview) {
    scrubSettleState.resolve(nestedClip.id);
  }

  const pausedScrubRuntimeSource = getScrubRuntimeSource(
    nestedClip.source,
    nestedClip.trackId,
    true
  );
  updateRuntimePlaybackTime(pausedScrubRuntimeSource, nestedClipTime);
  if (isInteractivePreview) {
    void ensureRuntimeFrameProvider(pausedScrubRuntimeSource, 'interactive', nestedClipTime);
  }

  const scrubProvider = getRuntimeFrameProvider(pausedScrubRuntimeSource);
  const pausedProvider = deps.getPausedWebCodecsProvider(
    clipRuntimeProvider,
    scrubProvider,
    nestedClipTime,
    { preferFreshRuntime: isInteractivePreview }
  ) ?? clipRuntimeProvider;

  if (pausedProvider?.isFullMode()) {
    deps.syncPausedWebCodecsProvider(
      pausedProvider,
      `${nestedClip.id}:nested`,
      nestedClipTime,
      isInteractivePreview,
      true,
      true
    );
  }

  if (!isInteractivePreview && timeDiff > 0.05) {
    video.currentTime = deps.safeSeekTime(video, nestedClipTime);
  }
}
