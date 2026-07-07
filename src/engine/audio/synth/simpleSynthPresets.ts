// Simple Synth preset bank (issue #298, plan §10, workstream D — DURABLE).
//
// A preset is just a full serializable `SimpleSynthInstrument` patch + a name, so
// loading one is `setTrackMidiInstrument(trackId, preset.instrument)` and saving
// one is capturing the track's current instrument. Plain JSON — no runtime handles
// — so it survives the future FAUST/WASM DSP swap (the same object feeds it). The
// eight starter patches are musically-sane starting points, not final voicings.

import type { MidiAdsr, SimpleSynthInstrument } from '../../../types/midiClip';

export interface SimpleSynthPreset {
  id: string;
  name: string;
  instrument: SimpleSynthInstrument;
}

const env = (attack: number, decay: number, sustain: number, release: number): MidiAdsr =>
  ({ attack, decay, sustain, release });

/** Build a patch with the common defaults (gain, pitch-bend range) filled in. */
function patch(p: {
  waveform: OscillatorType;
  adsr: MidiAdsr;
  filter: SimpleSynthInstrument['filter'];
  filterEnv: MidiAdsr;
  lfos?: SimpleSynthInstrument['lfos'];
  modMatrix?: SimpleSynthInstrument['modMatrix'];
}): SimpleSynthInstrument {
  return {
    kind: 'simple-synth',
    gain: 0.8,
    pitchBendRange: 2,
    waveform: p.waveform,
    adsr: p.adsr,
    filter: p.filter,
    filterEnv: p.filterEnv,
    lfos: p.lfos ?? [],
    modMatrix: p.modMatrix ?? [],
  };
}

export const SIMPLE_SYNTH_PRESETS: readonly SimpleSynthPreset[] = [
  {
    id: 'sub-bass', name: 'Sub Bass',
    instrument: patch({
      waveform: 'sine', adsr: env(0.005, 0.12, 0.9, 0.08),
      filter: { cutoff: 300, resonance: 1, envAmount: 200, keytrack: 0.2 },
      filterEnv: env(0.005, 0.1, 0.5, 0.1),
    }),
  },
  {
    id: 'acid-bass', name: 'Acid Bass',
    instrument: patch({
      waveform: 'sawtooth', adsr: env(0.005, 0.15, 0.7, 0.08),
      filter: { cutoff: 350, resonance: 9, envAmount: 2600, keytrack: 0.3 },
      filterEnv: env(0.005, 0.14, 0.15, 0.1),
    }),
  },
  {
    id: 'pluck', name: 'Pluck',
    instrument: patch({
      waveform: 'sawtooth', adsr: env(0.002, 0.18, 0.0, 0.12),
      filter: { cutoff: 800, resonance: 6, envAmount: 3000, keytrack: 0.5 },
      filterEnv: env(0.002, 0.15, 0.0, 0.1),
    }),
  },
  {
    id: 'warm-pad', name: 'Warm Pad',
    instrument: patch({
      waveform: 'sawtooth', adsr: env(0.8, 0.5, 0.85, 1.2),
      filter: { cutoff: 1000, resonance: 1, envAmount: 600, keytrack: 0.4 },
      filterEnv: env(1.0, 0.8, 0.6, 1.5),
      lfos: [
        { id: 'pad-vib', target: 'pitch', shape: 'sine', rate: 4.5, depth: 4, global: false, fadeIn: 0 },
        { id: 'pad-cut', target: 'filter', shape: 'sine', rate: 0.25, depth: 300, global: false, fadeIn: 0 },
      ],
    }),
  },
  {
    id: 'bright-lead', name: 'Bright Lead',
    instrument: patch({
      waveform: 'square', adsr: env(0.01, 0.2, 0.85, 0.15),
      filter: { cutoff: 2500, resonance: 3, envAmount: 1500, keytrack: 0.7 },
      filterEnv: env(0.01, 0.25, 0.5, 0.2),
      // Vibrato is expressive: base depth small, the mod wheel adds it (standard row).
      lfos: [{ id: 'lead-vib', target: 'pitch', shape: 'sine', rate: 5.5, depth: 8, global: false, fadeIn: 0 }],
      modMatrix: [{ source: 'modWheel', destination: { kind: 'lfoDepth', lfoId: 'lead-vib' }, amount: 1 }],
    }),
  },
  {
    id: 'strings', name: 'Strings',
    instrument: patch({
      waveform: 'sawtooth', adsr: env(0.25, 0.3, 0.9, 0.6),
      filter: { cutoff: 1600, resonance: 1.5, envAmount: 400, keytrack: 0.5 },
      filterEnv: env(0.3, 0.5, 0.7, 0.6),
      lfos: [{ id: 'str-vib', target: 'pitch', shape: 'sine', rate: 5, depth: 6, global: false, fadeIn: 0 }],
    }),
  },
  {
    id: 'organ', name: 'Organ',
    instrument: patch({
      waveform: 'square', adsr: env(0.005, 0.0, 1.0, 0.02),
      // Deliberately static: no filter movement (envAmount 0) and no LFO.
      filter: { cutoff: 3500, resonance: 0.7, envAmount: 0, keytrack: 0.5 },
      filterEnv: env(0.005, 0.0, 1.0, 0.02),
    }),
  },
  {
    id: 'wobble-bass', name: 'Wobble Bass',
    instrument: patch({
      waveform: 'sawtooth', adsr: env(0.005, 0.1, 0.9, 0.1),
      filter: { cutoff: 500, resonance: 8, envAmount: 2500, keytrack: 0.3 },
      filterEnv: env(0.005, 0.1, 0.5, 0.1),
      // Shared filter wobble (global flag renders per-voice in v1; tempo-sync later).
      lfos: [{ id: 'wob-cut', target: 'filter', shape: 'sine', rate: 2, depth: 2000, global: true, fadeIn: 0 }],
    }),
  },
];

export function getSimpleSynthPreset(id: string): SimpleSynthPreset | undefined {
  return SIMPLE_SYNTH_PRESETS.find((p) => p.id === id);
}
