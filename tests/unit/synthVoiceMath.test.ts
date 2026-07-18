import { describe, it, expect } from 'vitest';
import {
  centsToHzDelta,
  clampFilterHz,
  clampFilterQ,
  keytrackCutoffHz,
  midiPitchToFrequency,
  semitonesToHzDelta,
} from '../../src/engine/audio/synth/synthVoiceMath';

describe('synthVoiceMath', () => {
  it('centsToHzDelta is ~0 at 0 cents and positive going up', () => {
    expect(centsToHzDelta(440, 0)).toBeCloseTo(0, 9);
    expect(centsToHzDelta(440, 1200)).toBeCloseTo(440, 3); // +1 octave = +freq
    expect(centsToHzDelta(440, 100)).toBeGreaterThan(0);
  });

  it('semitonesToHzDelta of 12 semitones doubles', () => {
    expect(semitonesToHzDelta(440, 12)).toBeCloseTo(440, 3);
    expect(semitonesToHzDelta(440, -12)).toBeCloseTo(-220, 3);
  });

  it('keytrack is 0 at reference pitch and scales with the amount', () => {
    expect(keytrackCutoffHz(60, 1)).toBeCloseTo(0, 6);        // middle C = reference
    expect(keytrackCutoffHz(72, 0)).toBe(0);                  // amount 0 → no tracking
    const full = keytrackCutoffHz(72, 1);
    const half = keytrackCutoffHz(72, 0.5);
    expect(full).toBeGreaterThan(0);
    expect(half).toBeCloseTo(full / 2, 6);
  });

  it('clamps filter frequency and Q into safe ranges', () => {
    expect(clampFilterHz(-100)).toBe(20);
    expect(clampFilterHz(999999)).toBe(18000);
    expect(clampFilterHz(NaN)).toBe(20);
    expect(clampFilterQ(999)).toBe(24);
    expect(clampFilterQ(-1)).toBeCloseTo(0.0001, 6);
  });

  it('midiPitchToFrequency maps A4→440', () => {
    expect(midiPitchToFrequency(69)).toBeCloseTo(440, 6);
  });
});
