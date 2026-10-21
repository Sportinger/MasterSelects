import type { Keyframe } from '../../types/keyframes';
import type { TimelineClip } from '../../types/timeline';
import {
  DEFAULT_TRANSITION_PLACEMENT,
  planTransition,
  type TransitionPlan,
  type TransitionSourceDurationResolver,
} from '../../stores/timeline/editOperations/transitionPlanner';
import { getCrossfadeAudioCurve, getRuntimeTransition, getTransitionParamValue, transitionIncludesAudio } from '../../transitions';
import { Logger } from '../logger';
import { planAudioCrossfadeFade, type AudioCrossfadeFade } from './audioCrossfadeGains';
import { isAutomaticCutFade } from './automaticCutDeClick';
import { createClipSpeedSource } from '../timeline/retime/clipRetime';

const log = Logger.create('AudioCrossfade');

export type AudioCrossfadeKind = 'audio-clips' | 'linked-audio';

/** One audio crossfade as preview plays it and export renders it. */
export interface AudioCrossfadePair {
  kind: AudioCrossfadeKind;
  transitionId: string;
  plan: TransitionPlan;
  /** Where the sounds fade: only where both clips have real sound (see planAudioCrossfadeFade). */
  fade: AudioCrossfadeFade;
  /**
   * False when a clip is retimed, reversed or a composition: its extra footage
   * cannot be played in step with the timeline, so the sounds meet at the edit
   * (with a de-click) in preview and export alike.
   */
  usesHandles: boolean;
  /**
   * Both sides continue one recording (the halves of a split clip): in the
   * fade they play the same sound, so preview plays it once with both gains
   * added, and the Auto audio curve uses Equal gain.
   */
  continuousSource: boolean;
  /** The outgoing and incoming audio clips (for linked audio: the clips linked to the videos). */
  outgoingClip: TimelineClip;
  incomingClip: TimelineClip;
}

/** Why "Include audio" is on but no sound is blended. */
export type AudioCrossfadeSkipReason = 'no-linked-audio' | 'linked-audio-on-different-tracks';

export interface AudioCrossfadeResolution {
  pair: AudioCrossfadePair | null;
  skipReason?: AudioCrossfadeSkipReason;
}

export interface AudioCrossfadePlanningOptions {
  /** Defaults to the preview audio-sync test: the clip source is audio. */
  isAudioSourceClip?: (clip: TimelineClip) => boolean;
  getMediaDuration?: TransitionSourceDurationResolver;
  /** The clip's keyframes; speed keyframes make a clip retimed. */
  getClipKeyframes?: (clipId: string) => readonly Keyframe[] | undefined;
}

/**
 * Extra footage maps one timeline second to one source second only for clips
 * played forward at normal speed; others cannot crossfade through it.
 */
export function canCrossfadeThroughHandles(clip: TimelineClip, keyframes: readonly Keyframe[] = []): boolean {
  if (clip.isComposition || clip.reversed || clip.timeRemap) return false;
  const speed = createClipSpeedSource(clip, [...keyframes]);
  return Math.abs(speed.speedAt(0) - 1) < 1e-6 &&
    Math.abs(speed.integrate(clip.duration) - clip.duration) < 1e-6;
}

const CONTINUOUS_SOURCE_EPSILON_SECONDS = 0.002;

function getAudioSourceMediaId(clip: TimelineClip): string | undefined {
  return clip.source?.mediaFileId ?? clip.mediaFileId;
}

/**
 * True when the incoming clip continues the outgoing clip's recording: the same
 * media at the same source offset, both played 1:1 (`usesHandles`). Inside
 * the fade both then play exactly the same samples.
 */
export function isContinuousAudioSource(outgoing: TimelineClip, incoming: TimelineClip, usesHandles: boolean): boolean {
  const mediaId = getAudioSourceMediaId(outgoing);
  return usesHandles && !!mediaId && mediaId === getAudioSourceMediaId(incoming) &&
    Math.abs((outgoing.inPoint - outgoing.startTime) - (incoming.inPoint - incoming.startTime)) < CONTINUOUS_SOURCE_EPSILON_SECONDS;
}

/** Same rule as resolveAudioSyncMedia(clip).sourceType === 'audio' in preview audio sync. */
export function isAudioCrossfadeSourceClip(clip: TimelineClip): boolean {
  return clip.source?.type === 'audio';
}

const clipLookups = new WeakMap<readonly TimelineClip[], ReadonlyMap<string, TimelineClip>>();

function getClipLookup(clips: readonly TimelineClip[]): ReadonlyMap<string, TimelineClip> {
  let lookup = clipLookups.get(clips);
  if (!lookup) {
    lookup = new Map(clips.map((clip) => [clip.id, clip]));
    clipLookups.set(clips, lookup);
  }
  return lookup;
}

const reported = new Set<string>();

function reportOnce(key: string, report: () => void): void {
  if (reported.has(key)) return;
  if (reported.size > 500) reported.clear();
  reported.add(key);
  report();
}

/**
 * The track of the audio clip that leaves in a clip's outgoing Crossfade, or
 * undefined when the Crossfade blends no sound. Cheap, so callers can skip
 * pairs on other tracks before planning them.
 */
export function getAudioCrossfadeOutgoingTrackId(
  outgoing: TimelineClip,
  clips: readonly TimelineClip[],
  isAudioSourceClip: (clip: TimelineClip) => boolean = isAudioCrossfadeSourceClip,
): string | undefined {
  if (outgoing.transitionOut?.type !== 'crossfade') return undefined;
  if (isAudioSourceClip(outgoing)) return outgoing.trackId;
  const linked = outgoing.linkedClipId ? getClipLookup(clips).get(outgoing.linkedClipId) : undefined;
  return linked && isAudioSourceClip(linked) ? linked.trackId : undefined;
}

/**
 * Plans the audio crossfade a clip's outgoing Crossfade starts: two audio clips
 * with a Crossfade between them, or two video clips whose Crossfade has
 * "Include audio" on and whose linked audio clips share one track. The plan
 * uses the video edit point, the transition offset and the hold policy, like
 * the picture; the fade itself runs only where both sounds exist.
 */
export function resolveAudioCrossfadeFromClip(
  outgoing: TimelineClip,
  clips: readonly TimelineClip[],
  options: AudioCrossfadePlanningOptions = {},
): AudioCrossfadeResolution {
  const transition = outgoing.transitionOut;
  if (transition?.type !== 'crossfade') return { pair: null };
  const lookup = getClipLookup(clips);
  const incoming = lookup.get(transition.linkedClipId);
  if (!incoming) return { pair: null };
  const isAudioSourceClip = options.isAudioSourceClip ?? isAudioCrossfadeSourceClip;
  const definition = getRuntimeTransition(transition.type);

  let kind: AudioCrossfadeKind;
  let outgoingAudio: TimelineClip | undefined;
  let incomingAudio: TimelineClip | undefined;
  if (isAudioSourceClip(outgoing) && isAudioSourceClip(incoming)) {
    kind = 'audio-clips';
    outgoingAudio = outgoing;
    incomingAudio = incoming;
  } else {
    if (!transitionIncludesAudio(transition, definition)) return { pair: null };
    const linkedAudio = (clip: TimelineClip) => {
      const linked = clip.linkedClipId ? lookup.get(clip.linkedClipId) : undefined;
      return linked && isAudioSourceClip(linked) ? linked : undefined;
    };
    kind = 'linked-audio';
    outgoingAudio = linkedAudio(outgoing);
    incomingAudio = linkedAudio(incoming);
    if (!outgoingAudio || !incomingAudio || outgoingAudio.trackId !== incomingAudio.trackId) {
      const skipReason: AudioCrossfadeSkipReason = outgoingAudio && incomingAudio
        ? 'linked-audio-on-different-tracks'
        : 'no-linked-audio';
      reportOnce(`${transition.id}:${skipReason}`, () => log.warn(
        'Crossfade "Include audio" is on, but there is no linked sound on one track to blend; the sound cuts at the edit',
        { transitionId: transition.id, reason: skipReason },
      ));
      return { pair: null, skipReason };
    }
  }

  const plan = planTransition({
    outgoingClip: outgoingAudio,
    incomingClip: incomingAudio,
    transitionType: 'crossfade',
    requestedDuration: transition.duration,
    params: transition.params,
    placement: DEFAULT_TRANSITION_PLACEMENT,
    edgePolicy: 'hold',
    junctionTime: outgoing.startTime + outgoing.duration,
    bodyOffset: transition.offset ?? 0,
    getMediaDuration: options.getMediaDuration,
  });
  if (!plan) return { pair: null };
  const keyframesOf = (clip: TimelineClip) => options.getClipKeyframes?.(clip.id) ?? [];
  const usesHandles = canCrossfadeThroughHandles(outgoingAudio, keyframesOf(outgoingAudio)) &&
    canCrossfadeThroughHandles(incomingAudio, keyframesOf(incomingAudio));
  const continuousSource = isContinuousAudioSource(outgoingAudio, incomingAudio, usesHandles);
  const curve = getCrossfadeAudioCurve(getTransitionParamValue(transition, definition, 'audioCurve'), continuousSource);
  const fade = planAudioCrossfadeFade(plan, curve, usesHandles);
  const bodyDuration = plan.bodyEnd - plan.bodyStart;
  if (fade.overlap < bodyDuration - 1e-3) {
    reportOnce(`${transition.id}:short:${usesHandles}:${fade.overlap.toFixed(3)}`, () => log.info(
      !usesHandles
        ? 'Audio crossfade on a retimed or reversed clip: it cannot use extra footage, so the sounds meet at the edit with a short de-click'
        : fade.kind === 'declick'
          ? 'Audio crossfade has no extra sound beyond the cut; the sounds cut at the edit with a short de-click'
          : 'Audio crossfade is shorter than the transition: it fades only where both clips have sound',
      { transitionId: transition.id, transitionSeconds: bodyDuration, fadeSeconds: fade.overlap },
    ));
  }
  return {
    pair: {
      kind, transitionId: transition.id, plan, fade, usesHandles, continuousSource,
      outgoingClip: outgoingAudio, incomingClip: incomingAudio,
    },
  };
}

/**
 * True when a Crossfade at either edge of this clip may blend its sound: cheap,
 * for callers that keep such clips on one playback path (no planning).
 */
export function hasAudioCrossfadeEdge(
  clip: TimelineClip,
  clips: readonly TimelineClip[],
  isAudioSourceClip: (clip: TimelineClip) => boolean = isAudioCrossfadeSourceClip,
): boolean {
  const isCrossfade = (candidate: TimelineClip) =>
    candidate.transitionOut?.type === 'crossfade' || candidate.transitionIn?.type === 'crossfade';
  if (!isAudioSourceClip(clip)) return false;
  if (isCrossfade(clip)) return true;
  const linked = clip.linkedClipId ? getClipLookup(clips).get(clip.linkedClipId) : undefined;
  return !!linked && isCrossfade(linked);
}

export function planAudioCrossfadeFromClip(
  outgoing: TimelineClip,
  clips: readonly TimelineClip[],
  options: AudioCrossfadePlanningOptions = {},
): AudioCrossfadePair | null {
  return resolveAudioCrossfadeFromClip(outgoing, clips, options).pair;
}

export function findAudioCrossfadePairs(
  clips: readonly TimelineClip[],
  options: AudioCrossfadePlanningOptions = {},
): AudioCrossfadePair[] {
  const pairs: AudioCrossfadePair[] = [];
  for (const clip of clips) {
    const pair = planAudioCrossfadeFromClip(clip, clips, options);
    if (pair) pairs.push(pair);
  }
  return pairs;
}

/**
 * The automatic cut de-click fades sit on the original edit point. Inside a
 * crossfade the clip keeps playing past that point, so the fade at the
 * crossfaded edge (the outgoing clip's end, the incoming clip's start) would
 * cut a short hole into the middle of the crossfade; it is left out there.
 */
export function withoutCrossfadedCutDeClick(clip: TimelineClip, role: 'outgoing' | 'incoming'): TimelineClip {
  const editStack = clip.audioState?.editStack;
  if (!editStack?.length || !clip.audioState) return clip;
  const edge = role === 'outgoing' ? clip.outPoint : clip.inPoint;
  const kept = editStack.filter((operation) => {
    if (!isAutomaticCutFade(operation) || !operation.timeRange) return true;
    const rangeEdge = role === 'outgoing'
      ? Math.max(operation.timeRange.start, operation.timeRange.end)
      : Math.min(operation.timeRange.start, operation.timeRange.end);
    return Math.abs(rangeEdge - edge) > 1e-3;
  });
  return kept.length === editStack.length ? clip : { ...clip, audioState: { ...clip.audioState, editStack: kept } };
}
