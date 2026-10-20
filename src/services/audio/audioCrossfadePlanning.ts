import type { TimelineClip } from '../../types';
import {
  DEFAULT_TRANSITION_PLACEMENT,
  planTransition,
  type TransitionPlan,
  type TransitionSourceDurationResolver,
} from '../../stores/timeline/editOperations/transitionPlanner';
import { getRuntimeTransition, transitionIncludesAudio } from '../../transitions';

export type AudioCrossfadeKind = 'audio-clips' | 'linked-audio';

/** One audio crossfade as preview plays it and export renders it. */
export interface AudioCrossfadePair {
  kind: AudioCrossfadeKind;
  transitionId: string;
  plan: TransitionPlan;
  /** The outgoing and incoming audio clips (for linked audio: the clips linked to the videos). */
  outgoingClip: TimelineClip;
  incomingClip: TimelineClip;
}

export interface AudioCrossfadePlanningOptions {
  /** Defaults to the preview audio-sync test: the clip source is audio. */
  isAudioSourceClip?: (clip: TimelineClip) => boolean;
  getMediaDuration?: TransitionSourceDurationResolver;
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

/**
 * Plans the audio crossfade a clip's outgoing Crossfade starts: two audio clips
 * with a Crossfade between them, or two video clips whose Crossfade has
 * "Include audio" on and whose linked audio clips share one track. The plan
 * uses the video edit point, the transition offset and the hold policy, like
 * the picture.
 */
export function planAudioCrossfadeFromClip(
  outgoing: TimelineClip,
  clips: readonly TimelineClip[],
  options: AudioCrossfadePlanningOptions = {},
): AudioCrossfadePair | null {
  const transition = outgoing.transitionOut;
  if (transition?.type !== 'crossfade') return null;
  const lookup = getClipLookup(clips);
  const incoming = lookup.get(transition.linkedClipId);
  if (!incoming) return null;
  const isAudioSourceClip = options.isAudioSourceClip ?? isAudioCrossfadeSourceClip;

  let kind: AudioCrossfadeKind;
  let outgoingAudio: TimelineClip | undefined;
  let incomingAudio: TimelineClip | undefined;
  if (isAudioSourceClip(outgoing) && isAudioSourceClip(incoming)) {
    kind = 'audio-clips';
    outgoingAudio = outgoing;
    incomingAudio = incoming;
  } else {
    if (!transitionIncludesAudio(transition, getRuntimeTransition(transition.type))) return null;
    const linkedAudio = (clip: TimelineClip) => {
      const linked = clip.linkedClipId ? lookup.get(clip.linkedClipId) : undefined;
      return linked && isAudioSourceClip(linked) ? linked : undefined;
    };
    kind = 'linked-audio';
    outgoingAudio = linkedAudio(outgoing);
    incomingAudio = linkedAudio(incoming);
    if (!outgoingAudio || !incomingAudio || outgoingAudio.trackId !== incomingAudio.trackId) return null;
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
  if (!plan) return null;
  return { kind, transitionId: transition.id, plan, outgoingClip: outgoingAudio, incomingClip: incomingAudio };
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

/** Progress 0..1 of a crossfade body at a timeline time. */
export function getAudioCrossfadeProgress(plan: Pick<TransitionPlan, 'bodyStart' | 'bodyEnd'>, time: number): number {
  const duration = plan.bodyEnd - plan.bodyStart;
  if (!(duration > 1e-6)) return 1;
  return Math.max(0, Math.min(1, (time - plan.bodyStart) / duration));
}
