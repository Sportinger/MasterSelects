// Pure helpers of the tracks sheet: reorder targets within a section (video among video, audio and
// MIDI among the audio section, as the editor's reorderTrack allows), height presets and the reasons
// an action cannot run. The sheet applies the editor's own track actions with them.

import type { TimelineTrack } from '../../../types/timeline';
import type { LabelColor } from '../../../stores/mediaStore/types';
import { LABEL_COLORS } from '../../panels/media/labelColors';

export type PhoneTrackSection = 'video' | 'audio';

export function phoneTrackSection(track: Pick<TimelineTrack, 'type'>): PhoneTrackSection {
  return track.type === 'video' ? 'video' : 'audio';
}

export type PhoneTrackMove = { ok: true; targetId: string; placeBelow: boolean } | { ok: false; reason: string };

/** Where `reorderTrack` must put a track to move it one place up or down inside its section. */
export function planPhoneTrackMove(tracks: readonly TimelineTrack[], trackId: string, direction: 'up' | 'down'): PhoneTrackMove {
  const track = tracks.find((candidate) => candidate.id === trackId);
  if (!track) return { ok: false, reason: 'This track no longer exists.' };
  if (track.locked) return { ok: false, reason: 'Unlock the track first.' };
  const section = tracks.filter((candidate) => phoneTrackSection(candidate) === phoneTrackSection(track));
  const index = section.findIndex((candidate) => candidate.id === trackId);
  const neighbour = section[direction === 'up' ? index - 1 : index + 1];
  if (!neighbour) {
    return { ok: false, reason: direction === 'up' ? 'This track is already at the top of its section.' : 'This track is already at the bottom of its section.' };
  }
  return { ok: true, targetId: neighbour.id, placeBelow: direction === 'down' };
}

export function phoneTrackDeleteReason(track: Pick<TimelineTrack, 'locked'>): string | null {
  return track.locked ? 'Unlock the track before deleting it.' : null;
}

export const PHONE_TRACK_HEIGHTS = [
  { id: 'small', label: 'Small', height: 32 },
  { id: 'medium', label: 'Medium', height: 60 },
  { id: 'large', label: 'Large', height: 120 },
] as const;

/** The preset closest to a height (the desktop can set any height). */
export function nearestPhoneTrackHeight(height: number): (typeof PHONE_TRACK_HEIGHTS)[number]['id'] {
  return PHONE_TRACK_HEIGHTS.reduce((best, preset) => (Math.abs(preset.height - height) < Math.abs(best.height - height) ? preset : best)).id;
}

/** The label colours offered on the phone: a subset of the desktop palette (same keys and hex). */
const PHONE_TRACK_COLOR_KEYS: ReadonlySet<LabelColor> = new Set<LabelColor>(['none', 'red', 'yellow', 'green', 'aqua', 'blue', 'purple', 'pink', 'orange', 'brown']);
export const PHONE_TRACK_COLORS = LABEL_COLORS.filter((color) => PHONE_TRACK_COLOR_KEYS.has(color.key));
