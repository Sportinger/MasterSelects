import { describe, expect, it } from 'vitest';

import { applyMergeMidiClipsOperation } from '../../src/stores/timeline/editOperations/mergeOperations';
import type { MergeMidiClipsOperation } from '../../src/stores/timeline/editOperations/types';
import type { TimelineClip, TimelineTrack } from '../../src/types';
import type { MidiNote } from '../../src/types/midiClip';

let noteSeq = 0;
let clipSeq = 0;
const makeNoteId = () => `note-${noteSeq++}`;
const makeClipId = () => `merged-${clipSeq++}`;

function midiTrack(locked = false): TimelineTrack {
  return {
    id: 'midi-1', name: 'MIDI 1', type: 'midi', height: 40,
    muted: false, visible: true, solo: false, locked,
  } as TimelineTrack;
}

function note(start: number, duration: number, pitch = 60): MidiNote {
  return { id: `src-${pitch}-${start}`, pitch, start, duration, velocity: 0.8 };
}

function midiClip(id: string, startTime: number, duration: number, notes: MidiNote[]): TimelineClip {
  return {
    id, trackId: 'midi-1', name: id,
    file: new File([], 'midi.dat'),
    startTime, duration, inPoint: 0, outPoint: duration,
    source: { type: 'midi', naturalDuration: duration },
    transform: {} as TimelineClip['transform'],
    effects: [],
    midiData: { notes },
  };
}

function op(clipId: string, allFollowing = false): MergeMidiClipsOperation {
  return { id: 'glue-test', type: 'merge-midi-clips', clipId, allFollowing };
}

describe('applyMergeMidiClipsOperation', () => {
  it('glues the whole contiguous (touching) run, clicking any clip in it', () => {
    // a|b|c all touch (no gaps): a 0-2, b 2-4, c 4-6.
    const clips = [
      midiClip('a', 0, 2, [note(0.5, 0.5, 60)]),
      midiClip('b', 2, 2, [note(0.5, 0.5, 62)]),
      midiClip('c', 4, 2, [note(0.5, 0.5, 64)]),
    ];

    for (const clickId of ['a', 'b', 'c']) {
      const result = applyMergeMidiClipsOperation(op(clickId), clips, [midiTrack()], makeNoteId, makeClipId);
      expect(result.changedClipIds.toSorted()).toEqual(['a', 'b', 'c']);
      const merged = result.clips.find(c => c.id === result.mergedClipId)!;
      expect(merged.startTime).toBe(0);
      expect(merged.duration).toBe(6);
      expect(merged.inPoint).toBe(0);
      // Absolute positions preserved: 0.5, 2.5, 4.5.
      expect(merged.midiData!.notes.map(n => n.start).toSorted((x, y) => x - y)).toEqual([0.5, 2.5, 4.5]);
    }
  });

  it('does NOT glue across a gap, and works clicking either side of the adjacent pair', () => {
    // a|b touch (0-2, 2-4); c is separated by a gap (5-7). Mirrors the screenshot.
    const clips = [
      midiClip('a', 0, 2, [note(0.5, 0.5, 60)]),
      midiClip('b', 2, 2, [note(0.5, 0.5, 62)]),
      midiClip('c', 5, 2, [note(0.5, 0.5, 64)]),
    ];

    for (const clickId of ['a', 'b']) {
      const result = applyMergeMidiClipsOperation(op(clickId), clips, [midiTrack()], makeNoteId, makeClipId);
      // a + b only; c stays separate (gap).
      expect(result.changedClipIds.toSorted()).toEqual(['a', 'b']);
      expect(result.clips.map(c => c.id)).toContain('c');
      const merged = result.clips.find(c => c.id === result.mergedClipId)!;
      expect(merged.duration).toBe(4);
      expect(merged.midiData!.notes.map(n => n.start).toSorted((x, y) => x - y)).toEqual([0.5, 2.5]);
    }

    // Clicking the gap-isolated clip c does nothing.
    const cResult = applyMergeMidiClipsOperation(op('c'), clips, [midiTrack()], makeNoteId, makeClipId);
    expect(cResult.changedClipIds).toHaveLength(0);
    expect(cResult.warnings[0].code).toBe('no-op');
  });

  it('glues overlapping clips from either clip', () => {
    const clips = [
      midiClip('a', 0, 3, [note(1, 0.5, 60)]),
      midiClip('b', 2, 3, [note(0.5, 0.5, 62)]), // overlaps a on [2,3]
    ];
    const result = applyMergeMidiClipsOperation(op('b'), clips, [midiTrack()], makeNoteId, makeClipId);
    expect(result.changedClipIds.toSorted()).toEqual(['a', 'b']);
    const merged = result.clips.find(c => c.id === result.mergedClipId)!;
    expect(merged.startTime).toBe(0);
    expect(merged.duration).toBe(5);
    expect(merged.midiData!.notes.map(n => n.start).toSorted((x, y) => x - y)).toEqual([1, 2.5]);
  });

  it('Alt-click force-merges every following clip, gaps included', () => {
    const clips = [
      midiClip('a', 0, 2, [note(0.5, 0.5, 60)]),
      midiClip('b', 2, 2, [note(0.5, 0.5, 62)]),
      midiClip('c', 5, 2, [note(0.5, 0.5, 64)]), // gap before c
    ];
    const result = applyMergeMidiClipsOperation(op('a', true), clips, [midiTrack()], makeNoteId, makeClipId);
    expect(result.changedClipIds.toSorted()).toEqual(['a', 'b', 'c']);
    const merged = result.clips.find(c => c.id === result.mergedClipId)!;
    expect(merged.duration).toBe(7); // 0 -> end of c (7); the gap stays silent
    expect(merged.midiData!.notes.map(n => n.start).toSorted((x, y) => x - y)).toEqual([0.5, 2.5, 5.5]);
  });

  it('is a no-op when the anchor has no adjacent/overlapping neighbour', () => {
    const clips = [
      midiClip('a', 0, 2, [note(0.5, 0.5)]),
      midiClip('b', 5, 2, [note(0.5, 0.5)]), // gap on the only side
    ];
    const result = applyMergeMidiClipsOperation(op('a'), clips, [midiTrack()], makeNoteId, makeClipId);
    expect(result.changedClipIds).toHaveLength(0);
    expect(result.warnings[0].code).toBe('no-op');
  });

  it('refuses to glue on a locked track', () => {
    const clips = [
      midiClip('a', 0, 2, [note(0.5, 0.5)]),
      midiClip('b', 2, 2, [note(0.5, 0.5)]),
    ];
    const result = applyMergeMidiClipsOperation(op('a'), clips, [midiTrack(true)], makeNoteId, makeClipId);
    expect(result.changedClipIds).toHaveLength(0);
    expect(result.warnings[0].code).toBe('track-locked');
  });
});
