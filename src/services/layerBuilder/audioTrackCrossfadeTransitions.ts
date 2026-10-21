import type { ClipAudioRegionGainPreview, TimelineClip, TimelineTrack } from '../../types';
import { getTransitionAudioEnvelopeGain } from '../audio/audioCrossfadeGains';
import {
  getAudioCrossfadeOutgoingTrackId,
  planAudioCrossfadeFromClip,
  type AudioCrossfadePair,
} from '../audio/audioCrossfadePlanning';
import {
  planAudioCrossfadeEdgeClips,
  planAudioCrossfadePreviewWindow,
  type AudioCrossfadePreviewWindow,
  type AudioCrossfadeVoice,
} from '../audio/audioCrossfadePreviewVoices';
import { createLiveAudioRouteSettings, type LiveAudioRouteSettings } from '../audio/audioGraphRouteSettings';
import { getClipAudioEditPreviewVolumeMultiplier } from '../audio/clipAudioEditPreview';
import { previewClipTailSeconds } from '../audio/preview/processedAudioPreviewSource';
import { audioRoutingManager } from '../audioRoutingManager';
import { proxyFrameCache } from '../proxyFrameCache';
import type { AudioSyncState, AudioSyncTarget, FrameContext } from './types';

/** Upcoming incoming voices are positioned (paused, routed, gain 0) this long before they start. */
const PREPARE_LOOKAHEAD_SECONDS = 1;
const MIN_PLANNING_RANGE_SECONDS = 0.1;
/** How long after a crossfade the outgoing clip's effect tail is kept ringing at most. */
const MAX_EFFECT_TAIL_SECONDS = 10;
/** A route still missing this long after it was requested failed to build (see audioRoutingManager). */
const ROUTE_FAILURE_MS = 250;

function getVoiceRouteSettings(ctx: FrameContext, clip: TimelineClip, track: TimelineTrack, sourceTime: number) {
  return createLiveAudioRouteSettings({
    clip,
    track,
    masterAudioState: ctx.masterAudioState,
    interpolatedClipEffects: ctx.getInterpolatedEffects(clip.id, ctx.playheadPosition - clip.startTime),
    sourceTime,
  });
}

/** Route settings without per-clip ids: equal for the two halves of a split clip with the same effects. */
function routeKey(route: LiveAudioRouteSettings): string {
  const withoutIds = (processors: LiveAudioRouteSettings['processors']) => processors.map(({ id: _id, ...rest }) => rest);
  return JSON.stringify([route.volume, route.eqGains, route.pan, route.muted, withoutIds(route.processors)]);
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

/** A track's handoff state while a crossfade window plays it (see AudioTrackHandoffManager). */
export interface AudioCrossfadeHandoffOverride {
  clip: TimelineClip;
  audioElement: HTMLAudioElement;
}

/** The audio crossfades around the playhead in one sync pass. */
export interface AudioCrossfadeFrame {
  /** Active windows by track: their voices replace the track's normal playback. */
  windows: Map<string, AudioCrossfadePreviewWindow>;
  /** Clips that meet at the edit: normal playback plays them with their de-click. */
  edgeClips: Map<string, TimelineClip>;
  /** Clips whose element an upcoming window has positioned; prebuffering leaves them alone. */
  preparedClipIds: Set<string>;
  /** Per track: the clip and element that keep playing after the window. */
  handoffOverrides: Map<string, AudioCrossfadeHandoffOverride>;
  /** Outgoing clips whose effect tail (reverb, delay) still rings: their route stays connected. */
  tailClipIds: Set<string>;
}

export class AudioTrackCrossfadeTransitionSync {
  private readonly deps: AudioTrackCrossfadeTransitionSyncDeps;
  private preparedClipIds: ReadonlySet<string> = new Set();
  private readonly effectTails = new WeakMap<TimelineClip, number>();
  /** When this sync first asked for an element's route (performance ms). */
  private readonly routeRequestedAt = new WeakMap<HTMLMediaElement, number>();

  constructor(deps: AudioTrackCrossfadeTransitionSyncDeps) {
    this.deps = deps;
  }

  private getElement(clip: TimelineClip): HTMLAudioElement | null {
    return this.deps.getAudioProxyElementForClip(clip) ?? this.deps.getClipAudioElement(clip);
  }

  private planPair(ctx: FrameContext, clip: TimelineClip): AudioCrossfadePair | null {
    return planAudioCrossfadeFromClip(clip, ctx.clips, {
      isAudioSourceClip: this.deps.isAudioSourceClip,
      getMediaDuration: (mediaFileId: string) => ctx.mediaFileById.get(mediaFileId)?.duration,
      getClipKeyframes: ctx.getClipKeyframes,
    });
  }

  /** One continuous recording with the same route on both sides plays as one voice. */
  private usesSingleVoice(ctx: FrameContext, pair: AudioCrossfadePair): boolean {
    if (!pair.continuousSource) return false;
    const track = ctx.audioTracks.find((candidate) => candidate.id === pair.outgoingClip.trackId);
    if (!track) return false;
    const time = (clip: TimelineClip) => clip.inPoint + (ctx.playheadPosition - clip.startTime);
    return routeKey(getVoiceRouteSettings(ctx, pair.outgoingClip, track, time(pair.outgoingClip))) ===
      routeKey(getVoiceRouteSettings(ctx, pair.incomingClip, track, time(pair.incomingClip)));
  }

  /** Effect tail of a clip (store clips are immutable, so it is cached per clip object). */
  private getEffectTailSeconds(clip: TimelineClip): number {
    let tail = this.effectTails.get(clip);
    if (tail === undefined) {
      tail = Math.min(MAX_EFFECT_TAIL_SECONDS, previewClipTailSeconds(clip));
      this.effectTails.set(clip, tail);
    }
    return tail;
  }

  /** True when the last planned frame positioned this clip's element for an upcoming crossfade. */
  isPrepared(clipId: string): boolean {
    return this.preparedClipIds.has(clipId);
  }

  planFrame(ctx: FrameContext): AudioCrossfadeFrame {
    const frame: AudioCrossfadeFrame = {
      windows: new Map(), edgeClips: new Map(), preparedClipIds: new Set(), handoffOverrides: new Map(), tailClipIds: new Set(),
    };
    const playhead = ctx.playheadPosition;
    for (const clip of ctx.clips) {
      const transition = clip.transitionOut;
      if (transition?.type !== 'crossfade') continue;
      // Skip crossfades far from the playhead or without sound before planning them.
      const junction = clip.startTime + clip.duration + (transition.offset ?? 0);
      const range = Math.max(transition.duration, MIN_PLANNING_RANGE_SECONDS);
      if (playhead < junction - range - PREPARE_LOOKAHEAD_SECONDS || playhead > junction + range + MAX_EFFECT_TAIL_SECONDS) continue;
      const trackId = getAudioCrossfadeOutgoingTrackId(clip, ctx.clips, this.deps.isAudioSourceClip);
      if (!trackId || !ctx.audioTracks.some((track) => track.id === trackId)) continue;
      // The export renders the same pairs (exportAudioCrossfades) from this planner.
      const pair = this.planPair(ctx, clip);
      if (!pair) continue;
      for (const edgeClip of planAudioCrossfadeEdgeClips(pair)) frame.edgeClips.set(edgeClip.id, edgeClip);
      const preview = planAudioCrossfadePreviewWindow(pair, { singleVoice: this.usesSingleVoice(ctx, pair) });
      if (!preview) continue;
      if (playhead >= preview.start && playhead < preview.end) {
        frame.windows.set(pair.outgoingClip.trackId, preview);
        const audioElement = this.getElement(preview.continuesOn.elementClip);
        if (audioElement) frame.handoffOverrides.set(pair.outgoingClip.trackId, { clip: preview.continuesOn.clip, audioElement });
      } else if (playhead < preview.start && preview.start - playhead <= PREPARE_LOOKAHEAD_SECONDS && ctx.isPlaying) {
        const incoming = preview.voices.find((voice) => voice.clip.id === pair.incomingClip.id);
        if (incoming) this.prepareVoice(ctx, incoming, pair.outgoingClip.trackId, frame);
      } else if (playhead >= preview.end && !preview.voices.some((voice) => voice.voiceClip.transitionAudioEnvelope?.role === 'sum')) {
        // The faded-out sound's echo or reverb rings on, as in export.
        const tail = this.getEffectTailSeconds(pair.outgoingClip);
        if (playhead < preview.end + tail) frame.tailClipIds.add(pair.outgoingClip.id);
      }
    }
    this.preparedClipIds = frame.preparedClipIds;
    return frame;
  }

  /**
   * True when a cut-style handoff from `previousClipId` to `clip` would hand
   * the incoming clip the faded-out outgoing element of a two-voice crossfade.
   */
  blocksHandoff(ctx: FrameContext, previousClipId: string, clip: TimelineClip): boolean {
    const previous = ctx.clips.find((candidate) => candidate.id === previousClipId);
    if (!previous) return false;
    const linked = previous.linkedClipId ? ctx.clips.find((candidate) => candidate.id === previous.linkedClipId) : undefined;
    for (const candidate of [previous, linked]) {
      if (candidate?.transitionOut?.type !== 'crossfade') continue;
      const pair = this.planPair(ctx, candidate);
      if (pair?.outgoingClip.id === previousClipId && pair.incomingClip.id === clip.id) {
        return pair.fade.kind === 'crossfade' && !this.usesSingleVoice(ctx, pair);
      }
    }
    return false;
  }

  /** Positions an incoming voice's element at its start, paused, routed and at gain 0. */
  private prepareVoice(ctx: FrameContext, voice: AudioCrossfadeVoice, trackId: string, frame: AudioCrossfadeFrame): void {
    const element = this.getElement(voice.clip);
    if (!element || !element.paused || (!element.src && element.readyState === 0)) return;
    frame.preparedClipIds.add(voice.clip.id);
    if (Math.abs(element.currentTime - voice.voiceClip.inPoint) > 0.05) element.currentTime = voice.voiceClip.inPoint;
    if (audioRoutingManager.hasRoute(element)) {
      audioRoutingManager.syncCutFades(element, voice.voiceClip);
      return;
    }
    const track = ctx.audioTracks.find((candidate) => candidate.id === trackId);
    if (!track || this.routeRequestedAt.has(element)) return;
    const route = getVoiceRouteSettings(ctx, voice.clip, track, voice.voiceClip.inPoint);
    this.routeRequestedAt.set(element, ctx.now);
    void audioRoutingManager.applyEffects(element, route.volume, route.eqGains, route.pan, route.processors, route.master)
      .then((routed) => { if (routed) audioRoutingManager.syncCutFades(element, voice.voiceClip); });
  }

  sync({
    ctx,
    state,
    track,
    window: preview,
    activeTransitionAudioClipIds,
    regionGainPreview,
  }: {
    ctx: FrameContext;
    state: AudioSyncState;
    track: TimelineTrack;
    window: AudioCrossfadePreviewWindow;
    activeTransitionAudioClipIds: Set<string>;
    regionGainPreview: ClipAudioRegionGainPreview | null | undefined;
  }): void {
    activeTransitionAudioClipIds.add(preview.pair.outgoingClip.id);
    activeTransitionAudioClipIds.add(preview.pair.incomingClip.id);
    for (const voice of preview.voices) {
      const { voiceClip } = voice;
      if (ctx.playheadPosition < voiceClip.startTime || ctx.playheadPosition >= voiceClip.startTime + voiceClip.duration) continue;
      this.syncVoice(ctx, state, track, voice, regionGainPreview);
    }
  }

  private syncVoice(
    ctx: FrameContext,
    state: AudioSyncState,
    track: TimelineTrack,
    { clip, voiceClip }: AudioCrossfadeVoice,
    regionGainPreview: ClipAudioRegionGainPreview | null | undefined,
  ): void {
    const clipTime = voiceClip.inPoint + (ctx.playheadPosition - voiceClip.startTime);
    const routeSettings = getVoiceRouteSettings(ctx, clip, track, clipTime);
    const playing = ctx.isPlaying && !ctx.isDraggingPlayhead;
    const sourceAudioProxy = this.deps.getAudioProxyElementForClip(clip);
    const sourceAudioElement = sourceAudioProxy ?? this.deps.getClipAudioElement(clip);
    const sourceMediaFileId = this.deps.getClipSourceMediaFileId(clip);

    this.deps.stopStemBufferMixer(clip.id);
    this.deps.pauseStemAudioElements(clip.id);

    if (!sourceAudioElement || (!sourceAudioElement.src && sourceAudioElement.readyState === 0)) {
      if (sourceMediaFileId) void proxyFrameCache.warmScrubAudioBuffer(sourceMediaFileId);
      return;
    }
    if (sourceAudioProxy) {
      const clipAudioElement = this.deps.getClipAudioElement(clip);
      if (clipAudioElement && clipAudioElement !== sourceAudioElement && !clipAudioElement.paused) clipAudioElement.pause();
    }
    if (sourceMediaFileId) {
      void proxyFrameCache.warmScrubAudioBuffer(sourceMediaFileId, sourceAudioElement.currentSrc || sourceAudioElement.src);
    }

    // During playback the ramp runs on the route's pre-effect gain, scheduled
    // on the audio clock, so the element keeps playing at gain 0 and effect
    // tails decay as in export. Scrubbing schedules nothing, and an element
    // whose route could not be built has no pre-effect gain: there the ramp
    // scales the level instead.
    const requestedAt = this.routeRequestedAt.get(sourceAudioElement);
    if (requestedAt === undefined) this.routeRequestedAt.set(sourceAudioElement, ctx.now);
    const routeFailed = !audioRoutingManager.hasRoute(sourceAudioElement) &&
      requestedAt !== undefined && ctx.now - requestedAt > ROUTE_FAILURE_MS;
    const envelope = voiceClip.transitionAudioEnvelope;
    const levelGain = envelope && (!playing || routeFailed) ? getTransitionAudioEnvelopeGain(envelope, clipTime) : 1;
    const editPreviewVolume = getClipAudioEditPreviewVolumeMultiplier(voiceClip, clipTime, regionGainPreview, playing);
    const volume = routeSettings.volume * editPreviewVolume * levelGain;

    this.deps.syncPreviewAudioElement({
      element: sourceAudioElement,
      clip: voiceClip,
      clipTime,
      absSpeed: 1,
      isMuted: !ctx.unmutedAudioTrackIds.has(track.id) || routeSettings.muted,
      canBeMaster: !state.masterSet,
      type: 'audioTrack',
      volume,
      eqGains: routeSettings.eqGains,
      pan: routeSettings.pan,
      processors: routeSettings.processors,
      masterRoute: routeSettings.master,
      meterTrackId: track.id,
    }, ctx, state);
  }
}
