// Which MIDI clip drives a track's instrument read-out right now (plan §14.3).
//
// Automation lives per-CLIP but the instrument panel is per-TRACK, so the live
// read-out is fed by the MIDI clip currently under the playhead on that track.
// Pure helpers so the driver hook stays a thin rAF loop.

import type { TimelineClip } from '../../../types/timeline';
import { clipLocalToContentTime } from '../midiClipTiming';

const EPS = 0.0001;

/**
 * The MIDI clip on `trackId` whose timeline window contains global time `t`, or
 * `undefined` if none is playing. On overlap the later clip in array order wins
 * (topmost), matching the stacking overlap policy.
 */
export function activeMidiClipAt(
  clips: readonly TimelineClip[],
  trackId: string,
  t: number,
): TimelineClip | undefined {
  let active: TimelineClip | undefined;
  for (const clip of clips) {
    // A MIDI clip is identified by its note payload (the runtime TimelineClip has
    // no `type` discriminator; only serializable variants do).
    if (clip.trackId !== trackId || !clip.midiData) continue;
    if (t >= clip.startTime - EPS && t < clip.startTime + clip.duration - EPS) {
      active = clip;
    }
  }
  return active;
}

/**
 * Global timeline time → the clip's CONTENT time (the base `MidiNote.start` and
 * automation points use), via the windowed clip model in midiClipTiming.
 */
export function clipContentTimeAt(clip: TimelineClip, globalTime: number): number {
  return clipLocalToContentTime(clip, globalTime - clip.startTime);
}
