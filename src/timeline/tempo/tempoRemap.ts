// Content follows tempo (issue #299, Packet 2).
//
// Changing the tempo map rewrites MIDI timing so a melody written at 120 stays
// on its bars at 100; video/audio/image clips keep their seconds, because a film
// edit must not reflow when someone sets a tempo (plan §3.1).
//
// Every conversion goes through `old map -> bar/beat -> new map`. Seconds stay
// the source of truth on disk; this is a command, not a storage format.
//
// The one rule that matters everywhere below: a duration is NEVER scaled by a
// constant factor. It is derived by remapping the END and subtracting the
// remapped START, so an interval spanning a tempo change lands correctly.

import type { TimelineClip, TimelineTrack } from '../../types/timeline';
import type { AutomationLane, MidiClipAutomation, MidiNote } from '../../types/midiClip';
import { quartersToSeconds, secondsToQuarters } from './TempoMap';
import { tempoMapsEqual } from './tempoEdits';
import type { TempoMap } from '../../types/timeline';

// Below this, a remapped time is treated as unmoved — keeps object identity
// stable for clips outside the edited region so React does not re-render them.
const REMAP_EPSILON = 1e-9;

// A note must survive a remap as an audible note even if the maps disagree
// wildly; matches MIN_MIDI_NOTE_DURATION in midiClipSlice.
const MIN_REMAPPED_DURATION = 0.01;

/**
 * Project `time` from `oldMap`'s musical grid onto `newMap`'s.
 *
 * The invariant is the QUARTER-NOTE position, not bar/beat. Bar/beat would make
 * a pure meter change (4/4 -> 3/4 at the same BPM) shift every note, because
 * re-grouping bars changes a note's (bar, beat) address without changing when it
 * is played. Quarters only move when the TEMPO moves, which is exactly the rule
 * "MIDI follows tempo".
 */
export function remapAcrossMaps(oldMap: TempoMap, newMap: TempoMap, time: number): number {
  return quartersToSeconds(newMap, secondsToQuarters(oldMap, time));
}

/**
 * Which content is musical. The single seam for a future per-track
 * `timebase: 'musical' | 'linear'` flag (plan §3.1): when that schema field
 * exists this becomes `track.timebase === 'musical'` and nothing else moves.
 */
export function trackFollowsTempo(track: Pick<TimelineTrack, 'type'>): boolean {
  return track.type === 'midi';
}

function remapAutomationLane(
  lane: AutomationLane | undefined,
  toContentTime: (contentTime: number) => number,
): AutomationLane | undefined {
  if (!lane || lane.points.length === 0) return lane;
  return {
    ...lane,
    points: lane.points.map(point => ({ ...point, time: toContentTime(point.time) })),
  };
}

// The four CC lanes share MidiNote.start's time base (types/midiClip.ts), so a
// filter sweep must move with the notes it shapes. Skipping this desyncs every
// automation curve on the first tempo edit.
function remapAutomation(
  automation: MidiClipAutomation | undefined,
  toContentTime: (contentTime: number) => number,
): MidiClipAutomation | undefined {
  if (!automation) return automation;
  return {
    cutoff: remapAutomationLane(automation.cutoff, toContentTime),
    mod: remapAutomationLane(automation.mod, toContentTime),
    expression: remapAutomationLane(automation.expression, toContentTime),
    pitchBend: remapAutomationLane(automation.pitchBend, toContentTime),
  };
}

function remapNote(note: MidiNote, toContentTime: (contentTime: number) => number): MidiNote {
  const start = toContentTime(note.start);
  const end = toContentTime(note.start + note.duration);
  return {
    ...note,
    start,
    duration: Math.max(MIN_REMAPPED_DURATION, end - start),
  };
}

/**
 * Remap one MIDI clip and its contents.
 *
 * `A = startTime - inPoint` is the absolute time of the clip's content origin
 * (content time 0). Everything is expressed relative to the REMAPPED origin
 * `A'`, which keeps `noteAbsoluteStart` exact: `startTime' = A' + inPoint'`
 * equals `remap(startTime)` by construction, so the window and its notes cannot
 * drift apart.
 *
 * Returns the original object unchanged when nothing moved.
 */
export function remapMidiClip(clip: TimelineClip, oldMap: TempoMap, newMap: TempoMap): TimelineClip {
  const anchor = clip.startTime - clip.inPoint;
  const remappedAnchor = remapAcrossMaps(oldMap, newMap, anchor);
  const toContentTime = (contentTime: number): number =>
    remapAcrossMaps(oldMap, newMap, anchor + contentTime) - remappedAnchor;

  const inPoint = toContentTime(clip.inPoint);
  const outPoint = toContentTime(clip.outPoint);
  const startTime = remappedAnchor + inPoint;
  const duration = Math.max(MIN_REMAPPED_DURATION, outPoint - inPoint);

  const notes = clip.midiData?.notes;
  const remappedNotes = notes?.map(note => remapNote(note, toContentTime));
  const remappedAutomation = remapAutomation(clip.automation, toContentTime);

  const windowUnmoved = Math.abs(startTime - clip.startTime) < REMAP_EPSILON
    && Math.abs(duration - clip.duration) < REMAP_EPSILON
    && Math.abs(inPoint - clip.inPoint) < REMAP_EPSILON;
  const notesUnmoved = !notes || !remappedNotes || notes.every((note, index) => (
    Math.abs(note.start - remappedNotes[index].start) < REMAP_EPSILON
    && Math.abs(note.duration - remappedNotes[index].duration) < REMAP_EPSILON
  ));
  if (windowUnmoved && notesUnmoved) return clip;

  return {
    ...clip,
    startTime,
    duration,
    inPoint,
    outPoint,
    midiData: clip.midiData && remappedNotes
      ? { ...clip.midiData, notes: remappedNotes }
      : clip.midiData,
    automation: remappedAutomation,
  };
}

/**
 * Apply a tempo change to a whole timeline: musical tracks move, linear tracks
 * are returned untouched (same object identity). The array itself keeps its
 * identity when nothing moved.
 */
export function remapTimelineClipsForTempo(
  clips: readonly TimelineClip[],
  tracks: readonly TimelineTrack[],
  oldMap: TempoMap,
  newMap: TempoMap,
): TimelineClip[] | readonly TimelineClip[] {
  if (tempoMapsEqual(oldMap, newMap)) return clips;

  const musicalTrackIds = new Set(
    tracks.filter(trackFollowsTempo).map(track => track.id),
  );
  if (musicalTrackIds.size === 0) return clips;

  let changed = false;
  const next = clips.map(clip => {
    if (!musicalTrackIds.has(clip.trackId)) return clip;
    const remapped = remapMidiClip(clip, oldMap, newMap);
    if (remapped !== clip) changed = true;
    return remapped;
  });

  return changed ? next : clips;
}
