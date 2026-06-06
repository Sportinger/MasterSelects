import { describe, expect, it } from 'vitest';
import {
  clipLocalToContentTime,
  contentTimeToClipLocal,
  isNoteStartInWindow,
  mergeMidiNotes,
  noteAbsoluteStart,
  partitionMidiNotesAtCut,
  type MidiClipWindow,
  type MidiMergeSegment,
} from '../../src/services/midi/midiClipTiming';
import type { MidiNote } from '../../src/types/midiClip';

// A clip whose window has been slid right: content origin 0 sits 2s before the
// window, so the window [2, 6] shows content times 2..6 over a 4s duration.
const slidClip: MidiClipWindow = { startTime: 10, duration: 4, inPoint: 2, outPoint: 6 };
// A clip enlarged to the left past the content origin: inPoint is negative, so
// there is empty pre-roll before the first possible note.
const preRollClip: MidiClipWindow = { startTime: 3, duration: 5, inPoint: -2, outPoint: 3 };

describe('midiClipTiming', () => {
  it('places a note at startTime when its content time equals inPoint', () => {
    expect(noteAbsoluteStart(slidClip, { start: 2 })).toBe(10);
  });

  it('keeps absolute position stable when the window slides (resize, not move)', () => {
    const note = { start: 4 }; // content time 4
    // Original window inPoint 2 -> abs 10 + (4-2) = 12.
    expect(noteAbsoluteStart(slidClip, note)).toBe(12);
    // Slide the window left by 2 (left-enlarge): startTime and inPoint both -2.
    const enlarged: MidiClipWindow = { startTime: 8, duration: 6, inPoint: 0, outPoint: 6 };
    expect(noteAbsoluteStart(enlarged, note)).toBe(12); // note did not move
  });

  it('round-trips clip-local <-> content time', () => {
    expect(clipLocalToContentTime(slidClip, 0)).toBe(2);
    expect(contentTimeToClipLocal(slidClip, 2)).toBe(0);
    expect(contentTimeToClipLocal(slidClip, noteAbsoluteStartContent(slidClip, 3))).toBeCloseTo(1);
  });

  it('treats notes outside the window as hidden but does not move them', () => {
    expect(isNoteStartInWindow(slidClip, { start: 2 })).toBe(true);
    expect(isNoteStartInWindow(slidClip, { start: 5.9 })).toBe(true);
    expect(isNoteStartInWindow(slidClip, { start: 1.5 })).toBe(false); // before window
    expect(isNoteStartInWindow(slidClip, { start: 6 })).toBe(false); // at/after window end
  });

  it('supports negative in-points (left-enlarged empty pre-roll)', () => {
    // Content origin note still lands at startTime + (0 - (-2)) = 3 + 2 = 5.
    expect(noteAbsoluteStart(preRollClip, { start: 0 })).toBe(5);
    expect(isNoteStartInWindow(preRollClip, { start: 0 })).toBe(true);
  });
});

describe('partitionMidiNotesAtCut', () => {
  let nextId = 0;
  const makeNote = (source: MidiNote, rebased: { start: number; duration: number }): MidiNote => ({
    id: `n${nextId++}`,
    pitch: source.pitch,
    velocity: source.velocity,
    start: rebased.start,
    duration: rebased.duration,
  });
  const note = (start: number, duration: number, pitch = 60, velocity = 0.8): MidiNote =>
    ({ id: 'src', pitch, start, duration, velocity });

  // A fresh, unwindowed clip: inPoint 0, outPoint 4, cut at 2s.
  const window = { inPoint: 0, outPoint: 4 };

  it('assigns notes to a half by where their start falls, rebased to each origin', () => {
    const { left, right } = partitionMidiNotesAtCut(
      [note(0.5, 0.5), note(2.5, 0.5)],
      window,
      2,
      makeNote,
    );
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ start: 0.5, duration: 0.5 });
    expect(right).toHaveLength(1);
    // Rebased by the cut: 2.5 - 2 = 0.5.
    expect(right[0]).toMatchObject({ start: 0.5, duration: 0.5 });
  });

  it('keeps a note that straddles the cut WHOLE on the left, never slicing it', () => {
    const { left, right } = partitionMidiNotesAtCut([note(1.5, 1.0, 64, 0.5)], window, 2, makeNote);
    // Starts left of the cut, so the whole note stays left with its full duration
    // and rings out past the cut. The right clip gets no fragment of it.
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ start: 1.5, duration: 1.0, pitch: 64, velocity: 0.5 });
    expect(right).toHaveLength(0);
  });

  it('drops notes whose start is outside the visible window', () => {
    // Window [2, 6] over content; notes before 2 / at-or-after 6 are already silent.
    const { left, right } = partitionMidiNotesAtCut(
      [note(1, 0.5), note(3, 0.5), note(6, 0.5)],
      { inPoint: 2, outPoint: 6 },
      4,
      makeNote,
    );
    // Only the note at content 3 survives; it lands left of the cut, rebased by inPoint.
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ start: 1, duration: 0.5 }); // 3 - inPoint(2)
    expect(right).toHaveLength(0);
  });

  it('keeps every surviving note absolutely positioned after a cut', () => {
    // Single clip at startTime 10, window [0,4], note at content 2.5.
    const startTime = 10;
    const { left, right } = partitionMidiNotesAtCut([note(2.5, 0.5)], window, 2, makeNote);
    expect(left).toHaveLength(0);
    // Right clip starts at startTime + cut = 12; its note origin is 0 -> abs 12.5.
    const rightClipStart = startTime + 2;
    const absBefore = startTime + 2.5; // original abs (inPoint 0)
    const absAfter = rightClipStart + right[0].start;
    expect(absAfter).toBeCloseTo(absBefore);
  });
});

describe('mergeMidiNotes', () => {
  let nextId = 0;
  const makeNote = (source: MidiNote, rebased: { start: number; duration: number }): MidiNote => ({
    id: `m${nextId++}`,
    pitch: source.pitch,
    velocity: source.velocity,
    start: rebased.start,
    duration: rebased.duration,
  });
  const seg = (startTime: number, inPoint: number, duration: number, notes: MidiNote[]): MidiMergeSegment =>
    ({ startTime, inPoint, outPoint: inPoint + duration, notes });
  const note = (start: number, duration: number, pitch = 60, velocity = 0.8): MidiNote =>
    ({ id: 'src', pitch, start, duration, velocity });

  it('combines clips keeping every note at its absolute timeline position', () => {
    // Clip A at 0 (note at content 1) and clip B at 4 (note at content 0.5).
    const a = seg(0, 0, 4, [note(1, 0.5, 60)]);
    const b = seg(4, 0, 4, [note(0.5, 0.5, 64)]);
    const merged = mergeMidiNotes([a, b], 0, makeNote);
    expect(merged).toHaveLength(2);
    // A's note: abs 1 -> merged start 1. B's note: abs 4.5 -> merged start 4.5.
    expect(merged.find(n => n.pitch === 60)).toMatchObject({ start: 1 });
    expect(merged.find(n => n.pitch === 64)).toMatchObject({ start: 4.5 });
  });

  it('drops out-of-window notes and keeps overlapping clips polyphonic', () => {
    // Window [1, 3]: the note at content 0.5 is hidden; both clips overlap at abs 2.
    const a = seg(0, 1, 2, [note(0.5, 0.2, 60), note(2, 1, 62)]); // 0.5 hidden, 2 -> abs 1
    const b = seg(1, 0, 3, [note(1, 1, 67)]);                     // abs 2
    const merged = mergeMidiNotes([a, b], 0, makeNote);
    expect(merged.map(n => n.pitch).toSorted((x, y) => x - y)).toEqual([62, 67]);
  });

  it('round-trips cut -> glue: notes return to their original absolute positions', () => {
    const startTime = 10;
    const cut = 2;
    const original = [note(0.5, 0.5, 60), note(2.5, 0.5, 64), note(3.2, 0.4, 67)];
    const absOf = (n: MidiNote) => startTime + (n.start - 0); // inPoint 0

    // Cut at content 2 -> left clip (start 10, inPoint 0) and right clip (start 12, inPoint 0).
    const { left, right } = partitionMidiNotesAtCut(original, { inPoint: 0, outPoint: 4 }, cut, makeNote);
    const leftSeg = seg(startTime, 0, cut, left);
    const rightSeg = seg(startTime + cut, 0, 4 - cut, right);

    // Glue them back; merged clip origin is the left clip's start.
    const merged = mergeMidiNotes([leftSeg, rightSeg], startTime, makeNote);
    const mergedAbs = merged.map(n => startTime + n.start).toSorted((x, y) => x - y);
    const originalAbs = original.map(absOf).toSorted((x, y) => x - y);
    expect(mergedAbs).toEqual(originalAbs);
  });
});

// Helper mirroring the production formula for the round-trip assertion.
function noteAbsoluteStartContent(clip: MidiClipWindow, content: number): number {
  return contentTimeToClipLocal(clip, content) + clip.inPoint;
}
