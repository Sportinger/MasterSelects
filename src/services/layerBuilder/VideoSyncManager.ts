// VideoSyncManager - Handles video element synchronization with playhead
// Extracted from LayerBuilderService for separation of concerns

import type { TimelineClip } from '../../types';
import type { FrameContext } from './types';
import { createFrameContext } from './FrameContext';
import { layerPlaybackManager } from '../layerPlaybackManager';
import { engine } from '../../engine/WebGPUEngine';
import { flags } from '../../engine/featureFlags';
import {
  canUseSharedPreviewRuntimeSession,
  getPreviewRuntimeSource,
  getRuntimeFrameProvider,
  updateRuntimePlaybackTime,
} from '../mediaRuntime/runtimePlayback';
import { scrubSettleState } from '../scrubSettleState';
import { resolveVideoSyncMedia } from './videoSyncMediaResolver';
import { hydrateTimelineMediaWindow } from '../timeline/lazyMediaElements';
import { VideoSyncForceDecodeManager } from './videoSyncForceDecodeManager';
import { VideoSyncFullWebCodecsCoordinator } from './videoSyncFullWebCodecsCoordinator';
import { VideoSyncHandoffManager } from './videoSyncHandoffs';
import { VideoSyncHtmlClipCoordinator } from './videoSyncHtmlClipCoordinator';
import { VideoSyncHtmlSeekCoordinator } from './videoSyncHtmlSeekCoordinator';
import { VideoSyncHtmlSeekState } from './videoSyncHtmlSeekState';
import { VideoSyncNestedCompositionCoordinator } from './videoSyncNestedCompositionCoordinator';
import { VideoSyncNativeDecoderSync } from './videoSyncNativeDecoderSync';
import { VideoSyncRecoveryCoordinator } from './videoSyncRecoveryCoordinator';
import {
  getActiveClipsAtTime,
  getVisibleVideoTrackClipsAtTime,
} from './videoSyncTimelineQueries';
import { getVisibleVideoTrackPlaybackClipsAtTime } from './videoSyncTransitionQueries';
import { VideoSyncWarmupState } from './videoSyncWarmupState';
import { VideoSyncWarmupCoordinator } from './videoSyncWarmupCoordinator';
import { VideoSyncWebCodecsSeekState } from './videoSyncWebCodecsSeekState';

export class VideoSyncManager {
  // Video sync throttling
  private lastVideoSyncFrame = -1;
  private lastVideoSyncPlaying = false;
  private lastVideoSyncClipsRef: TimelineClip[] | null = null;

  // Track per-clip playing state to detect playingâ†’paused transitions
  private clipWasPlaying = new Set<string>();

  // Track per-clip dragging state to detect scrub-stop transitions
  private clipWasDragging = new Set<string>();

  private warmups = new VideoSyncWarmupState();
  private htmlSeeks = new VideoSyncHtmlSeekState();
  private forceDecodes = new VideoSyncForceDecodeManager();
  private wcSeeks = new VideoSyncWebCodecsSeekState();
  private nativeDecoders = new VideoSyncNativeDecoderSync();

  private handoffs = new VideoSyncHandoffManager();
  private fullWebCodecs: VideoSyncFullWebCodecsCoordinator;
  private htmlClipCoordinator: VideoSyncHtmlClipCoordinator;
  private htmlSeekCoordinator: VideoSyncHtmlSeekCoordinator;
  private nestedCompositionCoordinator: VideoSyncNestedCompositionCoordinator;
  private recoveryCoordinator: VideoSyncRecoveryCoordinator;
  private warmupCoordinator: VideoSyncWarmupCoordinator;

  constructor() {
    this.fullWebCodecs = new VideoSyncFullWebCodecsCoordinator({
      wcSeeks: this.wcSeeks,
      clipWasDragging: this.clipWasDragging,
      handoffs: this.handoffs,
      getClipHtmlVideoElement: (clip) => this.getClipHtmlVideoElement(clip),
      getClipRuntimeProvider: (clip) => this.getClipRuntimeProvider(clip),
      muteLinkedVideoSourceAudio: (ctx, clip, video) => this.muteLinkedVideoSourceAudio(ctx, clip, video),
      safeSeekTime: (video, time) => this.safeSeekTime(video, time),
    });
    this.recoveryCoordinator = new VideoSyncRecoveryCoordinator({
      warmups: this.warmups,
      htmlSeeks: this.htmlSeeks,
      beginOrQueueSettleSeek: (clipId, video, targetTime, detail, reason) =>
        this.beginOrQueueSettleSeek(clipId, video, targetTime, detail, reason),
      startTargetedWarmup: (clipId, video, targetTime, options) =>
        this.startTargetedWarmup(clipId, video, targetTime, options),
      recoverClipPlaybackState: (clipId, video, targetTime) =>
        this.recoverClipPlaybackState(clipId, video, targetTime),
    });
    this.htmlClipCoordinator = new VideoSyncHtmlClipCoordinator({
      warmups: this.warmups,
      htmlSeeks: this.htmlSeeks,
      clipWasPlaying: this.clipWasPlaying,
      clipWasDragging: this.clipWasDragging,
      getHandoffVideoElement: (clipId) => this.handoffs.getHandoffVideoElement(clipId),
      getHandoffTrackState: (trackId) => this.handoffs.getTrackState(trackId),
      setHandoff: (clipId, video) => this.handoffs.setHandoff(clipId, video),
      deleteHandoff: (clipId, video) => this.handoffs.deleteHandoff(clipId, video),
      muteLinkedVideoSourceAudio: (ctx, clip, video) => this.muteLinkedVideoSourceAudio(ctx, clip, video),
      isVideoGpuReady: (video) => this.isVideoGpuReady(video),
      clearWarmupState: (video) => this.clearWarmupState(video),
      maybeRetargetActiveWarmup: (clipId, video, targetTime, now, options) =>
        this.maybeRetargetActiveWarmup(clipId, video, targetTime, now, options),
      startTargetedWarmup: (clipId, video, targetTime, options) =>
        this.startTargetedWarmup(clipId, video, targetTime, options),
      isForceDecodeInProgress: (clipId) => this.forceDecodes.isInProgress(clipId),
      forceColdScrubFrame: (clipId, video) => this.forceDecodes.forceColdScrubFrame(clipId, video),
      forceVideoFrameDecode: (clipId, video) => this.forceDecodes.forceVideoFrameDecode(clipId, video),
      beginOrQueueSettleSeek: (clipId, video, targetTime, detail, reason) =>
        this.beginOrQueueSettleSeek(clipId, video, targetTime, detail, reason),
      throttledSeek: (clipId, video, time, ctx) => this.throttledSeek(clipId, video, time, ctx),
      maybeRecoverScrubSettle: (clipId, video, targetTime) =>
        this.recoveryCoordinator.maybeRecoverScrubSettle(clipId, video, targetTime),
      maybeRecoverDraggingPendingSeek: (clipId, video, targetTime, now) =>
        this.recoveryCoordinator.maybeRecoverDraggingPendingSeek(clipId, video, targetTime, now),
      maybeRecoverDraggingDisplayedDrift: (clipId, video, targetTime, now) =>
        this.recoveryCoordinator.maybeRecoverDraggingDisplayedDrift(clipId, video, targetTime, now),
      safeSeekTime: (video, time) => this.safeSeekTime(video, time),
    });
    this.htmlSeekCoordinator = new VideoSyncHtmlSeekCoordinator({
      htmlSeeks: this.htmlSeeks,
      safeSeekTime: (video, time) => this.safeSeekTime(video, time),
      maybeRecoverDraggingPendingSeek: (clipId, video, targetTime, now) =>
        this.recoveryCoordinator.maybeRecoverDraggingPendingSeek(clipId, video, targetTime, now),
    });
    this.nestedCompositionCoordinator = new VideoSyncNestedCompositionCoordinator({
      getClipHtmlVideoElement: (clip) => this.getClipHtmlVideoElement(clip),
      getClipRuntimeProvider: (clip) => this.getClipRuntimeProvider(clip),
      isPlaybackProviderReadyForAudioStart: (provider, targetTime) =>
        this.isPlaybackProviderReadyForAudioStart(provider, targetTime),
      shouldCorrectPlaybackAudioDrift: (audioElement, playbackReadyForAudio, holdScrubRelease) =>
        this.shouldCorrectPlaybackAudioDrift(audioElement, playbackReadyForAudio, holdScrubRelease),
      getPausedWebCodecsProvider: (clipProvider, runtimeProvider, targetTime, options) =>
        this.getPausedWebCodecsProvider(clipProvider, runtimeProvider, targetTime, options),
      syncPausedWebCodecsProvider: (provider, providerKey, targetTime, isDragging, schedulePreciseSeek, allowSequentialDuringDrag) =>
        this.syncPausedWebCodecsProvider(provider, providerKey, targetTime, isDragging, schedulePreciseSeek, allowSequentialDuringDrag),
      shouldSeekPausedWebCodecsProvider: (provider, targetTime, providerKey) =>
        this.shouldSeekPausedWebCodecsProvider(provider, targetTime, providerKey),
      forceVideoFrameDecode: (clipId, video) => this.forceDecodes.forceVideoFrameDecode(clipId, video),
      isForceDecodeInProgress: (clipId) => this.forceDecodes.isInProgress(clipId),
      throttledSeek: (clipId, video, time, ctx) => this.throttledSeek(clipId, video, time, ctx),
      maybeRecoverScrubSettle: (clipId, video, targetTime) =>
        this.recoveryCoordinator.maybeRecoverScrubSettle(clipId, video, targetTime),
      beginOrQueueSettleSeek: (clipId, video, targetTime, detail, reason) =>
        this.beginOrQueueSettleSeek(clipId, video, targetTime, detail, reason),
      safeSeekTime: (video, time) => this.safeSeekTime(video, time),
    });
    this.warmupCoordinator = new VideoSyncWarmupCoordinator({
      warmups: this.warmups,
      getClipHtmlVideoElement: (clip) => this.getClipHtmlVideoElement(clip),
      getClipRuntimeProvider: (clip) => this.getClipRuntimeProvider(clip),
      getHandoffVideoElement: (clipId) => this.handoffs.getHandoffVideoElement(clipId),
      isVideoGpuReady: (video) => this.isVideoGpuReady(video),
      safeSeekTime: (video, time) => this.safeSeekTime(video, time),
      clearHtmlSeekState: (clipId, video) => this.clearHtmlSeekState(clipId, video),
      prewarmUpcomingWebCodecsClip: (ctx, clip, clipTime) => this.prewarmUpcomingWebCodecsClip(ctx, clip, clipTime),
      usesFullWebCodecsPreview: (clip) => this.usesFullWebCodecsPreview(clip),
      startTargetedWarmup: (clipId, video, targetTime, options) =>
        this.startTargetedWarmup(clipId, video, targetTime, options),
      clearWarmupState: (video) => this.clearWarmupState(video),
    });
  }

  private isVideoGpuReady(video: HTMLVideoElement): boolean {
    return this.warmups.isGpuReady(video) || engine.getLayerCollector?.()?.isVideoGpuReady(video) === true;
  }

  /**
   * Reset all per-clip state. Called during composition switch to prevent
   * stale references to destroyed video elements / WebCodecsPlayers.
   */
  reset(): void {
    this.handoffs.reset();
    this.warmups.reset();
    this.htmlSeeks.reset();
    this.clipWasPlaying.clear();
    this.clipWasDragging.clear();
    this.forceDecodes.reset();
    this.wcSeeks.reset();
    this.lastVideoSyncFrame = -1;
    this.lastVideoSyncPlaying = false;
    this.lastVideoSyncClipsRef = null;
    scrubSettleState.clear();
    this.recoveryCoordinator.reset();
    this.warmupCoordinator.reset();
    // Clear debounce timers
  }

  /**
   * Clamp seek time to valid range, preventing EOF decoder stalls.
   * H.264 B-frame decoders stall when seeking to exactly video.duration
   * because they wait for reference frames that don't exist.
   */
  private safeSeekTime(video: HTMLVideoElement, time: number): number {
    const dur = video.duration;
    if (!isFinite(dur) || dur <= 0) return Math.max(0, time);
    return Math.max(0, Math.min(time, dur - 0.001));
  }

  private usesFullWebCodecsPreview(clip: TimelineClip): boolean {
    return !!(
      flags.useFullWebCodecsPlayback &&
      this.getClipRuntimeProvider(clip)?.isFullMode?.()
    );
  }

  private getClipRuntimeProvider(clip: TimelineClip) {
    return resolveVideoSyncMedia(clip).runtimeFrameProvider;
  }

  private getClipHtmlVideoElement(clip: TimelineClip): HTMLVideoElement | null {
    return resolveVideoSyncMedia(clip).htmlVideoElement;
  }

  private shouldMuteVideoElementSourceAudio(_ctx: FrameContext, clip: TimelineClip): boolean {
    const syncMedia = resolveVideoSyncMedia(clip);
    return clip.source?.type === 'video' ||
      Boolean(syncMedia.htmlVideoElement || syncMedia.runtimeFrameProvider);
  }

  private muteLinkedVideoSourceAudio(ctx: FrameContext, clip: TimelineClip, video: HTMLVideoElement | null | undefined): void {
    if (!video || !this.shouldMuteVideoElementSourceAudio(ctx, clip)) return;
    if (!video.muted) video.muted = true;
  }

  private pruneUpcomingPreplays(ctx: FrameContext, isInteractivePreview: boolean): void {
    this.warmupCoordinator.pruneUpcomingPreplays(ctx, isInteractivePreview);
  }

  private preloadPausedJumpNeighborhood(ctx: FrameContext): void {
    this.warmupCoordinator.preloadPausedJumpNeighborhood(ctx);
  }

  private beginOrQueueSettleSeek(
    clipId: string,
    video: HTMLVideoElement,
    targetTime: number,
    detail?: Record<string, string>,
    reason?: 'manual-seek' | 'scrub-stop' | 'playback-stop'
  ): void {
    this.htmlSeekCoordinator.beginOrQueueSettleSeek(clipId, video, targetTime, detail, reason);
  }

  private sharesActiveTrackDecoder(ctx: FrameContext, clip: TimelineClip): boolean {
    if (!clip.trackId) {
      return false;
    }

    const activeClip = ctx.clipsByTrackId.get(clip.trackId);
    if (!activeClip?.source || activeClip.id === clip.id) {
      return false;
    }

    if (clip.source?.runtimeSourceId && activeClip.source.runtimeSourceId) {
      return clip.source.runtimeSourceId === activeClip.source.runtimeSourceId;
    }

    const clipProvider = this.getClipRuntimeProvider(clip);
    const activeProvider = this.getClipRuntimeProvider(activeClip);
    return !!clipProvider && clipProvider === activeProvider;
  }

  private prewarmUpcomingWebCodecsClip(
    ctx: FrameContext,
    clip: TimelineClip,
    clipTime: number
  ): void {
    if (!clip.source || this.sharesActiveTrackDecoder(ctx, clip)) {
      return;
    }

    const futureActiveClips = getActiveClipsAtTime(
      ctx,
      Math.min(clip.startTime + 0.001, clip.startTime + Math.max(clip.duration * 0.25, 0.001))
    );
    const previewSource = getPreviewRuntimeSource(
      clip.source,
      clip.trackId,
      canUseSharedPreviewRuntimeSession(clip, futureActiveClips)
    );

    updateRuntimePlaybackTime(previewSource, clipTime);

    const runtimeProvider = getRuntimeFrameProvider(previewSource);
    const clipProvider = this.getClipRuntimeProvider(clip);
    const frameProvider =
      runtimeProvider?.isFullMode()
        ? runtimeProvider
        : clipProvider?.isFullMode()
          ? clipProvider
          : null;

    if (!frameProvider) {
      return;
    }

    const pendingTarget = frameProvider.getPendingSeekTime?.();
    const effectiveTime = pendingTarget ?? frameProvider.currentTime;
    const hasFrame = frameProvider.hasFrame?.() ?? true;
    if (pendingTarget != null && Math.abs(pendingTarget - clipTime) <= 0.05) {
      return;
    }
    if (hasFrame && Math.abs(effectiveTime - clipTime) <= 0.05) {
      return;
    }

    frameProvider.seek(clipTime);
  }

  private clearHtmlSeekState(clipId: string, video?: HTMLVideoElement): void {
    this.htmlSeekCoordinator.clearHtmlSeekState(clipId, video);
  }

  private maybeRetargetActiveWarmup(
    clipId: string,
    video: HTMLVideoElement,
    targetTime: number,
    now: number,
    options?: { isPlaying?: boolean; isDragging?: boolean; requestRender?: boolean }
  ): void {
    this.warmupCoordinator.maybeRetargetActiveWarmup(clipId, video, targetTime, now, options);
  }

  private getPausedWebCodecsProvider(
    clipProvider: Parameters<VideoSyncFullWebCodecsCoordinator['getPausedWebCodecsProvider']>[0],
    runtimeProvider: Parameters<VideoSyncFullWebCodecsCoordinator['getPausedWebCodecsProvider']>[1],
    targetTime: number,
    options?: Parameters<VideoSyncFullWebCodecsCoordinator['getPausedWebCodecsProvider']>[3]
  ) {
    return this.fullWebCodecs.getPausedWebCodecsProvider(clipProvider, runtimeProvider, targetTime, options);
  }

  private shouldSeekPausedWebCodecsProvider(
    provider: Parameters<VideoSyncFullWebCodecsCoordinator['shouldSeekPausedWebCodecsProvider']>[0],
    targetTime: number,
    providerKey?: string
  ): boolean {
    return this.fullWebCodecs.shouldSeekPausedWebCodecsProvider(provider, targetTime, providerKey);
  }

  shouldFastSeekPausedWebCodecsProvider(
    provider: Parameters<VideoSyncFullWebCodecsCoordinator['shouldFastSeekPausedWebCodecsProvider']>[0],
    providerKey: string,
    targetTime: number
  ): boolean {
    return this.fullWebCodecs.shouldFastSeekPausedWebCodecsProvider(provider, providerKey, targetTime);
  }

  shouldUseSequentialScrubSeek(
    provider: Parameters<VideoSyncFullWebCodecsCoordinator['shouldUseSequentialScrubSeek']>[0],
    targetTime: number
  ): boolean {
    return this.fullWebCodecs.shouldUseSequentialScrubSeek(provider, targetTime);
  }

  private isPlaybackProviderReadyForAudioStart(
    provider: Parameters<VideoSyncFullWebCodecsCoordinator['isPlaybackProviderReadyForAudioStart']>[0],
    targetTime: number
  ): boolean {
    return this.fullWebCodecs.isPlaybackProviderReadyForAudioStart(provider, targetTime);
  }

  private shouldCorrectPlaybackAudioDrift(
    audioElement: Parameters<VideoSyncFullWebCodecsCoordinator['shouldCorrectPlaybackAudioDrift']>[0],
    playbackReadyForAudio: boolean,
    holdScrubRelease: boolean
  ): boolean {
    return this.fullWebCodecs.shouldCorrectPlaybackAudioDrift(audioElement, playbackReadyForAudio, holdScrubRelease);
  }

  canStartLiveHtmlPlaybackFallback(
    audioElement: Parameters<VideoSyncFullWebCodecsCoordinator['canStartLiveHtmlPlaybackFallback']>[0],
    playbackReadyForAudio: boolean,
    holdScrubRelease: boolean
  ): boolean {
    return this.fullWebCodecs.canStartLiveHtmlPlaybackFallback(audioElement, playbackReadyForAudio, holdScrubRelease);
  }

  shouldHoldScrubReleaseIntoPlayback(
    clipId: string,
    provider: Parameters<VideoSyncFullWebCodecsCoordinator['shouldHoldScrubReleaseIntoPlayback']>[1],
    targetTime: number
  ): boolean {
    return this.fullWebCodecs.shouldHoldScrubReleaseIntoPlayback(clipId, provider, targetTime);
  }

  private syncPausedWebCodecsProvider(
    provider: Parameters<VideoSyncFullWebCodecsCoordinator['syncPausedWebCodecsProvider']>[0],
    providerKey: string,
    targetTime: number,
    isDragging: boolean,
    schedulePreciseSeek = false,
    allowSequentialDuringDrag = true
  ): void {
    this.fullWebCodecs.syncPausedWebCodecsProvider(
      provider,
      providerKey,
      targetTime,
      isDragging,
      schedulePreciseSeek,
      allowSequentialDuringDrag
    );
  }

  computeHandoffs(ctx: FrameContext): void {
    this.handoffs.compute(
      ctx,
      getVisibleVideoTrackClipsAtTime(ctx),
      (clip) => this.getClipHtmlVideoElement(clip)
    );
  }

  getHandoffVideoElement(clipId: string): HTMLVideoElement | null {
    return this.handoffs.getHandoffVideoElement(clipId);
  }

  getPreviewContinuationVideoElement(
    clip: TimelineClip,
    targetTime: number
  ): HTMLVideoElement | null {
    return this.handoffs.getPreviewContinuationVideoElement(
      clip,
      targetTime,
      this.getClipHtmlVideoElement(clip)
    );
  }

  /**
   * Sync video elements to current playhead
   */
  syncVideoElements(): void {
    const ctx = createFrameContext();
    hydrateTimelineMediaWindow(ctx);
    const isInteractivePreview = ctx.isDraggingPlayhead || ctx.hasClipDragPreview;

    // Skip if same frame during playback
    if (ctx.isPlaying && !ctx.isDraggingPlayhead &&
        ctx.frameNumber === this.lastVideoSyncFrame &&
        ctx.isPlaying === this.lastVideoSyncPlaying &&
        ctx.clips === this.lastVideoSyncClipsRef) {
      return;
    }
    this.lastVideoSyncFrame = ctx.frameNumber;
    this.lastVideoSyncPlaying = ctx.isPlaying;
    this.lastVideoSyncClipsRef = ctx.clips;

    // Compute handoffs for seamless cut transitions
    this.computeHandoffs(ctx);
    this.pruneUpcomingPreplays(ctx, isInteractivePreview);

    // Proactively warm upcoming clips before sync so boundary crossings during
    // playback or drag scrubbing are less likely to hit a cold decoder surface.
    if (ctx.isPlaying || isInteractivePreview) {
      this.warmupCoordinator.resetPausedJumpPreload();
      this.warmupUpcomingClips(ctx);
    } else {
      this.preloadPausedJumpNeighborhood(ctx);
    }
    if (ctx.isPlaying) {
      this.preBufferUpcomingVideoAudio(ctx);
      this.preBufferUpcomingNestedCompVideos(ctx);
    }

    // Sync each clip at playhead
    const visibleVideoClipsAtTime = getVisibleVideoTrackPlaybackClipsAtTime(ctx);
    const visibleVideoClipIdsAtTime = new Set(visibleVideoClipsAtTime.map((clip) => clip.id));

    for (const clip of visibleVideoClipsAtTime) {
      this.syncClipVideo(clip, ctx);

      // Sync nested composition videos
      if (clip.isComposition && clip.nestedClips && clip.nestedClips.length > 0) {
        this.syncNestedCompVideos(clip, ctx);
      }
    }

    // Pause videos not at playhead (but don't pause videos during GPU warmup)
    for (const clip of ctx.clips) {
      const video = this.getClipHtmlVideoElement(clip);
      if (video) {
        const isAtPlayhead = visibleVideoClipIdsAtTime.has(clip.id);
        if (!isAtPlayhead && !video.paused &&
            !this.warmups.isWarming(video) &&
            !this.handoffs.hasHandoffElement(video) &&
            !(ctx.isPlaying && this.warmups.hasUpcomingPreplay(video))) {
          video.pause();
        }
        if (!ctx.isPlaying && !isAtPlayhead) {
          this.clipWasPlaying.delete(clip.id);
        }
        // NOTE: Do NOT pause WebCodecsPlayer here. Split clips share the same
        // player instance, so clip1 exiting and clip2 entering use the same decoder.
        // Pausing here would reset the decoder right after clip2's advanceToTime()
        // just set it up â€” causing a permanent freeze. The player's advanceToTime()
        // handles all state transitions (seek, restart) automatically.
        // syncFullWebCodecs() pauses the player when ctx.isPlaying is false.
      }

      // Pause nested comp videos not at playhead
      if (clip.isComposition && clip.nestedClips) {
        const isAtPlayhead = visibleVideoClipIdsAtTime.has(clip.id);
        if (!isAtPlayhead) {
          for (const nestedClip of clip.nestedClips) {
            const nestedVideo = this.getClipHtmlVideoElement(nestedClip);
            if (nestedVideo && !nestedVideo.paused) {
              nestedVideo.pause();
            }
          }
        }
      }
    }

    // Update track state for seamless cut transition detection
    this.handoffs.updateLastTrackState(
      ctx,
      getVisibleVideoTrackClipsAtTime(ctx),
      (clip) => this.getClipHtmlVideoElement(clip)
    );

    // Sync background layer video elements
    layerPlaybackManager.syncVideoElements(ctx.playheadPosition, ctx.isPlaying);
  }

  private syncNestedCompVideos(compClip: TimelineClip, ctx: FrameContext, depth: number = 0): void {
    this.nestedCompositionCoordinator.syncNestedCompVideos(compClip, ctx, depth);
  }

  private startTargetedWarmup(
    clipId: string,
    video: HTMLVideoElement,
    targetTime: number,
    options?: { proactive?: boolean; requestRender?: boolean; resumeAfterWarmup?: boolean }
  ): void {
    this.warmupCoordinator.startTargetedWarmup(clipId, video, targetTime, options);
  }

  /**
   * Sync a single clip's video element
   */
  private syncClipVideo(clip: TimelineClip, ctx: FrameContext): void {
    const syncMedia = resolveVideoSyncMedia(clip);

    // Handle native decoder
    if (syncMedia.nativeDecoder) {
      this.nativeDecoders.sync(clip, ctx, syncMedia.nativeDecoder);
      return;
    }

    // Full-mode WebCodecs owns preview sync whenever it's enabled.
    // Drag scrubbing uses the dedicated scrub session inside syncFullWebCodecs.
    const useFullWebCodecsPreview =
      flags.useFullWebCodecsPlayback &&
      this.getClipRuntimeProvider(clip)?.isFullMode();

    if (useFullWebCodecsPreview) {
      this.syncFullWebCodecs(clip, ctx);
      return;
    }

    const clipVideoElement = syncMedia.htmlVideoElement;
    if (!clipVideoElement) return;

    this.htmlClipCoordinator.syncHtmlClipVideo(clip, ctx, clipVideoElement);
  }

  private throttledSeek(clipId: string, video: HTMLVideoElement, time: number, ctx: FrameContext): void {
    this.htmlSeekCoordinator.throttledSeek(clipId, video, time, ctx);
  }

  private warmupUpcomingClips(ctx: FrameContext): void {
    this.warmupCoordinator.warmupUpcomingClips(ctx);
  }

  private preBufferUpcomingVideoAudio(ctx: FrameContext): void {
    this.warmupCoordinator.preBufferUpcomingVideoAudio(ctx);
  }

  private preBufferUpcomingNestedCompVideos(ctx: FrameContext): void {
    this.warmupCoordinator.preBufferUpcomingNestedCompVideos(ctx);
  }

  // --- Health Monitor Accessors ---

  getActiveRvfcClipIds(): string[] {
    return this.htmlSeeks.getActiveRvfcClipIds();
  }

  getActivePreciseSeekClipIds(): string[] {
    return this.htmlSeeks.getActivePreciseSeekClipIds();
  }

  getForceDecodeClipIds(): string[] {
    return this.forceDecodes.getClipIds();
  }

  isVideoWarmingUp(video: HTMLVideoElement): boolean {
    return this.warmups.isWarming(video);
  }

  cancelRvfcHandle(clipId: string, video?: HTMLVideoElement): void {
    this.htmlSeekCoordinator.cancelRvfcHandle(clipId, video);
  }

  clearWarmupState(video: HTMLVideoElement): void {
    this.warmupCoordinator.clearWarmupState(video);
  }

  resetClipRecoveryState(clipId: string, video?: HTMLVideoElement): void {
    this.clearHtmlSeekState(clipId, video);

    this.wcSeeks.clearPreciseSeekTimer(clipId);

    this.clipWasPlaying.delete(clipId);
    this.clipWasDragging.delete(clipId);
    this.forceDecodes.clearClip(clipId);
    this.htmlSeeks.clearSeekedFlush(clipId);
    this.handoffs.resetClip(clipId, video);
    scrubSettleState.resolve(clipId);

    this.htmlSeeks.clearLastSeekAt(clipId);
    this.recoveryCoordinator.clearClip(clipId);
    this.warmupCoordinator.clearClipRetargetState(clipId);
    this.wcSeeks.clearClip(clipId);

    if (video) {
      this.warmups.clearVideo(video);
    }
  }

  recoverClipPlaybackState(
    clipId: string,
    video: HTMLVideoElement,
    targetTime: number,
    options?: { resumePlayback?: boolean }
  ): void {
    this.resetClipRecoveryState(clipId, video);
    this.startTargetedWarmup(clipId, video, targetTime, {
      proactive: false,
      requestRender: true,
      resumeAfterWarmup: options?.resumePlayback === true,
    });
  }

  /**
   * Sync full-mode WebCodecs player.
   * Kept as a manager method so existing tests and call-sites can spy on the
   * branch, while the WebCodecs playback/scrub orchestration lives in its own
   * coordinator.
   */
  private syncFullWebCodecs(clip: TimelineClip, ctx: FrameContext): void {
    this.fullWebCodecs.syncFullWebCodecs(clip, ctx);
  }

  /**
   * Schedule a debounced precise WebCodecs seek.
   * During fast scrubbing, fastSeek shows keyframes instantly.
   * When scrubbing pauses (120ms), do a full decode for the exact frame.
   */
  schedulePreciseWcSeek(
    clipId: string,
    wcp: Parameters<VideoSyncFullWebCodecsCoordinator['schedulePreciseWcSeek']>[1],
    time: number
  ): void {
    this.fullWebCodecs.schedulePreciseWcSeek(clipId, wcp, time);
  }

}
