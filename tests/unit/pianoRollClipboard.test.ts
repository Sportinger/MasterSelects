import { describe, expect, it } from 'vitest';

import {
  duplicateNotesRight,
  hasPianoRollClipboard,
  pasteNotesAt,
  setPianoRollClipboard,
} from '../../src/components/pianoRoll/pianoRollClipboard';
import type { MidiNote } from '../../src/types/midiClip';

function note(over: Partial<MidiNote>): MidiNote {
  return { id: 'n', pitch: 60, start: 0, duration: 1, velocity: 0.8, ...over };
}

describe('pianoRollClipboard', () => {
  it('copy then paste anchors the earliest note at the anchor, preserving spacing & pitch', () => {
    setPianoRollClipboard([
      note({ id: 'a', pitch: 60, start: 2, duration: 0.5 }),
      note({ id: 'b', pitch: 64, start: 3, duration: 0.5 }),
    ]);
    expect(hasPianoRollClipboard()).toBe(true);

    const pasted = pasteNotesAt(10);
    // Earliest (start 2) moves to 10 → offset +8; the other keeps its +1 gap.
    expect(pasted.map(n => n.start)).toEqual([10, 11]);
    expect(pasted.map(n => n.pitch)).toEqual([60, 64]);
    expect(pasted.map(n => n.duration)).toEqual([0.5, 0.5]);
  });

  it('paste supports a negative anchor (left-extended clip content time)', () => {
    setPianoRollClipboard([note({ start: 1 }), note({ start: 2 })]);
    expect(pasteNotesAt(-1).map(n => n.start)).toEqual([-1, 0]);
  });

  it('duplicate offsets the selection to the right by its own span', () => {
    // Span = latestEnd(3+1=4) − earliest(1) = 3.
    const dup = duplicateNotesRight([
      note({ pitch: 60, start: 1, duration: 1 }),
      note({ pitch: 67, start: 3, duration: 1 }),
    ]);
    expect(dup.map(n => n.start)).toEqual([4, 6]);
    expect(dup.map(n => n.pitch)).toEqual([60, 67]);
  });

  it('paste/duplicate return nothing when there is no input', () => {
    setPianoRollClipboard([]);
    expect(hasPianoRollClipboard()).toBe(false);
    expect(pasteNotesAt(5)).toEqual([]);
    expect(duplicateNotesRight([])).toEqual([]);
  });
});
