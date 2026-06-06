// MIDI "glue" — merge several MIDI clips into one (issue #232).
//
// The inverse of the MIDI cut (`partitionMidiNotesAtCut` / `splitClip`): a media
// split keeps both halves as windows onto one source file, so media has no
// meaningful "glue". A MIDI clip owns its note data, so gluing two clips means
// combining their notes onto one clip while every note keeps its ABSOLUTE
// timeline position (see `mergeMidiNotes`). Adjacent, overlapping, and gapped
// clips all merge — gaps stay silent because notes keep their real time.

import type { TimelineClip, TimelineTrack } from '../../../types';
import type { MidiNote } from '../../../types/midiClip';
import { mergeMidiNotes } from '../../../services/midi/midiClipTiming';
import type { MergeMidiClipsOperation, TimelineEditWarning } from './types';

export interface MergeMidiClipsResult {
  clips: TimelineClip[];
  changedClipIds: string[];
  mergedClipId: string | null;
  selectedClipIds: Set<string>;
  warnings: TimelineEditWarning[];
}

// Two clips count as touching/overlapping when the gap between them (in seconds)
// is no larger than this. A real gap breaks the contiguous run, so glue never
// jumps a space — only adjacent or overlapping clips merge.
const GAP_EPSILON = 1e-3;

/**
 * The maximal run of touching/overlapping MIDI clips that contains `index`
 * (clips already sorted by `startTime`). Expanding from the clicked clip in both
 * directions means clicking EITHER side of an adjacent pair glues the same run,
 * and a gap on a side stops the run there.
 */
function contiguousRunContaining(sortedClips: TimelineClip[], index: number): TimelineClip[] {
  if (index < 0) return [];

  let start = index;
  let end = index;

  // Expand right while the next clip starts at/before the run's running end.
  let runEnd = sortedClips[index].startTime + sortedClips[index].duration;
  for (let i = index + 1; i < sortedClips.length; i += 1) {
    if (sortedClips[i].startTime > runEnd + GAP_EPSILON) break;
    end = i;
    runEnd = Math.max(runEnd, sortedClips[i].startTime + sortedClips[i].duration);
  }

  // Expand left while the previous clip's end reaches the run's running start.
  let runStart = sortedClips[index].startTime;
  for (let i = index - 1; i >= 0; i -= 1) {
    const prevEnd = sortedClips[i].startTime + sortedClips[i].duration;
    if (prevEnd < runStart - GAP_EPSILON) break;
    start = i;
    runStart = Math.min(runStart, sortedClips[i].startTime);
  }

  return sortedClips.slice(start, end + 1);
}

function noop(warnings: TimelineEditWarning[]): MergeMidiClipsResult {
  return { clips: [], changedClipIds: [], mergedClipId: null, selectedClipIds: new Set(), warnings };
}

/**
 * Resolve which MIDI clips the glue click targets, then build the merged clip.
 *
 * - Basic click: the anchor plus the NEXT MIDI clip to its right on the track.
 * - Alt-click (`allFollowing`): the anchor plus EVERY MIDI clip to its right.
 *
 * Returns a no-op result (with a warning) when there is nothing to glue.
 */
export function applyMergeMidiClipsOperation(
  operation: MergeMidiClipsOperation,
  clips: TimelineClip[],
  tracks: TimelineTrack[],
  makeNoteId: () => string,
  makeClipId: () => string,
): MergeMidiClipsResult {
  const anchor = clips.find(c => c.id === operation.clipId);
  if (!anchor) {
    return noop([{ code: 'clip-not-found', message: 'Glue: clip not found.', clipId: operation.clipId }]);
  }
  if (anchor.source?.type !== 'midi') {
    return noop([{ code: 'no-op', message: 'Glue only applies to MIDI clips.', clipId: anchor.id }]);
  }

  const track = tracks.find(t => t.id === anchor.trackId);
  if (track?.locked) {
    return noop([{ code: 'track-locked', message: 'Track is locked.', trackId: anchor.trackId }]);
  }

  // MIDI clips on the same track, left to right.
  const trackClips = clips
    .filter(c => c.trackId === anchor.trackId && c.source?.type === 'midi')
    .toSorted((a, b) => a.startTime - b.startTime);

  const anchorIndex = trackClips.findIndex(c => c.id === anchor.id);
  const targets = operation.allFollowing
    ? trackClips.slice(anchorIndex)                       // Alt: anchor + ALL following (gaps included)
    : contiguousRunContaining(trackClips, anchorIndex);   // default: the touching/overlapping run

  if (targets.length < 2) {
    return noop([{ code: 'no-op', message: 'Glue: no adjacent or overlapping MIDI clip to merge.', clipId: anchor.id }]);
  }

  const makeNote = (source: MidiNote, rebased: { start: number; duration: number }): MidiNote => ({
    id: makeNoteId(),
    pitch: source.pitch,
    velocity: source.velocity,
    start: rebased.start,
    duration: rebased.duration,
  });

  const base = targets[0]; // leftmost — its name/transform/effects carry to the merge
  const mergedStartTime = base.startTime;
  const mergedEnd = Math.max(...targets.map(c => c.startTime + c.duration));
  const duration = mergedEnd - mergedStartTime;

  const notes = mergeMidiNotes(
    targets.map(c => ({
      startTime: c.startTime,
      inPoint: c.inPoint,
      outPoint: c.outPoint,
      notes: c.midiData?.notes ?? [],
    })),
    mergedStartTime,
    makeNote,
  );

  const mergedClipId = makeClipId();
  const mergedClip: TimelineClip = {
    ...base,
    id: mergedClipId,
    transform: structuredClone(base.transform),
    effects: base.effects.map(e => structuredClone(e)),
    startTime: mergedStartTime,
    duration,
    inPoint: 0,
    outPoint: duration,
    source: { type: 'midi', naturalDuration: duration },
    midiData: { ...(base.midiData ?? { notes: [] }), notes },
    linkedClipId: undefined,
    transitionIn: undefined,
    transitionOut: undefined,
  };

  const targetIds = new Set(targets.map(c => c.id));
  const remaining = clips.filter(c => !targetIds.has(c.id));
  remaining.push(mergedClip);

  return {
    clips: remaining,
    changedClipIds: [...targetIds],
    mergedClipId,
    selectedClipIds: new Set([mergedClipId]),
    warnings: [],
  };
}
