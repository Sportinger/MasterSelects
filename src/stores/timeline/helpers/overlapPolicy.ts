// Track overlap policy (issue #232).
//
// Single source of truth for how clips behave when they are dropped overlapping
// another clip on the SAME track:
//
//   - 'trim'  : the dropped clip "eats" the overlapped region of the clip
//               underneath (trim/delete/split). Current behavior for video/audio.
//   - 'stack' : clips are allowed to coexist; nothing is trimmed and both clips
//               keep playing. Default for MIDI tracks, where overlapping clips
//               must both sound.
//
// Centralizing this means the future "general overlap" decision (e.g. a user
// setting or per-track override) only has to change this one function.

import type { TimelineTrack } from '../../../types';

export type TrackOverlapPolicy = 'trim' | 'stack';

/**
 * Resolve the overlap policy for a track.
 *
 * MIDI tracks default to 'stack' so overlapping MIDI clips cohabitate and both
 * sound. Every other track type keeps the existing 'trim' (eat) behavior, so
 * non-MIDI editing is byte-identical to before.
 */
export function getTrackOverlapPolicy(track: TimelineTrack | undefined): TrackOverlapPolicy {
  if (track?.type === 'midi') return 'stack';
  return 'trim';
}
