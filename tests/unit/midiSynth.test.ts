import { describe, it, expect } from 'vitest';
import { midiPitchToFrequency } from '../../src/engine/audio/MidiSynth';

describe('midiPitchToFrequency', () => {
  it('maps A4 (69) to 440 Hz', () => {
    expect(midiPitchToFrequency(69)).toBeCloseTo(440, 6);
  });

  it('maps middle C (60) to ~261.63 Hz', () => {
    expect(midiPitchToFrequency(60)).toBeCloseTo(261.6256, 3);
  });

  it('doubles frequency one octave up (A5 = 81)', () => {
    expect(midiPitchToFrequency(81)).toBeCloseTo(880, 6);
  });

  it('halves frequency one octave down (A3 = 57)', () => {
    expect(midiPitchToFrequency(57)).toBeCloseTo(220, 6);
  });
});
