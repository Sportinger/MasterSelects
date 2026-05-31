// Shared helpers for classifying which timeline "section" a track belongs to.
//
// The timeline is split into a top video section and a bottom audio section.
// MIDI tracks (issue #182) live in the audio section and are treated like audio
// tracks for layout/ordering purposes. Centralizing this predicate keeps the
// "MIDI behaves like audio for layout" decision in one place instead of being
// duplicated as `type === 'audio' || type === 'midi'` across the render path.

import type { TimelineTrack } from '../../../types';

/** Track types that render in the bottom (audio) section of the timeline. */
export function isAudioSectionTrackType(type: TimelineTrack['type']): boolean {
  return type === 'audio' || type === 'midi';
}

/** True when the track renders in the bottom (audio) section. */
export function isAudioSectionTrack(track: Pick<TimelineTrack, 'type'>): boolean {
  return isAudioSectionTrackType(track.type);
}
