import type { ClipAudioRegionGainPreview, TimelineClip, TimelineTrack } from '../../types';
import {
  createTransitionSourceClip,
  DEFAULT_TRANSITION_PLACEMENT,
  findActiveTransitionPlanForTrack,
  planTransition,
  type ActiveTransitionPlan,
  type TransitionParticipantPlan,
} from '../../stores/timeline/editOperations/transitionPlanner';
import { getRuntimeTransition, transitionIncludesAudio } from '../../transitions';
import { createLiveAudioRouteSettings } from '../audio/audioGraphRouteSettings';
import { getClipAudioEditPreviewVolumeMultiplier } from '../audio/clipAudioEditPreview';
import { proxyFrameCache } from '../proxyFrameCache';
import { getClipTimeInfo } from './FrameContext';
import { pauseAudioElement } from './audioTrackElementUtils';
import type { AudioSyncState, AudioSyncTarget, FrameContext } from './types';

const EPSILON = 1e-6;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function getTransitionProgress(plan: ActiveTransitionPlan['plan'], time: number): number {
  const duration = plan.bodyEnd - plan.bodyStart;
  if (duration <= EPSILON) return 1;
  return clamp01((time - plan.bodyStart) / duration);
}

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

export class AudioTrackCrossfadeTransitionSync {
  private readonly deps: AudioTrackCrossfadeTransitionSyncDeps;

  constructor(deps: AudioTrackCrossfadeTransitionSyncDeps) {
    this.deps = deps;
  }

  getActiveForTrack(ctx: FrameContext, track: TimelineTrack): ActiveTransitionPlan | null {
    const getMediaDuration = (mediaFileId: string) => ctx.mediaFileById.get(mediaFileId)?.duration;
    const directAudioCrossfade = findActiveTransitionPlanForTrack({
      clips: ctx.clips,
      trackId: track.id,
      time: ctx.playheadPosition,
      placement: DEFAULT_TRANSITION_PLACEMENT,
      edgePolicy: 'hold',
      getMediaDuration,
    });
    if (
      directAudioCrossfade?.plan.transitionType === 'crossfade' &&
      this.deps.isAudioSourceClip(directAudioCrossfade.outgoingClip) &&
      this.deps.isAudioSourceClip(directAudioCrossfade.incomingClip)
    ) {
      return directAudioCrossfade;
    }

    return this.getActiveLinkedVideoAudioCrossfadeForTrack(ctx, track, getMediaDuration);
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
    activeTransition: ActiveTransitionPlan;
    activeTransitionAudioClipIds: Set<string>;
    regionGainPreview: ClipAudioRegionGainPreview | null | undefined;
  }): void {
    const progress = getTransitionProgress(activeTransition.plan, ctx.playheadPosition);
    activeTransitionAudioClipIds.add(activeTransition.outgoingClip.id);
    activeTransitionAudioClipIds.add(activeTransition.incomingClip.id);

    this.syncParticipant({
      ctx,
      state,
      track,
      clip: activeTransition.outgoingClip,
      participant: activeTransition.plan.outgoing,
      volumeMultiplier: 1 - progress,
      canBeMaster: !state.masterSet,
      regionGainPreview,
    });
    this.syncParticipant({
      ctx,
      state,
      track,
      clip: activeTransition.incomingClip,
      participant: activeTransition.plan.incoming,
      volumeMultiplier: progress,
      canBeMaster: !state.masterSet,
      regionGainPreview,
    });
  }

  private getActiveLinkedVideoAudioCrossfadeForTrack(
    ctx: FrameContext,
    track: TimelineTrack,
    getMediaDuration: (mediaFileId: string) => number | undefined,
  ): ActiveTransitionPlan | null {
    for (const outgoingVideo of ctx.clips) {
      const transition = outgoingVideo.transitionOut;
      if (!transition || transition.type !== 'crossfade') continue;

      const definition = getRuntimeTransition(transition.type);
      if (!transitionIncludesAudio(transition, definition)) continue;

      const incomingVideo = ctx.clips.find(candidate => candidate.id === transition.linkedClipId);
      if (!incomingVideo) continue;

      const outgoingAudio = this.findLinkedAudioClipOnTrack(ctx, outgoingVideo, track.id);
      const incomingAudio = this.findLinkedAudioClipOnTrack(ctx, incomingVideo, track.id);
      if (!outgoingAudio || !incomingAudio) continue;

      const plan = planTransition({
        outgoingClip: outgoingAudio,
        incomingClip: incomingAudio,
        transitionType: 'crossfade',
        requestedDuration: transition.duration,
        params: transition.params,
        placement: DEFAULT_TRANSITION_PLACEMENT,
        edgePolicy: 'hold',
        junctionTime: outgoingVideo.startTime + outgoingVideo.duration,
        bodyOffset: transition.offset ?? 0,
        getMediaDuration,
      });
      if (!plan) continue;

      if (ctx.playheadPosition >= plan.bodyStart && ctx.playheadPosition < plan.bodyEnd) {
        return { plan, outgoingClip: outgoingAudio, incomingClip: incomingAudio };
      }
    }

    return null;
  }

  private findLinkedAudioClipOnTrack(
    ctx: FrameContext,
    clip: TimelineClip,
    trackId: string,
  ): TimelineClip | undefined {
    if (!clip.linkedClipId) return undefined;
    const linkedClip = ctx.clips.find(candidate => candidate.id === clip.linkedClipId);
    return linkedClip?.trackId === trackId && this.deps.isAudioSourceClip(linkedClip)
      ? linkedClip
      : undefined;
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
