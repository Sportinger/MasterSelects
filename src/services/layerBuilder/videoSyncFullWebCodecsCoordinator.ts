import type { TimelineClip } from '../../types';
import { renderHostPort } from '../render/renderHostPort';
import {
  clearInternalPlaybackHold,
  playheadState,
} from './PlayheadState';
import {
  canUseSharedPreviewRuntimeSession,
  ensureRuntimeFrameProvider,
  getPreviewRuntimeSource,
  getRuntimeFrameProvider,
  getScrubRuntimeSource,
  updateRuntimePlaybackTime,
} from '../mediaRuntime/runtimePlayback';
import type { RuntimeFrameProvider } from '../mediaRuntime/types';
import { scrubSettleState } from '../scrubSettleState';
import { vfPipelineMonitor } from '../vfPipelineMonitor';
import { Logger } from '../logger';
import type { FrameContext } from './types';
import { getClipTimeInfo } from './FrameContext';
import type { VideoSyncHandoffManager } from './videoSyncHandoffs';
import { syncTransitionSourceHold } from './videoSyncTransitionSourceHold';
import {
  canStartLiveHtmlPlaybackFallbackPolicy,
  isPlaybackProviderReadyForAudioStartPolicy,
  selectPausedWebCodecsProvider,
  shouldCorrectPlaybackAudioDriftPolicy,
  shouldFastSeekPausedWebCodecsProviderPolicy,
  shouldHoldScrubReleaseIntoPlaybackPolicy,
  shouldSeekPausedWebCodecsProviderPolicy,
  shouldUseSequentialScrubSeekPolicy,
  videoSyncProviderHasFrame,
  type VideoSyncAudioElementPolicyTarget,
  type VideoSyncFrameProviderPolicyTarget,
  type VideoSyncHtmlAudioFallbackTarget,
} from './videoSyncWebCodecsPolicy';
import type { VideoSyncWebCodecsSeekState } from './videoSyncWebCodecsSeekState';

const log = Logger.create('CutTransition');

type PausedWebCodecsProvider = {
  currentTime: number;
  seek: (time: number) => void;
  scrubSeek?: (time: number) => void;
  fastSeek?: (time: number) => void;
  isPlaying?: boolean;
  pause?: () => void;
  getPendingSeekTime?: () => number | null | undefined;
  isDecodePending?: () => boolean;
  hasFrame?: () => boolean;
  getCurrentFrame?: () => unknown;
};

export type VideoSyncFullWebCodecsCoordinatorDeps = {
  wcSeeks: VideoSyncWebCodecsSeekState;
  clipWasDragging: Set<string>;
  handoffs: VideoSyncHandoffManager;
  getClipHtmlVideoElement: (clip: TimelineClip) => HTMLVideoElement | null;
  getClipRuntimeProvider: (clip: TimelineClip) => RuntimeFrameProvider | null | undefined;
  muteLinkedVideoSourceAudio: (
    ctx: FrameContext,
    clip: TimelineClip,
    video: HTMLVideoElement | null | undefined
  ) => void;
  safeSeekTime: (video: HTMLVideoElement, time: number) => number;
};

export class VideoSyncFullWebCodecsCoordinator {
  private static readonly MANUAL_TELEPORT_FAST_SEEK_THRESHOLD = 0.35;
  private readonly deps: VideoSyncFullWebCodecsCoordinatorDeps;

  constructor(deps: VideoSyncFullWebCodecsCoordinatorDeps) {
    this.deps = deps;
  }

  getPausedWebCodecsProvider(
    clipProvider: RuntimeFrameProvider | null | undefined,
    runtimeProvider: ReturnType<typeof getRuntimeFrameProvider>,
    targetTime: number,
    options?: { preferFreshRuntime?: boolean }
  ) {
    return selectPausedWebCodecsProvider(clipProvider, runtimeProvider, targetTime, options);
  }

  shouldSeekPausedWebCodecsProvider(
    provider: VideoSyncFrameProviderPolicyTarget | null | undefined,
    targetTime: number,
    providerKey?: string
  ): boolean {
    return shouldSeekPausedWebCodecsProviderPolicy(provider, targetTime, {
      lastPreciseSeekAt: providerKey ? this.deps.wcSeeks.getLastPreciseSeekAt(providerKey) : undefined,
    });
  }

  shouldFastSeekPausedWebCodecsProvider(
    provider: VideoSyncFrameProviderPolicyTarget | null | undefined,
    providerKey: string,
    targetTime: number
  ): boolean {
    return shouldFastSeekPausedWebCodecsProviderPolicy(provider, targetTime, {
      lastFastSeekTarget: this.deps.wcSeeks.getLastFastSeekTarget(providerKey),
      lastFastSeekAt: this.deps.wcSeeks.getLastFastSeekAt(providerKey),
    });
  }

  shouldUseSequentialScrubSeek(
    provider: VideoSyncFrameProviderPolicyTarget | null | undefined,
    targetTime: number
  ): boolean {
    return shouldUseSequentialScrubSeekPolicy(provider, targetTime);
  }

  isPlaybackProviderReadyForAudioStart(
    provider: VideoSyncFrameProviderPolicyTarget | null | undefined,
    targetTime: number
  ): boolean {
    return isPlaybackProviderReadyForAudioStartPolicy(provider, targetTime);
  }

  shouldCorrectPlaybackAudioDrift(
    audioElement: VideoSyncAudioElementPolicyTarget | null | undefined,
    playbackReadyForAudio: boolean,
    holdScrubRelease: boolean
  ): boolean {
    return shouldCorrectPlaybackAudioDriftPolicy(audioElement, playbackReadyForAudio, holdScrubRelease);
  }

  canStartLiveHtmlPlaybackFallback(
    audioElement: VideoSyncHtmlAudioFallbackTarget | null | undefined,
    playbackReadyForAudio: boolean,
    holdScrubRelease: boolean
  ): boolean {
    return canStartLiveHtmlPlaybackFallbackPolicy(audioElement, playbackReadyForAudio, holdScrubRelease);
  }

  shouldHoldScrubReleaseIntoPlayback(
    clipId: string,
    provider: VideoSyncFrameProviderPolicyTarget | null | undefined,
    targetTime: number
  ): boolean {
    return shouldHoldScrubReleaseIntoPlaybackPolicy(clipId, provider, targetTime);
  }

  syncPausedWebCodecsProvider(
    provider: PausedWebCodecsProvider | null | undefined,
    providerKey: string,
    targetTime: number,
    isDragging: boolean,
    schedulePreciseSeek = false,
    allowSequentialDuringDrag = true
  ): void {
    if (!provider) {
      return;
    }

    if (provider.isPlaying) {
      provider.pause?.();
    }

    if (isDragging) {
      const interactiveSeek =
        typeof provider.scrubSeek === 'function'
          ? provider.scrubSeek.bind(provider)
          : provider.seek.bind(provider);
      const supportsInteractiveScrub = typeof provider.scrubSeek === 'function';
      const decodeBusy = provider.isDecodePending?.() ?? false;
      const effectivePos = provider.getPendingSeekTime?.() ?? provider.currentTime;
      const dragDelta = Math.abs(effectivePos - targetTime);

      if (allowSequentialDuringDrag && supportsInteractiveScrub) {
        const canRetargetBusyInteractiveSeek =
          decodeBusy &&
          dragDelta >= 0.12 &&
          performance.now() - (this.deps.wcSeeks.getLastPreciseSeekAt(providerKey) ?? 0) >= 24;
        if (
          (!decodeBusy || canRetargetBusyInteractiveSeek) &&
          (!videoSyncProviderHasFrame(provider) || dragDelta > 0.01)
        ) {
          this.clearFastSeekTracking(providerKey);
          interactiveSeek(targetTime);
          this.deps.wcSeeks.setLastPreciseSeekAt(providerKey, performance.now());
        }
        return;
      }

      if (allowSequentialDuringDrag && this.shouldUseSequentialScrubSeek(provider, targetTime)) {
        this.clearFastSeekTracking(providerKey);
        interactiveSeek(targetTime);
        return;
      }

      if (this.shouldFastSeekPausedWebCodecsProvider(provider, providerKey, targetTime)) {
        provider.fastSeek?.(targetTime);
        this.deps.wcSeeks.setFastSeek(providerKey, targetTime, performance.now());
        if (schedulePreciseSeek) {
          this.schedulePreciseWcSeek(providerKey, provider, targetTime);
        }
      }
      return;
    }

    const effectivePos = provider.getPendingSeekTime?.() ?? provider.currentTime;
    const lastFastSeekTarget = this.deps.wcSeeks.getLastFastSeekTarget(providerKey);
    const targetMovedSinceFastSeek =
      lastFastSeekTarget === undefined ||
      Math.abs(lastFastSeekTarget - targetTime) > 0.01;
    const shouldPrimeManualTeleport =
      typeof provider.fastSeek === 'function' &&
      targetMovedSinceFastSeek &&
      !provider.isDecodePending?.() &&
      Math.abs(effectivePos - targetTime) >=
        VideoSyncFullWebCodecsCoordinator.MANUAL_TELEPORT_FAST_SEEK_THRESHOLD;

    if (shouldPrimeManualTeleport) {
      provider.fastSeek?.(targetTime);
      this.deps.wcSeeks.setFastSeek(providerKey, targetTime, performance.now());
      return;
    }

    this.clearFastSeekTracking(providerKey);
    if (this.shouldSeekPausedWebCodecsProvider(provider, targetTime, providerKey)) {
      provider.seek(targetTime);
      this.deps.wcSeeks.setLastPreciseSeekAt(providerKey, performance.now());
    }
  }

  syncFullWebCodecs(clip: TimelineClip, ctx: FrameContext): void {
    const video = this.deps.getClipHtmlVideoElement(clip);
    const timeInfo = getClipTimeInfo(ctx, clip);
    const playbackRuntimeSource = getPreviewRuntimeSource(
      clip.source,
      clip.trackId,
      canUseSharedPreviewRuntimeSession(clip, ctx.clipsAtTime)
    );
    const scrubRuntimeSource = getScrubRuntimeSource(
      clip.source,
      clip.trackId,
      canUseSharedPreviewRuntimeSession(clip, ctx.clipsAtTime)
    );
    const clipRuntimeProvider = this.deps.getClipRuntimeProvider(clip);
    const isInteractivePreview = ctx.isDraggingPlayhead || ctx.hasClipDragPreview;

    const handoffVideo = this.deps.handoffs.getHandoffVideoElement(clip.id);
    const audioVideo = handoffVideo ?? video;
    this.deps.muteLinkedVideoSourceAudio(ctx, clip, audioVideo);

    if (clip.transitionSourceHold === true) {
      syncTransitionSourceHold({
        clip,
        video,
        clipRuntimeProvider,
        isInteractivePreview,
        playbackRuntimeSource,
        scrubRuntimeSource,
        clipTime: timeInfo.clipTime,
        syncPausedWebCodecsProvider: (...args) => this.syncPausedWebCodecsProvider(...args),
      });
      return;
    }

    if (ctx.isPlaying) {
      const settle = scrubSettleState.get(clip.id);
      const settleActive =
        settle &&
        (settle.reason === 'scrub-stop' || settle.reason === 'manual-seek') &&
        scrubSettleState.isPending(clip.id) &&
        !scrubSettleState.isDue(clip.id);
      const holdPlaybackTarget = settleActive ? settle.targetTime : null;
      if (settle && scrubSettleState.isDue(clip.id)) {
        scrubSettleState.resolve(clip.id);
      }
      const useScrubRuntimeForHold =
        holdPlaybackTarget !== null && settle?.reason === 'scrub-stop';
      const preferredRuntimeSource =
        useScrubRuntimeForHold ? scrubRuntimeSource : playbackRuntimeSource;
      const preferredTargetTime =
        holdPlaybackTarget !== null ? holdPlaybackTarget : timeInfo.clipTime;

      updateRuntimePlaybackTime(preferredRuntimeSource, preferredTargetTime);
      if (useScrubRuntimeForHold) {
        void ensureRuntimeFrameProvider(scrubRuntimeSource, 'interactive', holdPlaybackTarget!);
      }

      let playbackProvider =
        getRuntimeFrameProvider(preferredRuntimeSource) ??
        clipRuntimeProvider;
      const actualPlaybackProvider = useScrubRuntimeForHold
        ? (getRuntimeFrameProvider(playbackRuntimeSource) ?? clipRuntimeProvider)
        : playbackProvider;
      const holdScrubRelease =
        holdPlaybackTarget !== null &&
        this.shouldHoldScrubReleaseIntoPlayback(
          clip.id,
          actualPlaybackProvider,
          holdPlaybackTarget
        );
      const playbackTargetTime = timeInfo.clipTime;

      if (holdScrubRelease && useScrubRuntimeForHold) {
        updateRuntimePlaybackTime(playbackRuntimeSource, timeInfo.clipTime);
        void ensureRuntimeFrameProvider(playbackRuntimeSource, 'interactive', timeInfo.clipTime);
      }

      if (playheadState.heldPlaybackPosition !== null) {
        clearInternalPlaybackHold(clip.id);
      }

      if (!holdScrubRelease && holdPlaybackTarget !== null) {
        updateRuntimePlaybackTime(playbackRuntimeSource, timeInfo.clipTime);
        playbackProvider =
          getRuntimeFrameProvider(playbackRuntimeSource) ??
          clipRuntimeProvider;
      }
      if (!playbackProvider?.isFullMode()) {
        return;
      }

      playbackProvider.advanceToTime?.(playbackTargetTime);

      if (audioVideo) {
        const playbackReadyForAudio = this.isPlaybackProviderReadyForAudioStart(
          playbackProvider,
          playbackTargetTime
        );
        const normalForwardHtmlFallback =
          ctx.playbackSpeed === 1 &&
          !clip.reversed &&
          timeInfo.speed > 0 &&
          Math.abs(timeInfo.absSpeed - 1) <= 0.01 &&
          !ctx.hasKeyframes(clip.id, 'speed');
        const liveHtmlFallbackReady =
          normalForwardHtmlFallback &&
          this.canStartLiveHtmlPlaybackFallback(
            audioVideo,
            playbackReadyForAudio,
            holdScrubRelease
          );
        const canStartPlaybackElement = playbackReadyForAudio || liveHtmlFallbackReady;
        if (audioVideo.paused && canStartPlaybackElement && !holdScrubRelease) {
          const startupAudioDrift = Math.abs(audioVideo.currentTime - playbackTargetTime);
          if (startupAudioDrift > 0.05) {
            audioVideo.currentTime = this.deps.safeSeekTime(audioVideo, playbackTargetTime);
            if (liveHtmlFallbackReady && !playbackReadyForAudio) {
              return;
            }
          }
          log.info('Audio element PLAY', {
            clip: clip.id.slice(-6),
            isHandoff: !!handoffVideo,
            liveHtmlFallback: liveHtmlFallbackReady,
            time: audioVideo.currentTime.toFixed(3),
            target: playbackTargetTime.toFixed(3),
          });
          audioVideo.play().catch(() => {});
        }
        const audioSyncTarget = holdScrubRelease ? playbackTargetTime : timeInfo.clipTime;
        const audioDrift = Math.abs(audioVideo.currentTime - audioSyncTarget);
        if (
          this.shouldCorrectPlaybackAudioDrift(
            audioVideo,
            canStartPlaybackElement,
            holdScrubRelease
          ) &&
          audioDrift > 0.3
        ) {
          log.warn('Audio drift SEEK', {
            clip: clip.id.slice(-6),
            isHandoff: !!handoffVideo,
            elementTime: audioVideo.currentTime.toFixed(3),
            target: audioSyncTarget.toFixed(3),
            drift: audioDrift.toFixed(3),
          });
          audioVideo.currentTime = this.deps.safeSeekTime(audioVideo, audioSyncTarget);
        }
      }
      return;
    }

    if (playheadState.heldPlaybackPosition !== null) {
      clearInternalPlaybackHold(clip.id);
    }
    const justStoppedDraggingWc = this.deps.clipWasDragging.has(clip.id) && !isInteractivePreview;
    if (isInteractivePreview) {
      this.deps.clipWasDragging.add(clip.id);
    } else if (justStoppedDraggingWc) {
      this.deps.clipWasDragging.delete(clip.id);
      this.deps.wcSeeks.clearPreciseSeekTimer(`${clip.id}:scrub`);
      this.deps.wcSeeks.clearPreciseSeekTimer(`${clip.id}:fallback`);
      scrubSettleState.begin(
        clip.id,
        timeInfo.clipTime,
        800,
        'scrub-stop'
      );
    }

    const useDedicatedScrubProvider = isInteractivePreview;
    const pausedRuntimeSource = useDedicatedScrubProvider
      ? scrubRuntimeSource
      : playbackRuntimeSource;

    updateRuntimePlaybackTime(pausedRuntimeSource, timeInfo.clipTime);
    if (useDedicatedScrubProvider) {
      void ensureRuntimeFrameProvider(scrubRuntimeSource, 'interactive', timeInfo.clipTime);
    }

    const pausedRuntimeProvider = getRuntimeFrameProvider(pausedRuntimeSource);
    const dedicatedScrubProvider =
      useDedicatedScrubProvider && pausedRuntimeProvider?.isFullMode()
        ? pausedRuntimeProvider
        : null;
    const pausedProvider = this.getPausedWebCodecsProvider(
      clipRuntimeProvider,
      pausedRuntimeProvider,
      timeInfo.clipTime,
      { preferFreshRuntime: useDedicatedScrubProvider }
    );
    const fallbackProvider =
      dedicatedScrubProvider && pausedProvider && pausedProvider !== dedicatedScrubProvider
        ? pausedProvider
        : null;
    const scrubProviderReady = this.isPlaybackProviderReadyForAudioStart(
      dedicatedScrubProvider,
      timeInfo.clipTime
    );

    if (dedicatedScrubProvider?.isPlaying) dedicatedScrubProvider.pause();
    if (fallbackProvider?.isPlaying) fallbackProvider.pause();
    if (pausedProvider?.isPlaying) pausedProvider.pause();
    if (video && !video.paused) video.pause();

    if (!pausedProvider?.isFullMode()) {
      return;
    }

    if (justStoppedDraggingWc) {
      const pendingTarget = pausedProvider.getPendingSeekTime?.();
      const pendingAtTarget =
        pendingTarget != null &&
        Math.abs(pendingTarget - timeInfo.clipTime) <= 0.01;
      const displayedDiff = Math.abs(pausedProvider.currentTime - timeInfo.clipTime);
      const needsVisibleSettle =
        !videoSyncProviderHasFrame(pausedProvider) ||
        displayedDiff > 0.001;

      if (needsVisibleSettle && !pendingAtTarget) {
        pausedProvider.seek(timeInfo.clipTime);
        this.deps.wcSeeks.setLastPreciseSeekAt(`${clip.id}:fallback`, performance.now());
        renderHostPort.requestRender();
        vfPipelineMonitor.record('vf_wc_settle_seek', {
          clipId: clip.id,
          target: Math.round(timeInfo.clipTime * 1000) / 1000,
        });
      }
    }

    if (dedicatedScrubProvider) {
      this.syncPausedWebCodecsProvider(
        dedicatedScrubProvider,
        `${clip.id}:scrub`,
        timeInfo.clipTime,
        isInteractivePreview,
        true,
        true
      );
    }

    if (!dedicatedScrubProvider) {
      this.syncPausedWebCodecsProvider(
        pausedProvider,
        `${clip.id}:fallback`,
        timeInfo.clipTime,
        isInteractivePreview,
        true,
        true
      );
    } else if (fallbackProvider && !scrubProviderReady) {
      this.syncPausedWebCodecsProvider(
        fallbackProvider,
        `${clip.id}:fallback`,
        timeInfo.clipTime,
        isInteractivePreview,
        false,
        false
      );
    } else {
      this.clearFastSeekTracking(`${clip.id}:fallback`);
      this.deps.wcSeeks.clearPreciseSeekTimer(`${clip.id}:fallback`);
    }

    if (video && !isInteractivePreview) {
      const timeDiff = Math.abs(video.currentTime - timeInfo.clipTime);
      if (timeDiff > 0.05) {
        video.currentTime = this.deps.safeSeekTime(video, timeInfo.clipTime);
      }
    }
  }

  schedulePreciseWcSeek(
    clipId: string,
    wcp: { seek: (time: number) => void; currentTime: number },
    time: number
  ): void {
    this.deps.wcSeeks.setLatestPreciseTarget(clipId, time);
    this.deps.wcSeeks.replacePreciseSeekTimer(clipId, setTimeout(() => {
      this.deps.wcSeeks.clearPreciseSeekTimer(clipId);
      const targetTime = this.deps.wcSeeks.getLatestPreciseTarget(clipId) ?? time;
      if (Math.abs(wcp.currentTime - targetTime) > 0.01) {
        wcp.seek(targetTime);
        this.deps.wcSeeks.setLastPreciseSeekAt(clipId, performance.now());
        renderHostPort.requestRender();
      }
    }, 120));
  }

  private clearFastSeekTracking(providerKey: string): void {
    this.deps.wcSeeks.clearFastSeek(providerKey);
  }
}
