import type { Keyframe } from '../../types/keyframes';
import type { ClipAudioRegionGainPreview, TimelineClip, TimelineTrack } from '../../types';
import { getClipExportTailSeconds } from '../../engine/audio/exportPipeline/rangePlanning';
import { getTransitionAudioEnvelopeGain } from '../audio/audioCrossfadeGains';
import {
  getAudioCrossfadeOutgoingTrackId,
  planAudioCrossfadeFromClip,
  type AudioCrossfadePair,
} from '../audio/audioCrossfadePlanning';
import {
  addAudioCrossfadeEdgeClips,
  planAudioCrossfadePreviewWindow,
  type AudioCrossfadePreviewWindow,
  type AudioCrossfadeVoice,
} from '../audio/audioCrossfadePreviewVoices';
import { createLiveAudioRouteSettings } from '../audio/audioGraphRouteSettings';
import { getClipAudioEditPreviewVolumeMultiplier } from '../audio/clipAudioEditPreview';
import { audioRoutingManager } from '../audioRoutingManager';
import { Logger } from '../logger';
import { proxyFrameCache } from '../proxyFrameCache';
import { getAudibleStemLayers } from './audioTrackStemSyncModel';
import type { AudioSyncState, AudioSyncTarget, FrameContext } from './types';

const log = Logger.create('AudioCrossfade');

/** Upcoming incoming voices are positioned (paused, routed, gain 0) this long before they start. */
const PREPARE_LOOKAHEAD_SECONDS = 1;
const MIN_PLANNING_RANGE_SECONDS = 0.1;
/** How long after a crossfade the outgoing clip's effect tail is kept ringing at most. */
const MAX_EFFECT_TAIL_SECONDS = 10;
/** A route still missing this long after it was requested failed to build (see audioRoutingManager). */
const ROUTE_FAILURE_MS = 250;

const reported = new Set<string>();

function reportOnce(key: string, message: string, details: Record<string, unknown>): void {
  if (reported.has(key)) return;
  if (reported.size > 500) reported.clear();
  reported.add(key);
  log.warn(message, details);
}

function getVoiceRouteSettings(ctx: FrameContext, clip: TimelineClip, track: TimelineTrack, sourceTime: number) {
  return createLiveAudioRouteSettings({
    clip,
    track,
    masterAudioState: ctx.masterAudioState,
    interpolatedClipEffects: ctx.getInterpolatedEffects(clip.id, ctx.playheadPosition - clip.startTime),
    sourceTime,
  });
}

/**
 * A clip's route at the edit point, without any id (effect, processor or EQ
 * band): equal for the two halves of a split clip with the same settings.
 * Evaluated at one fixed time, so keyframed values cannot flip the result
 * while the playhead moves through the fade.
 */
function routeKeyAtEdit(ctx: FrameContext, clip: TimelineClip, track: TimelineTrack, editTime: number): string {
  const localTime = editTime - clip.startTime;
  const route = createLiveAudioRouteSettings({
    clip,
    track,
    interpolatedClipEffects: ctx.getInterpolatedEffects(clip.id, localTime),
    sourceTime: clip.inPoint + localTime,
  });
  return JSON.stringify([route.volume, route.eqGains, route.pan, route.muted, route.processors],
    (key, value: unknown) => (key === 'id' ? undefined : value));
}

/** Clips whose separated stems are audible: a crossfade window plays the source element, not the stems. */
function playsStems(clip: TimelineClip): boolean {
  return getAudibleStemLayers(clip.audioState?.stemSeparation).length > 0;
}

interface SingleVoiceDecision {
  incoming: TimelineClip;
  track: TimelineTrack;
  outgoingKeys: readonly Keyframe[] | undefined;
  incomingKeys: readonly Keyframe[] | undefined;
  singleVoice: boolean;
}

export interface AudioTrackCrossfadeTransitionSyncDeps {
  getClipAudioElement: (clip: TimelineClip) => HTMLAudioElement | null;
  getAudioProxyElementForClip: (clip: TimelineClip) => HTMLAudioElement | null;
  getClipSourceMediaFileId: (clip: TimelineClip) => string | undefined;
  isAudioSourceClip: (clip: TimelineClip) => boolean;
  /** The element a track played this clip on in the last playing frame (its own, or a cut handoff's). */
  getLastPlayedElement?: (trackId: string, clipId: string) => HTMLAudioElement | null;
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
  /** Every element the window's voices play on: no other clip pauses or removes them meanwhile. */
  retainedElements: HTMLAudioElement[];
}

/** The audio crossfades around the playhead in one sync pass. */
export interface AudioCrossfadeFrame {
  /** Active windows by track (one at a time, see planFrame): their voices replace the track's normal playback. */
  windows: Map<string, AudioCrossfadePreviewWindow>;
  /** Clips that meet at a crossfaded edit, as normal playback plays them (see addAudioCrossfadeEdgeClips). */
  edgeClips: Map<string, TimelineClip>;
  /** Clips whose element an upcoming window has positioned; prebuffering and cleanup leave them alone. */
  preparedClipIds: Set<string>;
  /** Per track: the clip and element that keep playing after the window. */
  handoffOverrides: Map<string, AudioCrossfadeHandoffOverride>;
  /** Outgoing clips whose effect tail (reverb, delay) still rings: their route stays connected. */
  tailClipIds: Set<string>;
}

export class AudioTrackCrossfadeTransitionSync {
  private readonly deps: AudioTrackCrossfadeTransitionSyncDeps;
  private preparedClipIds: ReadonlySet<string> = new Set();
  private readonly effectTails = new WeakMap<TimelineClip, { track: TimelineTrack | undefined; seconds: number }>();
  /** One decision per crossfade (keyed by its outgoing clip), kept while its clips and keyframes stay the same. */
  private readonly singleVoiceDecisions = new WeakMap<TimelineClip, SingleVoiceDecision>();
  /** Per active window (transition id): the element its outgoing voice plays on, fixed for the window. */
  private outgoingElements = new Map<string, HTMLAudioElement>();
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

  /**
   * One continuous recording with the same route on both sides plays as one
   * voice. Decided once per crossfade from the routes at the edit, so it holds
   * for the whole window (no switch between one and two voices mid-fade).
   */
  private usesSingleVoice(ctx: FrameContext, pair: AudioCrossfadePair): boolean {
    if (!pair.continuousSource) return false;
    const track = ctx.audioTracks.find((candidate) => candidate.id === pair.outgoingClip.trackId);
    if (!track) return false;
    const { outgoingClip, incomingClip } = pair;
    const outgoingKeys = ctx.getClipKeyframes?.(outgoingClip.id);
    const incomingKeys = ctx.getClipKeyframes?.(incomingClip.id);
    const cached = this.singleVoiceDecisions.get(outgoingClip);
    if (cached && cached.incoming === incomingClip && cached.track === track &&
      cached.outgoingKeys === outgoingKeys && cached.incomingKeys === incomingKeys) return cached.singleVoice;
    const edit = pair.plan.junctionTime;
    const singleVoice = routeKeyAtEdit(ctx, outgoingClip, track, edit) === routeKeyAtEdit(ctx, incomingClip, track, edit);
    this.singleVoiceDecisions.set(outgoingClip, { incoming: incomingClip, track, outgoingKeys, incomingKeys, singleVoice });
    return singleVoice;
  }

  /** Effect tail of a clip on its track, as export renders it (store clips and tracks are immutable). */
  private getEffectTailSeconds(clip: TimelineClip, track: TimelineTrack | undefined): number {
    const cached = this.effectTails.get(clip);
    if (cached && cached.track === track) return cached.seconds;
    const seconds = Math.min(MAX_EFFECT_TAIL_SECONDS, getClipExportTailSeconds(clip, track));
    this.effectTails.set(clip, { track, seconds });
    return seconds;
  }

  /** True when the last planned frame positioned this clip's element for an upcoming crossfade. */
  isPrepared(clipId: string): boolean {
    return this.preparedClipIds.has(clipId);
  }

  private collectPairs(ctx: FrameContext, frame: AudioCrossfadeFrame): AudioCrossfadePair[] {
    const playhead = ctx.playheadPosition;
    const pairs: AudioCrossfadePair[] = [];
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
      if (pair.fade.kind === 'crossfade' && (playsStems(pair.outgoingClip) || playsStems(pair.incomingClip))) {
        reportOnce(`${pair.transitionId}:stems`, 'Audio crossfade on a clip with audible separated stems: preview cuts at the edit, export renders the crossfade', {
          transitionId: pair.transitionId,
        });
        continue;
      }
      addAudioCrossfadeEdgeClips(frame.edgeClips, pair);
      pairs.push(pair);
    }
    return pairs.toSorted((a, b) => a.fade.outgoingStart - b.fade.outgoingStart);
  }

  planFrame(ctx: FrameContext): AudioCrossfadeFrame {
    const frame: AudioCrossfadeFrame = {
      windows: new Map(), edgeClips: new Map(), preparedClipIds: new Set(), handoffOverrides: new Map(), tailClipIds: new Set(),
    };
    const playhead = ctx.playheadPosition;
    const outgoingElements = new Map<string, HTMLAudioElement>();
    // One track plays one window at a time: around a short clip the later
    // crossfade's pre-roll waits until the earlier window has ended.
    const windowEnds = new Map<string, number>();
    for (const pair of this.collectPairs(ctx, frame)) {
      const trackId = pair.outgoingClip.trackId;
      const notBefore = windowEnds.get(trackId);
      const preview = planAudioCrossfadePreviewWindow(pair, { singleVoice: this.usesSingleVoice(ctx, pair), notBefore });
      if (!preview) continue;
      if (notBefore !== undefined && notBefore > pair.fade.outgoingStart + 1e-6) {
        reportOnce(`${pair.transitionId}:overlap`, 'Audio crossfades overlap on one clip: preview starts the later one where the earlier ends, export renders both', {
          transitionId: pair.transitionId, overlapSeconds: notBefore - pair.fade.outgoingStart,
        });
      }
      windowEnds.set(trackId, Math.max(notBefore ?? -Infinity, preview.end));
      if (playhead >= preview.start && playhead < preview.end) {
        frame.windows.set(trackId, preview);
        const outgoingElement = this.resolveOutgoingElement(ctx, pair);
        if (outgoingElement && ctx.isPlaying) outgoingElements.set(pair.transitionId, outgoingElement);
        const retainedElements = preview.voices
          .map((voice) => (voice.clip.id === pair.outgoingClip.id ? outgoingElement : this.getElement(voice.clip)))
          .filter((element): element is HTMLAudioElement => element !== null);
        const audioElement = preview.continuesOn.elementClip.id === pair.outgoingClip.id
          ? outgoingElement
          : this.getElement(preview.continuesOn.elementClip);
        if (audioElement) frame.handoffOverrides.set(trackId, { clip: preview.continuesOn.clip, audioElement, retainedElements });
      } else if (playhead < preview.start && preview.start - playhead <= PREPARE_LOOKAHEAD_SECONDS && ctx.isPlaying) {
        const incoming = preview.voices.find((voice) => voice.clip.id === pair.incomingClip.id);
        if (incoming) this.prepareVoice(ctx, incoming, trackId, frame);
      } else if (playhead >= preview.end && preview.voices.length > 1) {
        // The faded-out sound's echo or reverb rings on, as in export.
        const track = ctx.audioTracks.find((candidate) => candidate.id === trackId);
        if (playhead < preview.end + this.getEffectTailSeconds(pair.outgoingClip, track)) frame.tailClipIds.add(pair.outgoingClip.id);
      }
    }
    this.preparedClipIds = frame.preparedClipIds;
    this.outgoingElements = outgoingElements;
    return frame;
  }

  /**
   * The element the outgoing clip already plays on when its window starts: its
   * own, or the one a cut handoff or a split recording's crossfade passed it.
   * Kept for the whole window, so the sound never moves to a cold element.
   */
  private resolveOutgoingElement(ctx: FrameContext, pair: AudioCrossfadePair): HTMLAudioElement | null {
    if (!ctx.isPlaying) return this.getElement(pair.outgoingClip);
    return this.outgoingElements.get(pair.transitionId) ??
      this.deps.getLastPlayedElement?.(pair.outgoingClip.trackId, pair.outgoingClip.id) ??
      this.getElement(pair.outgoingClip);
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
    const { outgoingClip, incomingClip } = preview.pair;
    activeTransitionAudioClipIds.add(outgoingClip.id);
    activeTransitionAudioClipIds.add(incomingClip.id);
    for (const voice of preview.voices) {
      const { voiceClip } = voice;
      if (ctx.playheadPosition < voiceClip.startTime || ctx.playheadPosition >= voiceClip.startTime + voiceClip.duration) continue;
      const element = voice.clip.id === outgoingClip.id
        ? this.resolveOutgoingElement(ctx, preview.pair)
        : this.getElement(voice.clip);
      this.syncVoice(ctx, state, track, voice, element, regionGainPreview);
    }
  }

  private syncVoice(
    ctx: FrameContext,
    state: AudioSyncState,
    track: TimelineTrack,
    { clip, voiceClip }: AudioCrossfadeVoice,
    sourceAudioElement: HTMLAudioElement | null,
    regionGainPreview: ClipAudioRegionGainPreview | null | undefined,
  ): void {
    const clipTime = voiceClip.inPoint + (ctx.playheadPosition - voiceClip.startTime);
    const routeSettings = getVoiceRouteSettings(ctx, clip, track, clipTime);
    const playing = ctx.isPlaying && !ctx.isDraggingPlayhead;
    const sourceMediaFileId = this.deps.getClipSourceMediaFileId(clip);

    this.deps.stopStemBufferMixer(clip.id);
    this.deps.pauseStemAudioElements(clip.id);

    if (!sourceAudioElement || (!sourceAudioElement.src && sourceAudioElement.readyState === 0)) {
      if (sourceMediaFileId) void proxyFrameCache.warmScrubAudioBuffer(sourceMediaFileId);
      return;
    }
    // The voice may play on another element (a proxy, or a handoff's): the clip's own ones stay silent.
    for (const own of [this.deps.getAudioProxyElementForClip(clip), this.deps.getClipAudioElement(clip)]) {
      if (own && own !== sourceAudioElement && !own.paused) own.pause();
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
    const levelGain = !playing || routeFailed
      ? (voiceClip.transitionAudioEnvelopes ?? []).reduce((gain, envelope) => gain * getTransitionAudioEnvelopeGain(envelope, clipTime), 1)
      : 1;
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
