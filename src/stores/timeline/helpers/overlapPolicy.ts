// Track overlap policy (issue #232).
//
// Single source of truth for how clips behave when they are dropped overlapping
// another clip on the SAME track:
//
//   - 'trim'  : the dropped clip "eats" the overlapped region of the clip
//               underneath (trim/delete/split). Current behavior for video.
//   - 'avoid' : clips may not overlap. The mover is placed in nearby free
//               space, on another compatible track, or on a new track.
//   - 'stack' : clips are allowed to coexist; nothing is trimmed and both clips
//               keep playing. Default for MIDI tracks, where overlapping clips
//               must both sound.
//
// Centralizing this means the future "general overlap" decision (e.g. a user
// setting or per-track override) only has to change this one function.

import type { TimelineTrack } from '../../../types';

export type TrackOverlapPolicy = 'trim' | 'avoid' | 'stack';

/**
 * Resolve the overlap policy for a track.
 *
 * Audio tracks use 'avoid' so moving a clip never destructively trims another
 * recording. MIDI tracks use 'stack' so overlapping clips cohabitate and both
 * sound. Visual tracks retain the existing 'trim' behavior.
 */
export function getTrackOverlapPolicy(track: TimelineTrack | undefined): TrackOverlapPolicy {
  if (track?.type === 'midi') return 'stack';
  if (track?.type === 'audio') return 'avoid';
  return 'trim';
}
