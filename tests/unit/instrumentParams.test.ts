import { describe, it, expect } from 'vitest';
import {
  evaluateParamAt,
  getInstrumentParamModel,
} from '../../src/services/midi/instrumentParams';
import {
  CUTOFF_CC_RANGE_HZ,
  MOD_WHEEL_VIBRATO_CENTS,
} from '../../src/engine/audio/synth/synthVoiceMath';
import type { MidiClipAutomation, SimpleSynthInstrument } from '../../src/types/midiClip';

const patch: SimpleSynthInstrument = {
  kind: 'simple-synth',
  waveform: 'sawtooth',
  adsr: { attack: 0.01, decay: 0.2, sustain: 0.7, release: 0.2 },
  gain: 0.8,
  filter: { cutoff: 1000, resonance: 2, envAmount: 1500, keytrack: 0.4 },
  lfos: [
    { id: 'lfo-a', target: 'pitch', shape: 'sine', rate: 5, depth: 6, global: false, fadeIn: 0 },
    { id: 'lfo-b', target: 'filter', shape: 'sine', rate: 1, depth: 200, global: false, fadeIn: 0 },
  ],
};

const ramp01: MidiClipAutomation = { cutoff: { points: [{ time: 0, value: 0 }, { time: 2, value: 1 }] } };

describe('getInstrumentParamModel', () => {
  it('lists cutoff, gain, and one depth per PITCH lfo', () => {
    const ids = getInstrumentParamModel(patch).map((d) => d.id);
    expect(ids).toContain('filter.cutoff');
    expect(ids).toContain('gain');
    expect(ids).toContain('lfo.lfo-a.depth'); // pitch lfo
    expect(ids).not.toContain('lfo.lfo-b.depth'); // filter lfo has no mod-wheel control
  });

  it('omits cutoff when the patch has no filter, and is empty for unknown', () => {
    const bare: SimpleSynthInstrument = { kind: 'simple-synth', waveform: 'sine', adsr: patch.adsr, gain: 0.5 };
    expect(getInstrumentParamModel(bare).map((d) => d.id)).not.toContain('filter.cutoff');
    expect(getInstrumentParamModel(null)).toEqual([]);
  });
});

describe('evaluateParamAt', () => {
  const cutoff = getInstrumentParamModel(patch).find((d) => d.id === 'filter.cutoff')!;

  it('re-derives cutoff = base + laneNorm × range, matching the DSP mapping', () => {
    // Halfway through the ramp (t=1 → norm 0.5): 1000 + 0.5 × 8000.
    expect(evaluateParamAt(cutoff, patch, ramp01, 1)).toBeCloseTo(1000 + 0.5 * CUTOFF_CC_RANGE_HZ, 3);
  });

  it('returns undefined when the feeding lane is absent (nothing to animate)', () => {
    expect(evaluateParamAt(cutoff, patch, undefined, 1)).toBeUndefined();
    expect(evaluateParamAt(cutoff, patch, {}, 1)).toBeUndefined();
  });

  it('adds mod wheel on top of the pitch-lfo base depth', () => {
    const depth = getInstrumentParamModel(patch).find((d) => d.id === 'lfo.lfo-a.depth')!;
    const mod: MidiClipAutomation = { mod: { points: [{ time: 0, value: 1 }, { time: 2, value: 1 }] } };
    expect(evaluateParamAt(depth, patch, mod, 1)).toBeCloseTo(6 + MOD_WHEEL_VIBRATO_CENTS, 3);
  });
});
