import { describe, it, expect } from 'vitest';
import { capConcurrentNotes } from '../../src/services/midi/midiVoiceCap';

const n = (startTime: number, duration: number, velocity: number) => ({ startTime, duration, velocity });

describe('capConcurrentNotes', () => {
  it('returns all notes when under the cap', () => {
    const notes = [n(0, 1, 0.5), n(2, 1, 0.5)];
    expect(capConcurrentNotes(notes, 4)).toHaveLength(2);
  });

  it('drops the quietest overlapping note when over the cap', () => {
    // Three simultaneous notes, cap 2 → the quietest (vel 0.2) is dropped.
    const loud = n(0, 1, 0.9);
    const mid = n(0, 1, 0.5);
    const quiet = n(0, 1, 0.2);
    const kept = capConcurrentNotes([loud, mid, quiet], 2);
    expect(kept).toContain(loud);
    expect(kept).toContain(mid);
    expect(kept).not.toContain(quiet);
  });

  it('does not drop non-overlapping notes', () => {
    // Sequential notes never overlap → cap of 1 keeps all of them.
    const notes = [n(0, 1, 0.5), n(1, 1, 0.5), n(2, 1, 0.5)];
    expect(capConcurrentNotes(notes, 1)).toHaveLength(3);
  });

  it('preserves original order of surviving notes', () => {
    const a = n(0, 5, 0.9);
    const b = n(1, 5, 0.8);
    const c = n(2, 5, 0.1); // quietest, overlaps both → dropped at cap 2
    const kept = capConcurrentNotes([a, b, c], 2);
    expect(kept).toEqual([a, b]);
  });
});
