// AudioTrackSyncManager - Handles audio element synchronization with playhead
// Extracted from LayerBuilderService for separation of concerns

import type { TimelineClip, TimelineTrack } from '../../types';
import type { FrameContext, AudioSyncState, AudioSyncTarget } from './types';
import { LAYER_BUILDER_CONSTANTS } from './types';
import { createFrameContext, getClipTimeInfo, getMediaFileForClip, getClipForTrack, isVideoTrackVisible } from './FrameContext';
import { AudioSyncHandler, createAudioSyncState, finalizeAudioSync, resumeAudioContextIfNeeded } from './AudioSyncHandler';
import { proxyFrameCache } from '../proxyFrameCache';
import { layerPlaybackManager } from '../layerPlaybackManager';
import { Logger } from '../logger';
import { createLiveAudioRouteSettings, type LiveAudioRouteSettings } from '../audio/audioGraphRouteSettings';
import { getClipAudioEditPreviewVolumeMultiplier } from '../audio/clipAudioEditPreview';
import { audioRoutingManager } from '../audioRoutingManager';
import { useTimelineStore } from '../../stores/timeline';
import { createSilentAudioMeterSnapshot } from '../audio/audioMetering';
import { registerTimelineAudioPlaybackStopper } from '../audio/timelineAudioPlaybackStopper';
import { clearMasterAudio, playheadState } from './PlayheadState';
import { hydrateTimelineMediaWindow } from '../timeline/lazyMediaElements';
import { resolveAudioSyncMedia } from './audioSyncMediaResolver';
import { AudioTrackCompositionPlaybackMixdownManager } from './audioTrackCompositionPlaybackMixdowns';
import { AudioTrackHandoffManager } from './audioTrackHandoffs';
import { AudioTrackRuntimeElementManager } from './audioTrackRuntimeElements';
import { AudioTrackStemBufferMixerManager } from './audioTrackStemBufferMixers';
import { AudioTrackStemLayerBufferCache } from './audioTrackStemLayerBuffers';
import { AudioTrackStemPreviewElementManager } from './audioTrackStemPreviewElements';
import { AudioTrackPrebufferManager } from './audioTrackPrebuffering';
import { AudioTrackVideoClipAudioSync } from './audioTrackVideoClipAudioSync';
import {
  dbToLinearGain,
  pauseAudioElement,
} from './audioTrackElementUtils';
import {
  getAudibleStemLayers,
  usesSourceAudioLayer,
} from './audioTrackStemSyncModel';

const log = Logger.create('CutTransition');

function getClipAudioRouteSettings(
  ctx: FrameContext,
  clip: TimelineClip,
  track: TimelineTrack | undefined,
  clipLocalTime: number,
  clipSourceTime: number,
): LiveAudioRouteSettings {
  return createLiveAudioRouteSettings({
    clip,
    track,
    masterAudioState: ctx.masterAudioState,
    interpolatedClipEffects: ctx.getInterpolatedEffects(clip.id, clipLocalTime),
    sourceTime: clipSourceTime,
  });
}

export class AudioTrackSyncManager {
  // Sub-module
  private audioSyncHandler = new AudioSyncHandler();

  // Audio sync throttling
  private lastAudioSyncTime = 0;
  private playbackStartFrames = 0;

  private runtimeElements = new AudioTrackRuntimeElementManager();
  private stemLayerBuffers = new AudioTrackStemLayerBufferCache(this.runtimeElements);
  private stemPreviewElements = new AudioTrackStemPreviewElementManager(this.runtimeElements);
  private stemBufferMixers = new AudioTrackStemBufferMixerManager({
    getClipSourceMediaFileId: (clip) => this.getClipSourceMediaFileId(clip),
    markRuntimeActive: () => {
      this.idleStemRuntimeReleased = false;
    },
    stemLayerBuffers: this.stemLayerBuffers,
  });
  private prebuffering = new AudioTrackPrebufferManager({
    getAudioProxyElementForClip: (clip) => this.getAudioProxyElementForClip(clip),
    getClipAudioElement: (clip) => this.getClipAudioElement(clip),
    stemBufferMixers: this.stemBufferMixers,
    stemPreviewElements: this.stemPreviewElements,
  });
  private idleStemRuntimeReleased = true;

  private compositionPlaybackMixdowns = new AudioTrackCompositionPlaybackMixdownManager();
  private audioHandoffs = new AudioTrackHandoffManager();
  private videoClipAudioSync = new AudioTrackVideoClipAudioSync({
    getClipVideoElement: (clip) => this.getClipVideoElement(clip),
    getLinkedAudioClipAtPlayhead: (ctx, clip) => this.getLinkedAudioClipAtPlayhead(ctx, clip),
    getVideoAudioProxyElementForClip: (mediaFileId, clipId) =>
      this.getVideoAudioProxyElementForClip(mediaFileId, clipId),
    getClipAudioRouteSettings,
    syncPreviewAudioElement: (target, ctx, state) =>
      this.syncPreviewAudioElement(target, ctx, state),
  });

  constructor() {
    registerTimelineAudioPlaybackStopper(() => this.stopAllAudioPlayback());
  }

  private getClipAudioElement(clip: TimelineClip): HTMLAudioElement | null {
    return resolveAudioSyncMedia(clip).htmlAudioElement;
  }

  private getClipVideoElement(clip: TimelineClip): HTMLVideoElement | null {
    return resolveAudioSyncMedia(clip).htmlVideoElement;
  }

  private isAudioSourceClip(clip: TimelineClip): boolean {
    return resolveAudioSyncMedia(clip).sourceType === 'audio';
  }

  private getClipSourceMediaFileId(clip: TimelineClip): string | undefined {
    return resolveAudioSyncMedia(clip).mediaFileId ?? clip.mediaFileId;
  }

  stopAllAudioPlayback(): void {
    clearMasterAudio();
    this.audioHandoffs.reset();
    audioRoutingManager.pauseAllRoutedMedia();
    this.audioSyncHandler.stopScrubAudio();
    this.audioSyncHandler.stopAllRuntimeMeterPolling();
    const timelineState = useTimelineStore.getState();
    for (const clip of timelineState.clips) {
      pauseAudioElement(this.getClipAudioElement(clip));
      pauseAudioElement(clip.mixdownAudio);
    }

    this.runtimeElements.stopAllActiveProxies();

    this.releaseIdleStemRuntime();
    timelineState.clearStaleRuntimeAudioMeters(0, performance.now());
  }

  /**
   * Sync audio elements to current playhead
   */
  syncAudioElements(): void {
    const ctx = createFrameContext();
    hydrateTimelineMediaWindow(ctx);

    if (!ctx.isPlaying && !ctx.isDraggingPlayhead) {
      this.releaseIdleStemRuntime();
    }

    // At non-standard playback speeds (reverse or fast-forward), mute all audio
    // Audio can't play backwards and fast-forward sounds bad
    if (ctx.playbackSpeed !== 1 && ctx.isPlaying) {
      this.muteAllAudio(ctx);
      useTimelineStore.getState().clearStaleRuntimeAudioMeters(0, ctx.now);
      return;
    }

    // Handle playback start
    const isStartup = playheadState.playbackJustStarted;
    if (isStartup) {
      this.playbackStartFrames++;
      if (this.playbackStartFrames > 10) {
        playheadState.playbackJustStarted = false;
        this.playbackStartFrames = 0;
      }
    } else {
      // Throttle audio sync
      if (ctx.now - this.lastAudioSyncTime < LAYER_BUILDER_CONSTANTS.AUDIO_SYNC_INTERVAL) {
        return;
      }
    }
    this.lastAudioSyncTime = ctx.now;

    // Resume audio context if needed
    resumeAudioContextIfNeeded(ctx.isPlaying, ctx.isDraggingPlayhead);
    if (!ctx.isPlaying || ctx.isDraggingPlayhead || ctx.playbackSpeed !== 1) {
      this.audioHandoffs.reset();
      this.stemBufferMixers.stopAll();
    }
    if (!ctx.isDraggingPlayhead) {
      this.audioSyncHandler.resetScrubState();
      if (!ctx.isPlaying) {
        this.audioSyncHandler.stopScrubAudio();
      }
    }

    // Compute audio handoffs for seamless cut transitions only while playing.
    // Paused/stopped sync must not retain stale proxy elements across resumes.
    if (ctx.isPlaying && !ctx.isDraggingPlayhead) {
      this.audioHandoffs.compute(
        ctx,
        (clip) => this.getAudioProxyElementForClip(clip) ?? this.getClipAudioElement(clip),
        (clip) => this.getClipSourceMediaFileId(clip)
      );
    }

    // Create sync state
    const state = createAudioSyncState();

    // Sync audio track clips
    this.syncAudioTrackClips(ctx, state);

    // Sync video clip audio (proxies and elements)
    this.syncVideoClipAudio(ctx, state);

    // Sync nested comp mixdown
    this.syncNestedCompMixdown(ctx, state);

    // Pause inactive audio
    this.pauseInactiveAudio(ctx);

    // Update audio track state for next frame's handoff detection only during playback.
    if (ctx.isPlaying && !ctx.isDraggingPlayhead) {
      this.audioHandoffs.updateLastTrackState(
        ctx,
        (clip) => this.getAudioProxyElementForClip(clip) ?? this.getClipAudioElement(clip),
        (clip) => this.getClipSourceMediaFileId(clip)
      );
    }

    // Pre-buffer audio for upcoming clips (audio lookahead)
    this.prebuffering.preBufferUpcomingAudio(ctx);

    // Sync background layer audio elements
    layerPlaybackManager.syncAudioElements(ctx.playheadPosition, ctx.isPlaying);

    // Finalize
    finalizeAudioSync(state, ctx.isPlaying);
    useTimelineStore.getState().clearStaleRuntimeAudioMeters(650, ctx.now);
  }

  private syncPreviewAudioElement(
    target: AudioSyncTarget,
    ctx: FrameContext,
    state: AudioSyncState,
  ): void {
    this.audioSyncHandler.syncAudioElement(target, ctx, state);
  }

  /**
   * Sync audio track clips
   */
  private syncAudioTrackClips(ctx: FrameContext, state: AudioSyncState): void {
    const regionGainPreview = useTimelineStore.getState().audioRegionGainPreview;
    for (const track of ctx.audioTracks) {
      const clip = getClipForTrack(ctx, track.id);
      if (!clip?.source) continue;

      const timeInfo = getClipTimeInfo(ctx, clip);
      const routeSettings = getClipAudioRouteSettings(ctx, clip, track, timeInfo.clipLocalTime, timeInfo.clipTime);
      const editPreviewVolume = getClipAudioEditPreviewVolumeMultiplier(clip, timeInfo.clipTime, regionGainPreview);
      const effectiveVolume = routeSettings.volume * editPreviewVolume;
      const trackMuted = !ctx.unmutedAudioTrackIds.has(track.id) || routeSettings.muted || effectiveVolume <= 0.01;
      const stemSeparation = clip.audioState?.stemSeparation;
      const audibleStemLayers = getAudibleStemLayers(stemSeparation);
      const shouldUseStemAudio = audibleStemLayers.length > 0;
      const shouldUseSourceAudio = usesSourceAudioLayer(stemSeparation);
      const sourceGain = dbToLinearGain(stemSeparation?.sourceGainDb);
      if (shouldUseStemAudio && (ctx.isPlaying || ctx.isDraggingPlayhead)) {
        this.idleStemRuntimeReleased = false;
      }
      const shouldPreferStemBufferMixer = Boolean(
        stemSeparation &&
        ctx.isPlaying &&
        !ctx.isDraggingPlayhead &&
        shouldUseStemAudio &&
        this.stemBufferMixers.canUseRouteSettings(routeSettings, timeInfo.absSpeed, timeInfo.speed) &&
        this.stemBufferMixers.canUseForStemSet(stemSeparation, audibleStemLayers),
      );
      if (stemSeparation && ctx.isPlaying && !ctx.isDraggingPlayhead && shouldPreferStemBufferMixer) {
        const canBeStemMaster = !state.masterSet;
        const mixerSourceCount = this.stemBufferMixers.sync({
          clip,
          stemSeparation,
          audibleStemLayers,
          shouldUseSourceAudio,
          sourceGain,
          routeSettings,
          timeInfo,
          effectiveVolume,
          trackMuted,
          meterTrackId: track.id,
          canBeMaster: canBeStemMaster,
        });
        if (mixerSourceCount > 0) {
          this.audioSyncHandler.stopRuntimeMeterPolling(track.id);
          this.runtimeElements.removeAudioTrackProxy(clip.id);
          this.pauseAndDisposeRoute(this.getClipAudioElement(clip));
          this.stemPreviewElements.pauseStemAudioElements(clip.id);
          state.audioPlayingCount += mixerSourceCount;
          if (canBeStemMaster) state.masterSet = true;
          continue;
        }
      }

      if (stemSeparation && !shouldUseStemAudio) {
        this.disposeStemPreviewAudioSet(clip.id);
      }
      const needsStemAudioElements = shouldUseStemAudio && (
        ctx.isDraggingPlayhead ||
        ctx.isPlaying
      );
      if (shouldUseStemAudio && !needsStemAudioElements) {
        this.disposeStemPreviewAudioSet(clip.id);
      }
      const stemAudioElements = needsStemAudioElements ? this.stemPreviewElements.getStemAudioElements(clip) : null;
      const stemAudioReady = audibleStemLayers.every(stem => Boolean(stemAudioElements?.get(stem.id)?.element));
      if (needsStemAudioElements && !stemAudioReady && !shouldUseSourceAudio) {
        this.runtimeElements.pauseAudioTrackProxy(clip.id);
        pauseAudioElement(this.getClipAudioElement(clip));
        this.publishSilentStemMeter(track.id, ctx.now);
        continue;
      }

      const needsSourceElement = !stemSeparation || shouldUseSourceAudio;
      const compositionAudioElement = needsSourceElement
        ? this.compositionPlaybackMixdowns.ensureCompositionAudioPlaybackElement(clip, 'source')
        : null;
      const sourceAudioProxy = needsSourceElement ? this.getAudioProxyElementForClip(clip) : null;
      const sourceAudioElement = sourceAudioProxy ?? compositionAudioElement ?? this.getClipAudioElement(clip);
      const sourceMediaFileId = needsSourceElement ? this.getClipSourceMediaFileId(clip) : undefined;
      const canUseSourceBufferMixer = Boolean(
        sourceMediaFileId &&
        needsSourceElement &&
        ctx.isPlaying &&
        !ctx.isDraggingPlayhead &&
        this.stemBufferMixers.canUseRouteSettings(routeSettings, timeInfo.absSpeed, timeInfo.speed),
      );
      const sourceAudioBuffer = sourceMediaFileId && canUseSourceBufferMixer
        ? proxyFrameCache.getCachedAudioBuffer(sourceMediaFileId)
        : null;

      if (canUseSourceBufferMixer && sourceMediaFileId && sourceAudioBuffer) {
        const canBeSourceMaster = !state.masterSet;
        const mixerSourceCount = this.stemBufferMixers.syncSource({
          clip,
          mediaFileId: sourceMediaFileId,
          buffer: sourceAudioBuffer,
          routeSettings,
          timeInfo,
          effectiveVolume,
          sourceGain,
          trackMuted,
          meterTrackId: track.id,
          canBeMaster: canBeSourceMaster,
        });
        if (mixerSourceCount > 0) {
          this.audioSyncHandler.stopRuntimeMeterPolling(track.id);
          this.runtimeElements.removeAudioTrackProxy(clip.id);
          this.pauseAndDisposeRoute(sourceAudioElement);
          const clipAudioElement = this.getClipAudioElement(clip);
          if (clipAudioElement !== sourceAudioElement) {
            this.pauseAndDisposeRoute(clipAudioElement);
          }
          this.stemPreviewElements.pauseStemAudioElements(clip.id);
          state.audioPlayingCount += mixerSourceCount;
          if (canBeSourceMaster) state.masterSet = true;
          continue;
        }
      }

      if (needsSourceElement) {
        if (!sourceAudioElement) {
          if (canUseSourceBufferMixer && sourceMediaFileId) {
            void proxyFrameCache.warmScrubAudioBuffer(sourceMediaFileId);
          }
          this.stemBufferMixers.stop(clip.id);
          continue;
        }

        if (this.shouldSuppressLinkedAudioClipScrub(ctx, clip)) {
          if (!sourceAudioElement.paused) {
            sourceAudioElement.pause();
          }
          continue;
        }

        // Skip audio elements without a valid source (e.g., empty audio from nested comps without audio)
        if (!sourceAudioElement.src && sourceAudioElement.readyState === 0) {
          this.stemBufferMixers.stop(clip.id);
          continue;
        }
        if (canUseSourceBufferMixer && sourceMediaFileId) {
          void proxyFrameCache.warmScrubAudioBuffer(sourceMediaFileId, sourceAudioElement.currentSrc || sourceAudioElement.src);
        }
      }

      this.stemBufferMixers.stop(clip.id);

      if (sourceAudioProxy) {
        const clipAudioElement = this.getClipAudioElement(clip);
        if (clipAudioElement && !clipAudioElement.paused) {
          clipAudioElement.pause();
        }
      }
      if (!shouldUseSourceAudio) {
        pauseAudioElement(sourceAudioElement);
        this.runtimeElements.removeAudioTrackProxy(clip.id);
      }

      // Use handoff element if available (seamless cut transition)
      const handoffAudio = this.audioHandoffs.getHandoffAudioElement(clip.id);
      if (shouldUseSourceAudio && sourceAudioElement) {
        this.syncPreviewAudioElement({
          element: handoffAudio ?? sourceAudioElement,
          clip,
          clipTime: timeInfo.clipTime,
          absSpeed: timeInfo.absSpeed,
          isMuted: trackMuted,
          canBeMaster: true,
          type: 'audioTrack',
          volume: effectiveVolume * sourceGain,
          eqGains: routeSettings.eqGains,
          pan: routeSettings.pan,
          processors: routeSettings.processors,
          masterRoute: routeSettings.master,
          meterTrackId: track.id,
        }, ctx, state);
      }

      if (stemAudioElements && stemSeparation) {
        const audibleStemIds = new Set(audibleStemLayers.map(stem => stem.id));
        let stemMeterAssigned = shouldUseSourceAudio;
        let stemMasterAssigned = shouldUseSourceAudio;
        for (const stem of stemSeparation.stems) {
          const stemAudio = stemAudioElements.get(stem.id)?.element;
          if (!stemAudio) continue;
          const stemIsAudible = audibleStemIds.has(stem.id);
          if (!stemIsAudible) {
            pauseAudioElement(stemAudio);
            audioRoutingManager.removeRoute(stemAudio);
            continue;
          }

          const canBeStemMaster = !stemMasterAssigned && stemIsAudible;
          if (canBeStemMaster) stemMasterAssigned = true;
          const meterTrackId = !stemMeterAssigned ? track.id : undefined;
          if (meterTrackId) stemMeterAssigned = true;

          this.syncPreviewAudioElement({
            element: stemAudio,
            clip,
            clipTime: timeInfo.clipTime,
            absSpeed: timeInfo.absSpeed,
            isMuted: trackMuted || !stemIsAudible,
            canBeMaster: canBeStemMaster,
            type: 'stemAudioTrack',
            volume: stemIsAudible ? effectiveVolume * dbToLinearGain(stem.gainDb) : 0,
            eqGains: routeSettings.eqGains,
            pan: routeSettings.pan,
            processors: routeSettings.processors,
            masterRoute: routeSettings.master,
            meterTrackId,
          }, ctx, state);
        }
      }
    }
  }

  /**
   * Sync video clip audio (proxies and varispeed scrubbing)
   */
  private syncVideoClipAudio(ctx: FrameContext, state: AudioSyncState): void {
    const activeVideoClipIds = this.videoClipAudioSync.sync(ctx, state);
    this.runtimeElements.removeVideoAudioProxiesNotIn(activeVideoClipIds);
  }

  /**
   * Sync nested composition mixdown audio
   */
  private syncNestedCompMixdown(ctx: FrameContext, state: AudioSyncState): void {
    for (const clip of ctx.clipsAtTime) {
      if (!clip.isComposition || this.hasActiveLinkedCompositionAudioClip(ctx, clip)) continue;
      const mixdownAudio = clip.mixdownAudio ??
        this.compositionPlaybackMixdowns.ensureCompositionAudioPlaybackElement(clip, 'mixdown');
      if (!mixdownAudio || clip.hasMixdownAudio === false) continue;

      const timeInfo = getClipTimeInfo(ctx, clip);
      const track = ctx.videoTracks.find(t => t.id === clip.trackId);
      const isMuted = track ? !isVideoTrackVisible(ctx, track.id) : false;
      const routeSettings = getClipAudioRouteSettings(ctx, clip, track, timeInfo.clipLocalTime, timeInfo.clipTime);

      this.syncPreviewAudioElement({
        element: mixdownAudio,
        clip,
        clipTime: timeInfo.clipTime,
        absSpeed: timeInfo.absSpeed,
        isMuted: isMuted || routeSettings.muted,
        canBeMaster: !state.masterSet,
        type: 'mixdown',
        volume: routeSettings.volume,
        eqGains: routeSettings.eqGains,
        pan: routeSettings.pan,
        processors: routeSettings.processors,
        masterRoute: routeSettings.master,
        meterTrackId: track?.id,
      }, ctx, state);
    }
  }

  private hasActiveLinkedCompositionAudioClip(ctx: FrameContext, clip: TimelineClip): boolean {
    if (!clip.linkedClipId) return false;
    const linkedClip = ctx.clipsAtTime.find(candidate => candidate.id === clip.linkedClipId);
    return linkedClip?.isComposition === true &&
      linkedClip.compositionId === clip.compositionId &&
      this.isAudioSourceClip(linkedClip);
  }

  /**
   * Pause audio not at playhead
   */
  private pauseInactiveAudio(ctx: FrameContext): void {
    const activeClipIds = new Set(ctx.clipsAtTime.map(clip => clip.id));
    const knownClipIds = new Set(ctx.clips.map(clip => clip.id));
    for (const clip of ctx.clips) {
      const isAtPlayhead = activeClipIds.has(clip.id);

      const clipAudioElement = this.getClipAudioElement(clip);
      if (clipAudioElement && !isAtPlayhead && !clipAudioElement.paused
          && !this.audioHandoffs.hasHandoffElement(clipAudioElement)) {
        clipAudioElement.pause();
      }

      const audioTrackProxy = this.runtimeElements.getAudioTrackProxy(clip.id);
      if (audioTrackProxy && !isAtPlayhead) {
        this.runtimeElements.removeAudioTrackProxy(clip.id, {
          shouldPause: element => element.paused || !this.audioHandoffs.hasHandoffElement(element),
        });
      }

      if (clip.mixdownAudio && !isAtPlayhead && !clip.mixdownAudio.paused) {
        clip.mixdownAudio.pause();
      }
    }

    this.stemPreviewElements.pauseInactiveStemAudioElements({
      activeClipIds,
      knownClipIds,
      shouldDisposeInactive: !ctx.isPlaying && !ctx.isDraggingPlayhead,
      onInactiveClip: (clipId) => this.stemBufferMixers.stop(clipId),
    });

    this.stemBufferMixers.stopInactiveMixers(knownClipIds, activeClipIds, ctx.isPlaying);

    this.runtimeElements.removeAudioTrackProxiesNotIn(knownClipIds);
  }

  /**
   * Mute all audio during non-standard playback (reverse or fast-forward)
   * Audio can't play backwards and fast-forward audio sounds bad
   */
  private muteAllAudio(ctx: FrameContext): void {
    // Clear master audio since we're not using audio sync
    clearMasterAudio();
    this.audioHandoffs.reset();

    // Pause all audio elements
    for (const clip of ctx.clips) {
      const clipAudioElement = this.getClipAudioElement(clip);
      if (clipAudioElement && !clipAudioElement.paused) {
        clipAudioElement.pause();
      }
      const clipVideoElement = this.getClipVideoElement(clip);
      if (clipVideoElement && !clipVideoElement.muted) {
        clipVideoElement.muted = true;
      }
      if (clip.mixdownAudio && !clip.mixdownAudio.paused) {
        clip.mixdownAudio.pause();
      }
    }
    this.stemPreviewElements.pauseAllStemAudioElements();
    this.runtimeElements.pauseAllActiveProxies();
    this.stemBufferMixers.stopAll();
  }

  private getLinkedAudioClipAtPlayhead(ctx: FrameContext, clip: TimelineClip): TimelineClip | undefined {
    if (!clip.linkedClipId) return undefined;

    const linkedClip = ctx.clipsAtTime.find(c => c.id === clip.linkedClipId);
    return linkedClip && this.isAudioSourceClip(linkedClip) ? linkedClip : undefined;
  }

  private getLinkedVideoClipAtPlayhead(ctx: FrameContext, clip: TimelineClip): TimelineClip | undefined {
    if (!clip.linkedClipId) return undefined;

    const linkedClip = ctx.clipsAtTime.find(c => c.id === clip.linkedClipId);
    return linkedClip && this.getClipVideoElement(linkedClip) && !linkedClip.isComposition ? linkedClip : undefined;
  }

  private getAudioProxyElementForClip(clip: TimelineClip): HTMLAudioElement | null {
    const mediaFileId = this.getClipSourceMediaFileId(clip);
    return this.runtimeElements.getAudioTrackProxyForClip(mediaFileId, clip.id);
  }

  private pauseAndDisposeRoute(element: HTMLMediaElement | null | undefined): void {
    if (!element) return;
    pauseAudioElement(element);
    audioRoutingManager.disposeRoute(element);
  }

  private getVideoAudioProxyElementForClip(mediaFileId: string, clipId: string): HTMLAudioElement | null {
    return this.runtimeElements.getVideoAudioProxyForClip(mediaFileId, clipId);
  }

  private shouldSuppressLinkedAudioClipScrub(ctx: FrameContext, clip: TimelineClip): boolean {
    if (!ctx.isDraggingPlayhead || !clip.linkedClipId) {
      return false;
    }

    const linkedVideoClip = this.getLinkedVideoClipAtPlayhead(ctx, clip);
    if (!linkedVideoClip) {
      return false;
    }

    const mediaFile = getMediaFileForClip(ctx, linkedVideoClip);
    const mediaFileId = mediaFile?.id || linkedVideoClip.mediaFileId || linkedVideoClip.id;
    return proxyFrameCache.hasAudioBuffer(mediaFileId);
  }

  private releaseIdleStemRuntime(): void {
    const hasStemRuntime =
      this.stemLayerBuffers.hasRuntime() ||
      this.stemPreviewElements.hasRuntime() ||
      this.stemBufferMixers.hasRuntime();

    if (this.idleStemRuntimeReleased && !hasStemRuntime) {
      return;
    }

    this.stemBufferMixers.releaseIdleRuntime((error) => {
      log.warn('Failed to close idle stem mixer context', error);
    });
    this.stemPreviewElements.disposeAllStemAudioSets();
    this.stemLayerBuffers.clear();

    this.idleStemRuntimeReleased = true;
  }

  private disposeStemPreviewAudioSet(clipId: string): void {
    this.stemBufferMixers.stop(clipId);
    this.stemPreviewElements.disposeStemAudioSet(clipId);
  }

  private publishSilentStemMeter(trackId: string, now: number): void {
    const silent = createSilentAudioMeterSnapshot(now);
    useTimelineStore.getState().updateRuntimeAudioMeter(trackId, silent, silent);
  }
}
