import type { Keyframe } from '../../../types/keyframes';
import type { TimelineClip } from '../../../types/timeline';
import type { TransitionSourceDurationResolver } from '../../../stores/timeline/editOperations/transitionPlanner';
import {
  findAudioCrossfadePairs,
  withoutCrossfadedCutDeClick,
  type AudioCrossfadePair,
} from '../../../services/audio/audioCrossfadePlanning';
import {
  getAudioCrossfadeEnvelopes,
  planAudioCrossfadeFade,
  type AudioCrossfadeGainEnvelope,
} from '../../../services/audio/audioCrossfadeGains';
import { createClipSpeedSource } from '../../../services/timeline/retime/clipRetime';

const EDGE_EPSILON = 1e-3;

export interface ExportAudioCrossfadeNote {
  transitionId: string;
  junctionTime: number;
  reason: 'retimed-clip' | 'nested-composition';
}

export interface ExportAudioCrossfadePreparation {
  /** Clips with the outgoing tail and the incoming head extended into their handles. */
  clips: TimelineClip[];
  /** Keyframes of extended incoming clips moved with their earlier start. */
  clipKeyframes: Map<string, Keyframe[]>;
  /** Crossfade gains per clip in timeline seconds, applied before the clip's effects. */
  envelopes: Map<string, AudioCrossfadeGainEnvelope[]>;
  /** Crossfades rendered only partly, for the export log. */
  notes: ExportAudioCrossfadeNote[];
}

/** Handles map one timeline second to one source second only for clips played at normal speed. */
function canExtendIntoHandle(clip: TimelineClip, keyframes: readonly Keyframe[]): boolean {
  if (clip.isComposition || clip.reversed || clip.timeRemap) return false;
  const speed = createClipSpeedSource(clip, keyframes);
  return Math.abs(speed.speedAt(0) - 1) < 1e-6 &&
    Math.abs(speed.integrate(clip.duration) - clip.duration) < 1e-6;
}

function addEnvelope(
  envelopes: Map<string, AudioCrossfadeGainEnvelope[]>,
  clipId: string,
  envelope: AudioCrossfadeGainEnvelope,
): void {
  envelopes.set(clipId, [...(envelopes.get(clipId) ?? []), envelope]);
}

function extendOutgoingTail(clip: TimelineClip, pair: AudioCrossfadePair): TimelineClip {
  const clipEnd = clip.startTime + clip.duration;
  const tail = pair.plan.outgoing.coverage.find((range) =>
    range.kind === 'real-handle' && Math.abs(range.startTime - clipEnd) < EDGE_EPSILON
  );
  if (!tail) return clip;
  return { ...clip, duration: clip.duration + tail.duration, outPoint: tail.sourceEnd };
}

function extendIncomingHead(clip: TimelineClip, pair: AudioCrossfadePair): { clip: TimelineClip; shift: number } {
  const head = pair.plan.incoming.coverage.find((range) =>
    range.kind === 'real-handle' && Math.abs(range.endTime - clip.startTime) < EDGE_EPSILON
  );
  if (!head) return { clip, shift: 0 };
  return {
    clip: {
      ...clip,
      startTime: head.startTime,
      duration: clip.duration + head.duration,
      inPoint: head.sourceStart,
    },
    shift: head.duration,
  };
}

function hasNestedAudioCrossfade(clip: TimelineClip): boolean {
  const nestedClips = clip.isComposition ? clip.nestedClips : undefined;
  return !!nestedClips?.length && findAudioCrossfadePairs(nestedClips).length > 0;
}

/**
 * Renders audio crossfades in export like preview plays them: the same pairs,
 * plan (edit point, offset, hold policy) and fade window. The outgoing clip
 * continues into its tail handle and the incoming clip starts early from its
 * head handle; the gains fade only where both have sound, and without extra
 * sound the clips meet at the edit with a short de-click. Automatic cut
 * de-clicks at the crossfaded edges are left out, as in preview.
 */
export function prepareExportAudioCrossfades(input: {
  clips: readonly TimelineClip[];
  clipKeyframes: ReadonlyMap<string, Keyframe[]>;
  startTime: number;
  endTime: number;
  getMediaDuration?: TransitionSourceDurationResolver;
}): ExportAudioCrossfadePreparation {
  const clipsById = new Map(input.clips.map((clip) => [clip.id, clip]));
  const clipKeyframes = new Map(input.clipKeyframes);
  const envelopes = new Map<string, AudioCrossfadeGainEnvelope[]>();
  const notes: ExportAudioCrossfadeNote[] = [];

  for (const pair of findAudioCrossfadePairs(input.clips, { getMediaDuration: input.getMediaDuration })) {
    const { plan } = pair;
    if (plan.bodyEnd <= input.startTime || plan.bodyStart >= input.endTime) continue;
    const outgoing = clipsById.get(pair.outgoingClip.id);
    const incoming = clipsById.get(pair.incomingClip.id);
    if (!outgoing || !incoming) continue;

    const outgoingKeys = clipKeyframes.get(outgoing.id) ?? [];
    const incomingKeys = clipKeyframes.get(incoming.id) ?? [];
    const canExtend = canExtendIntoHandle(outgoing, outgoingKeys) && canExtendIntoHandle(incoming, incomingKeys);
    // Retimed clips cannot play their extra footage here: they meet at the edit.
    const fade = canExtend ? pair.fade : planAudioCrossfadeFade(plan, pair.fade.curve, false);
    const fadeEnvelopes = getAudioCrossfadeEnvelopes(fade);
    addEnvelope(envelopes, outgoing.id, fadeEnvelopes.outgoing);
    addEnvelope(envelopes, incoming.id, fadeEnvelopes.incoming);
    const outgoingClip = withoutCrossfadedCutDeClick(outgoing, 'outgoing');
    const incomingClip = withoutCrossfadedCutDeClick(incoming, 'incoming');
    if (!canExtend) {
      notes.push({ transitionId: pair.transitionId, junctionTime: plan.junctionTime, reason: 'retimed-clip' });
      clipsById.set(outgoing.id, outgoingClip);
      clipsById.set(incoming.id, incomingClip);
      continue;
    }
    clipsById.set(outgoing.id, extendOutgoingTail(outgoingClip, pair));
    const extended = extendIncomingHead(incomingClip, pair);
    clipsById.set(incoming.id, extended.clip);
    if (extended.shift > 0 && incomingKeys.length > 0) {
      clipKeyframes.set(incoming.id, incomingKeys.map((keyframe) => ({ ...keyframe, time: keyframe.time + extended.shift })));
    }
  }

  for (const clip of input.clips) {
    const clipEnd = clip.startTime + clip.duration;
    if (clipEnd <= input.startTime || clip.startTime >= input.endTime || !hasNestedAudioCrossfade(clip)) continue;
    notes.push({ transitionId: clip.id, junctionTime: clip.startTime, reason: 'nested-composition' });
  }

  return {
    clips: input.clips.map((clip) => clipsById.get(clip.id) ?? clip),
    clipKeyframes,
    envelopes,
    notes,
  };
}
