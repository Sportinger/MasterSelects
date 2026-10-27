// Pure planning of the Audio sheet's Beats tab: which tracks' clips can go on the beat, their order,
// the default beat source and the step choices. The component applies them with the editor's actions.

import type { BeatRuleSourceOption } from '../../../services/compositionRules/beatRuleSource';
import type { TimelineClip, TimelineTrack } from '../../../types/timeline';

export const PHONE_BEAT_STEPS = [1, 2, 4] as const;

/** Video tracks whose clips can go on the beat (unlocked, with clips), main track (lowest) first. */
export function phoneBeatTargetTracks(tracks: readonly TimelineTrack[], clips: readonly TimelineClip[]): TimelineTrack[] {
  return tracks
    .filter((track) => track.type === 'video' && !track.locked && clips.some((clip) => clip.trackId === track.id))
    .toReversed();
}

/** Clips of a track in time order: the order the rule assigns beats in. */
export function phoneBeatClipIds(clips: readonly TimelineClip[], trackId: string): string[] {
  return clips.filter((clip) => clip.trackId === trackId).toSorted((a, b) => a.startTime - b.startTime).map((clip) => clip.id);
}

/** Default beat source: a detected grid, else a clip to detect, else the tempo map. */
export function phoneDefaultBeatSource(options: readonly BeatRuleSourceOption[]): string {
  return (options.find((option) => option.source?.kind === 'clip-beat-grid')
    ?? options.find((option) => option.analysisClipId)
    ?? options[0])?.value ?? 'tempo-map';
}
