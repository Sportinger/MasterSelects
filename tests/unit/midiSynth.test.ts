import { describe, it, expect, vi } from 'vitest';
import { midiPitchToFrequency } from '../../src/engine/audio/MidiSynth';
import { scheduleVoiceGainFade } from '../../src/engine/audio/synth/MidiSynthVoice';

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

describe('scheduleVoiceGainFade', () => {
  it('holds the scheduled envelope and applies the shared 20ms steal fade', () => {
    const cancelAndHoldAtTime = vi.fn();
    const exponentialRampToValueAtTime = vi.fn();
    const gain = {
      cancelAndHoldAtTime,
      exponentialRampToValueAtTime,
    } as unknown as AudioParam;

    expect(scheduleVoiceGainFade(gain, 10)).toBe(10.02);
    expect(cancelAndHoldAtTime).toHaveBeenCalledWith(10);
    expect(exponentialRampToValueAtTime).toHaveBeenCalledWith(0.0001, 10.02);
  });
});
