import type { TimelineClip } from '../../../types';
import { getRuntimeTransition, transitionIncludesAudio } from '../../../transitions';

export interface UnrenderedAudioCrossfade {
  transitionId: string;
  outgoingClipId: string;
  /** Timeline time of the edit point the crossfade is centred on. */
  junctionTime: number;
  kind: 'audio-clips' | 'linked-audio';
}

/**
 * Audio crossfades play in preview, but the audio export does not render them
 * yet: the exported sound cuts at the edit point. Lists the affected crossfades
 * in the export range so the export says so instead of failing silently.
 */
export function findUnrenderedAudioCrossfades(
  clips: readonly TimelineClip[],
  startTime: number,
  endTime: number,
): UnrenderedAudioCrossfade[] {
  const byId = new Map(clips.map(clip => [clip.id, clip]));
  const result: UnrenderedAudioCrossfade[] = [];
  for (const clip of clips) {
    const transition = clip.transitionOut;
    if (transition?.type !== 'crossfade') continue;
    const junctionTime = clip.startTime + clip.duration;
    const halfDuration = Math.max(0, transition.duration) / 2;
    if (junctionTime + halfDuration <= startTime || junctionTime - halfDuration >= endTime) continue;
    const incoming = byId.get(transition.linkedClipId);
    if (!incoming) continue;

    if (clip.source?.type === 'audio' && incoming.source?.type === 'audio') {
      result.push({ transitionId: transition.id, outgoingClipId: clip.id, junctionTime, kind: 'audio-clips' });
      continue;
    }
    const hasLinkedAudio = (candidate: TimelineClip) => {
      const linked = candidate.linkedClipId ? byId.get(candidate.linkedClipId) : undefined;
      return linked?.source?.type === 'audio';
    };
    if (
      transitionIncludesAudio(transition, getRuntimeTransition(transition.type)) &&
      hasLinkedAudio(clip) &&
      hasLinkedAudio(incoming)
    ) {
      result.push({ transitionId: transition.id, outgoingClipId: clip.id, junctionTime, kind: 'linked-audio' });
    }
  }
  return result;
}
