import type { TimelineClip } from '../../types';
import { flags } from '../../engine/featureFlags';
import { renderHostPort } from '../render/renderHostPort';
import { MAX_NESTING_DEPTH } from '../../stores/timeline/constants';
import {
  ensureRuntimeFrameProvider,
  getRuntimeFrameProvider,
  getScrubRuntimeSource,
  updateRuntimePlaybackTime,
} from '../mediaRuntime/runtimePlayback';
import type { RuntimeFrameProvider } from '../mediaRuntime/types';
import { scrubSettleState } from '../scrubSettleState';
import { resolveTransitionSourceMapTime } from '../timeline/transitionSourceMap';
import { getNestedClipSourceTiming } from './layerBuilderNestedLayers';
import type { FrameContext } from './types';
import { syncNestedFullWebCodecs } from './videoSyncNestedFullWebCodecs';

export type VideoSyncNestedCompositionCoordinatorDeps = {
  getClipHtmlVideoElement: (clip: TimelineClip) => HTMLVideoElement | null;
  getClipRuntimeProvider: (clip: TimelineClip) => RuntimeFrameProvider | null | undefined;
  isPlaybackProviderReadyForAudioStart: (
    provider: RuntimeFrameProvider | null | undefined,
    targetTime: number
  ) => boolean;
  shouldCorrectPlaybackAudioDrift: (
    audioElement: HTMLVideoElement | null | undefined,
    playbackReadyForAudio: boolean,
    holdScrubRelease: boolean
  ) => boolean;
  getPausedWebCodecsProvider: (
    clipProvider: RuntimeFrameProvider | null | undefined,
    runtimeProvider: ReturnType<typeof getRuntimeFrameProvider>,
    targetTime: number,
    options?: { preferFreshRuntime?: boolean }
  ) => RuntimeFrameProvider | null;
  syncPausedWebCodecsProvider: (
    provider: RuntimeFrameProvider | null | undefined,
    providerKey: string,
    targetTime: number,
    isDragging: boolean,
    schedulePreciseSeek?: boolean,
    allowSequentialDuringDrag?: boolean
  ) => void;
  shouldSeekPausedWebCodecsProvider: (
    provider: RuntimeFrameProvider | null | undefined,
    targetTime: number,
    providerKey?: string
  ) => boolean;
  forceVideoFrameDecode: (clipId: string, video: HTMLVideoElement) => void;
  isForceDecodeInProgress: (clipId: string) => boolean;
  throttledSeek: (clipId: string, video: HTMLVideoElement, time: number, ctx: FrameContext) => void;
  maybeRecoverScrubSettle: (clipId: string, video: HTMLVideoElement, targetTime: number) => void;
  beginOrQueueSettleSeek: (
    clipId: string,
    video: HTMLVideoElement,
    targetTime: number,
    detail?: Record<string, string>,
    reason?: 'manual-seek' | 'scrub-stop' | 'playback-stop'
  ) => void;
  safeSeekTime: (video: HTMLVideoElement, time: number) => number;
  activateFreeRunVideo: (video: HTMLVideoElement) => void;
  stopFreeRunVideo: (video: HTMLVideoElement) => void;
};

export class VideoSyncNestedCompositionCoordinator {
  private static readonly PAUSED_PRECISE_SEEK_THRESHOLD = 0.015;
  private static readonly SCRUB_SETTLE_TIMEOUT_MS = 220;

  private readonly deps: VideoSyncNestedCompositionCoordinatorDeps;

  constructor(deps: VideoSyncNestedCompositionCoordinatorDeps) {
    this.deps = deps;
  }

  syncNestedCompVideos(
    compClip: TimelineClip,
    ctx: FrameContext,
    depth = 0,
    compositionTime?: number,
  ): void {
    if (!compClip.nestedClips || !compClip.nestedTracks) return;
    if (depth >= MAX_NESTING_DEPTH) return;
    const isInteractivePreview = ctx.isDraggingPlayhead || ctx.hasClipDragPreview;
    const compLocalTime = ctx.playheadPosition - compClip.startTime;
    const mappedCompTime = resolveTransitionSourceMapTime(
      compClip.transitionSourceMap,
      compLocalTime,
    );
    const compTime = compositionTime ?? mappedCompTime?.sourceTime ?? compLocalTime + compClip.inPoint;

    for (const nestedClip of compClip.nestedClips) {
      const nestedVideo = this.deps.getClipHtmlVideoElement(nestedClip);
      if (!nestedVideo) continue;

      const isActive = compTime >= nestedClip.startTime && compTime < nestedClip.startTime + nestedClip.duration;

      if (!isActive) {
        this.deps.stopFreeRunVideo(nestedVideo);
        if (!nestedVideo.paused) {
          nestedVideo.pause();
        }
        scrubSettleState.resolve(nestedClip.id);
        continue;
      }

      const timing = getNestedClipSourceTiming(nestedClip, compTime - nestedClip.startTime);
      const nestedClipTime = timing.sourceTime;

      const video = nestedVideo;
      if (nestedClip.freeRun) {
        this.deps.activateFreeRunVideo(video);
        continue;
      }
      this.deps.stopFreeRunVideo(video);
      video.loop = false;
      const clipRuntimeProvider = this.deps.getClipRuntimeProvider(nestedClip);
      const useFullWebCodecsPreview =
        flags.useFullWebCodecsPlayback &&
        clipRuntimeProvider?.isFullMode?.();
      const timeDiff = Math.abs(video.currentTime - nestedClipTime);

      if (useFullWebCodecsPreview && clipRuntimeProvider) {
        syncNestedFullWebCodecs({
          nestedClip,
          ctx,
          video,
          clipRuntimeProvider,
          nestedClipTime,
          timeDiff,
          isInteractivePreview,
          timing,
          deps: this.deps,
        });
        continue;
      }

      if (!video.seeking && video.readyState >= 2) {
        renderHostPort.ensureVideoFrameCached(video, nestedClip.id);
      }

      if (timing.isHold) {
        scrubSettleState.resolve(nestedClip.id);
        if (!video.paused) video.pause();
        if (!video.seeking && timeDiff > VideoSyncNestedCompositionCoordinator.PAUSED_PRECISE_SEEK_THRESHOLD) {
          this.deps.throttledSeek(nestedClip.id, video, nestedClipTime, ctx);
        }
        continue;
      }

      const isReversePlayback =
        ctx.playbackSpeed < 0 || nestedClip.reversed || timing.sourceRate < 0;
      const effectiveAbsRate = Math.abs(timing.sourceRate) *
        (ctx.isPlaying ? Math.max(0.01, Math.abs(ctx.playbackSpeed || 1)) : 1);

      if (isReversePlayback) {
        if (!video.paused) video.pause();
        if (!video.seeking && timeDiff > (isInteractivePreview ? 0.04 : 0.02)) {
          this.deps.throttledSeek(nestedClip.id, video, nestedClipTime, ctx);
        }
        if (!isInteractivePreview) {
          this.deps.maybeRecoverScrubSettle(nestedClip.id, video, nestedClipTime);
        }
        continue;
      }

      if (effectiveAbsRate > 0.01 && Math.abs(video.playbackRate - effectiveAbsRate) > 0.01) {
        video.playbackRate = Math.min(16, Math.max(0.0625, effectiveAbsRate));
      }

      if (ctx.isPlaying) {
        scrubSettleState.resolve(nestedClip.id);
        if (video.paused) {
          video.play().catch(() => {});
        }
        if (timeDiff > 0.5) {
          video.currentTime = this.deps.safeSeekTime(video, nestedClipTime);
        }
      } else {
        if (!video.paused) video.pause();
        if (isInteractivePreview) {
          scrubSettleState.resolve(nestedClip.id);
        }

        if ((video.played?.length ?? 0) === 0 && !video.seeking && !this.deps.isForceDecodeInProgress(nestedClip.id)) {
          this.deps.forceVideoFrameDecode(nestedClip.id, video);
        }

        const seekThreshold = isInteractivePreview
          ? 0.1
          : VideoSyncNestedCompositionCoordinator.PAUSED_PRECISE_SEEK_THRESHOLD;
        if (timeDiff > seekThreshold) {
          if (!isInteractivePreview) {
            scrubSettleState.begin(
              nestedClip.id,
              nestedClipTime,
              VideoSyncNestedCompositionCoordinator.SCRUB_SETTLE_TIMEOUT_MS,
              'manual-seek'
            );
          }
          this.deps.throttledSeek(nestedClip.id, video, nestedClipTime, ctx);
          video.addEventListener('seeked', () => renderHostPort.requestRender(), { once: true });
        }

        if (video.readyState < 2 && !video.seeking) {
          this.deps.forceVideoFrameDecode(nestedClip.id, video);
        }

        if (!isInteractivePreview) {
          this.deps.maybeRecoverScrubSettle(nestedClip.id, video, nestedClipTime);
        }
      }

      if (clipRuntimeProvider?.isFullMode() && !ctx.isPlaying) {
        const scrubRuntimeSource = getScrubRuntimeSource(
          nestedClip.source,
          nestedClip.trackId,
          true
        );
        updateRuntimePlaybackTime(scrubRuntimeSource, nestedClipTime);
        void ensureRuntimeFrameProvider(scrubRuntimeSource, 'interactive', nestedClipTime);

        const scrubProvider = getRuntimeFrameProvider(scrubRuntimeSource);
        const pausedProvider = this.deps.getPausedWebCodecsProvider(
          clipRuntimeProvider,
          scrubProvider,
          nestedClipTime
        ) ?? clipRuntimeProvider;
        if (pausedProvider?.isFullMode()) {
          if (this.deps.shouldSeekPausedWebCodecsProvider(pausedProvider, nestedClipTime)) {
            pausedProvider.seek(nestedClipTime);
          }
        }
      }
    }

    for (const nestedClip of compClip.nestedClips) {
      if (nestedClip.isComposition && nestedClip.nestedClips && nestedClip.nestedClips.length > 0) {
        const isActive = compTime >= nestedClip.startTime && compTime < nestedClip.startTime + nestedClip.duration;
        if (isActive) {
          const mappedNestedCompTime = resolveTransitionSourceMapTime(
            nestedClip.transitionSourceMap,
            compTime - nestedClip.startTime,
          );
          this.syncNestedCompVideos(
            nestedClip,
            ctx,
            depth + 1,
            mappedNestedCompTime?.sourceTime ?? compTime + nestedClip.inPoint,
          );
        }
      }
    }
  }

}
