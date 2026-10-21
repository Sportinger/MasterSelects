import type { ClipAudioRegionGainPreview, TimelineClip, TimelineTrack } from '../../types';
import {
  createTransitionSourceClip,
  type ActiveTransitionPlan,
  type TransitionParticipantPlan,
} from '../../stores/timeline/editOperations/transitionPlanner';
import { getAudioCrossfadeGainsAt, type AudioCrossfadeFade } from '../audio/audioCrossfadeGains';
import {
  getAudioCrossfadeOutgoingTrackId,
  planAudioCrossfadeFromClip,
  withoutCrossfadedCutDeClick,
} from '../audio/audioCrossfadePlanning';
import { createLiveAudioRouteSettings } from '../audio/audioGraphRouteSettings';
import { getClipAudioEditPreviewVolumeMultiplier } from '../audio/clipAudioEditPreview';
import { proxyFrameCache } from '../proxyFrameCache';
import { getClipTimeInfo } from './FrameContext';
import { pauseAudioElement } from './audioTrackElementUtils';
import type { AudioSyncState, AudioSyncTarget, FrameContext } from './types';

function getCrossfadeAudioRouteSettings(
  ctx: FrameContext,
  clip: TimelineClip,
  track: TimelineTrack,
  clipLocalTime: number,
  clipSourceTime: number,
) {
  return createLiveAudioRouteSettings({
    clip,
    track,
    masterAudioState: ctx.masterAudioState,
    interpolatedClipEffects: ctx.getInterpolatedEffects(clip.id, clipLocalTime),
    sourceTime: clipSourceTime,
  });
}

export interface AudioTrackCrossfadeTransitionSyncDeps {
  getClipAudioElement: (clip: TimelineClip) => HTMLAudioElement | null;
  getAudioProxyElementForClip: (clip: TimelineClip) => HTMLAudioElement | null;
  getClipSourceMediaFileId: (clip: TimelineClip) => string | undefined;
  isAudioSourceClip: (clip: TimelineClip) => boolean;
  pauseAudioTrackProxy: (clipId: string) => void;
  stopStemBufferMixer: (clipId: string) => void;
  pauseStemAudioElements: (clipId: string) => void;
  syncPreviewAudioElement: (
    target: AudioSyncTarget,
    ctx: FrameContext,
    state: AudioSyncState,
  ) => void;
}

/** An active audio crossfade with the window its sounds fade over. */
export interface ActiveAudioCrossfade extends ActiveTransitionPlan {
  fade: AudioCrossfadeFade;
}

export class AudioTrackCrossfadeTransitionSync {
  private readonly deps: AudioTrackCrossfadeTransitionSyncDeps;

  constructor(deps: AudioTrackCrossfadeTransitionSyncDeps) {
    this.deps = deps;
  }

  getActiveForTrack(ctx: FrameContext, track: TimelineTrack): ActiveAudioCrossfade | null {
    const options = {
      isAudioSourceClip: this.deps.isAudioSourceClip,
      getMediaDuration: (mediaFileId: string) => ctx.mediaFileById.get(mediaFileId)?.duration,
    };
    for (const clip of ctx.clips) {
      const transition = clip.transitionOut;
      if (transition?.type !== 'crossfade') continue;
      // Skip crossfades far from the playhead or on other tracks before planning them.
      const junction = clip.startTime + clip.duration + (transition.offset ?? 0);
      if (Math.abs(ctx.playheadPosition - junction) > Math.max(transition.duration, 0.1)) continue;
      if (getAudioCrossfadeOutgoingTrackId(clip, ctx.clips, this.deps.isAudioSourceClip) !== track.id) continue;
      // The export renders the same pairs (exportAudioCrossfades) from this planner.
      const pair = planAudioCrossfadeFromClip(clip, ctx.clips, options);
      if (!pair || pair.outgoingClip.trackId !== track.id) continue;
      if (ctx.playheadPosition >= pair.plan.bodyStart && ctx.playheadPosition < pair.plan.bodyEnd) {
        return { plan: pair.plan, fade: pair.fade, outgoingClip: pair.outgoingClip, incomingClip: pair.incomingClip };
      }
    }
    return null;
  }

  sync({
    ctx,
    state,
    track,
    activeTransition,
    activeTransitionAudioClipIds,
    regionGainPreview,
  }: {
    ctx: FrameContext;
    state: AudioSyncState;
    track: TimelineTrack;
    activeTransition: ActiveAudioCrossfade;
    activeTransitionAudioClipIds: Set<string>;
    regionGainPreview: ClipAudioRegionGainPreview | null | undefined;
  }): void {
    const gains = getAudioCrossfadeGainsAt(activeTransition.fade, ctx.playheadPosition);
    activeTransitionAudioClipIds.add(activeTransition.outgoingClip.id);
    activeTransitionAudioClipIds.add(activeTransition.incomingClip.id);

    this.syncParticipant({
      ctx,
      state,
      track,
      clip: withoutCrossfadedCutDeClick(activeTransition.outgoingClip, 'outgoing'),
      participant: activeTransition.plan.outgoing,
      volumeMultiplier: gains.outgoing,
      canBeMaster: !state.masterSet,
      regionGainPreview,
    });
    this.syncParticipant({
      ctx,
      state,
      track,
      clip: withoutCrossfadedCutDeClick(activeTransition.incomingClip, 'incoming'),
      participant: activeTransition.plan.incoming,
      volumeMultiplier: gains.incoming,
      canBeMaster: !state.masterSet,
      regionGainPreview,
    });
  }

  private syncParticipant({
    ctx,
    state,
    track,
    clip,
    participant,
    volumeMultiplier,
    canBeMaster,
    regionGainPreview,
  }: {
    ctx: FrameContext;
    state: AudioSyncState;
    track: TimelineTrack;
    clip: TimelineClip;
    participant: TransitionParticipantPlan;
    volumeMultiplier: number;
    canBeMaster: boolean;
    regionGainPreview: ClipAudioRegionGainPreview | null | undefined;
  }): void {
    if (volumeMultiplier <= 0.001) {
      pauseAudioElement(this.deps.getClipAudioElement(clip));
      this.deps.pauseAudioTrackProxy(clip.id);
      return;
    }

    const sourceClip = createTransitionSourceClip(clip, participant, ctx.playheadPosition);
    const timeInfo = getClipTimeInfo(ctx, sourceClip);
    const routeSettings = getCrossfadeAudioRouteSettings(
      ctx,
      sourceClip,
      track,
      timeInfo.clipLocalTime,
      timeInfo.clipTime,
    );
    const editPreviewVolume = getClipAudioEditPreviewVolumeMultiplier(
      sourceClip,
      timeInfo.clipTime,
      regionGainPreview,
      ctx.isPlaying && !ctx.isDraggingPlayhead,
    );
    const effectiveVolume = routeSettings.volume * editPreviewVolume * volumeMultiplier;
    const trackMuted = !ctx.unmutedAudioTrackIds.has(track.id) || routeSettings.muted || effectiveVolume <= 0.01;
    const sourceAudioProxy = this.deps.getAudioProxyElementForClip(sourceClip);
    const sourceAudioElement = sourceAudioProxy ?? this.deps.getClipAudioElement(sourceClip);
    const sourceMediaFileId = this.deps.getClipSourceMediaFileId(sourceClip);

    this.deps.stopStemBufferMixer(clip.id);
    this.deps.pauseStemAudioElements(clip.id);

    if (!sourceAudioElement) {
      if (sourceMediaFileId) {
        void proxyFrameCache.warmScrubAudioBuffer(sourceMediaFileId);
      }
      return;
    }

    if (sourceAudioProxy) {
      const clipAudioElement = this.deps.getClipAudioElement(sourceClip);
      if (clipAudioElement && clipAudioElement !== sourceAudioElement && !clipAudioElement.paused) {
        clipAudioElement.pause();
      }
    }

    if (!sourceAudioElement.src && sourceAudioElement.readyState === 0) {
      if (sourceMediaFileId) {
        void proxyFrameCache.warmScrubAudioBuffer(sourceMediaFileId);
      }
      return;
    }

    if (sourceMediaFileId) {
      void proxyFrameCache.warmScrubAudioBuffer(
        sourceMediaFileId,
        sourceAudioElement.currentSrc || sourceAudioElement.src,
      );
    }

    this.deps.syncPreviewAudioElement({
      element: sourceAudioElement,
      clip: sourceClip,
      clipTime: timeInfo.clipTime,
      absSpeed: timeInfo.absSpeed,
      isMuted: trackMuted,
      canBeMaster,
      type: 'audioTrack',
      volume: effectiveVolume,
      eqGains: routeSettings.eqGains,
      pan: routeSettings.pan,
      processors: routeSettings.processors,
      masterRoute: routeSettings.master,
      meterTrackId: track.id,
    }, ctx, state);
  }
}
