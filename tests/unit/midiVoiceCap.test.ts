import { describe, it, expect } from 'vitest';
import {
  compareMidiVoiceStealPriority,
  planConcurrentNoteStops,
} from '../../src/services/midi/midiVoiceCap';

const n = (startTime: number, duration: number, velocity: number) => ({ startTime, duration, velocity });

describe('planConcurrentNoteStops', () => {
  it('shares release, velocity, and age priority with live voice stealing', () => {
    const heldQuiet = { isReleasing: false, velocity: 0.1, startTime: 0 };
    const releasingLoud = { isReleasing: true, velocity: 0.9, startTime: 1 };
    expect(compareMidiVoiceStealPriority(releasingLoud, heldQuiet)).toBeLessThan(0);
    expect(compareMidiVoiceStealPriority(
      { isReleasing: false, velocity: 0.2, startTime: 2 },
      { isReleasing: false, velocity: 0.8, startTime: 0 },
    )).toBeLessThan(0);
    expect(compareMidiVoiceStealPriority(
      { isReleasing: false, velocity: 0.5, startTime: 0 },
      { isReleasing: false, velocity: 0.5, startTime: 1 },
    )).toBeLessThan(0);
  });

  it('plans no stops when under the cap', () => {
    const notes = [n(0, 1, 0.5), n(2, 1, 0.5)];
    expect(planConcurrentNoteStops(notes, 4).size).toBe(0);
  });

  it('steals the quietest existing voice before admitting a new note', () => {
    // The live synth steals before it builds the incoming voice, so the arrival
    // is never one of the victim candidates even when it is the quietest note.
    const loud = n(0, 1, 0.9);
    const mid = n(0, 1, 0.5);
    const quietArrival = n(0.25, 1, 0.2);
    const stops = planConcurrentNoteStops([loud, mid, quietArrival], 2);
    expect(stops.has(loud)).toBe(false);
    expect(stops.get(mid)).toBe(0.25);
    expect(stops.has(quietArrival)).toBe(false);
  });

  it('steals the oldest existing voice when velocities tie', () => {
    const oldest = n(0, 5, 0.5);
    const newer = n(1, 5, 0.5);
    const arrival = n(2, 5, 0.5);
    expect(planConcurrentNoteStops([oldest, newer, arrival], 2).get(oldest)).toBe(2);
  });

  it('counts release tails and steals a releasing voice at the arrival time', () => {
    const releasingLoud = n(0, 0.1, 0.9);
    const heldQuiet = n(0, 1, 0.1);
    const arrival = n(0.2, 1, 0.5);
    const stops = planConcurrentNoteStops(
      [releasingLoud, heldQuiet, arrival],
      2,
      (note) => ({
        noteOffTime: note.startTime + note.duration,
        endsAt: note.startTime + note.duration + 1,
      }),
    );
    expect(stops.get(releasingLoud)).toBe(0.2);
    expect(stops.has(heldQuiet)).toBe(false);
    expect(stops.has(arrival)).toBe(false);
  });

  it('does not stop non-overlapping notes', () => {
    // Sequential notes never overlap → cap of 1 keeps all of them.
    const notes = [n(0, 1, 0.5), n(1, 1, 0.5), n(2, 1, 0.5)];
    expect(planConcurrentNoteStops(notes, 1).size).toBe(0);
  });

  it('preserves an established note until the later arrival steals it', () => {
    const a = n(0, 5, 0.9);
    const b = n(1, 5, 0.8);
    const c = n(2, 5, 0.1);
    const stops = planConcurrentNoteStops([a, b, c], 2);
    expect(stops.get(b)).toBe(2);
    expect(stops.has(a)).toBe(false);
    expect(stops.has(c)).toBe(false);
  });
});
