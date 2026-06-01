import { getGmProgramName, getGmDrumKitName } from './gmPrograms';

// MIDI track/clip/synth subsystem types.
//
// IMPORTANT: This is unrelated to `src/types/midi.ts`, which models hardware
// MIDI *control input* (MIDI-learn, parameter bindings, transport). This file
// models the DAW-style MIDI track/clip/instrument data that lives on the
// timeline and is rendered by the internal synth.

/**
 * A single note inside a MIDI clip. Timing is seconds-based and relative to the
 * clip's start (free placement, no grid snapping — see issue #182 plan).
 */
export interface MidiNote {
  id: string;
  pitch: number;     // MIDI note number, 0–127 (60 = middle C / C4)
  start: number;     // seconds, relative to clip start (clip.inPoint origin)
  duration: number;  // seconds
  velocity: number;  // 0–1
}

/** Note data carried by a MIDI clip (`TimelineClip.midiData`). */
export interface MidiClipData {
  notes: MidiNote[];
}

/**
 * Instrument that renders a MIDI track's clips to audio. A discriminated union on
 * `kind` so the synth/data model grows by adding a branch (the General MIDI
 * wavetable in issue #193, future sampler/FM, …) rather than piling optional
 * fields onto one shape — `tsc` then enumerates every consumer that must handle a
 * new kind. The instrument lives on the *track* (DAW convention); notes live on
 * the clip.
 */
export type MidiInstrument = SimpleSynthInstrument | GmInstrument;

/** The original oscillator + ADSR synth (issue #182). */
export interface SimpleSynthInstrument {
  kind: 'simple-synth';
  waveform: OscillatorType; // 'triangle' default
  adsr: MidiAdsr;
  gain: number;             // 0–1 instrument output gain
}

/**
 * General MIDI wavetable instrument (issue #193). Envelope + loop come from the
 * sampled zone, so only the GM program, an optional percussion flag, and an
 * output gain live here.
 */
export interface GmInstrument {
  kind: 'gm';
  program: number;   // 0–127 GM program
  isDrum?: boolean;  // true = percussion kit (per-note sample, native rate)
  gain: number;      // 0–1 output gain
}

export interface MidiAdsr {
  attack: number;   // seconds
  decay: number;    // seconds
  sustain: number;  // 0–1 sustain level
  release: number;  // seconds
}

/**
 * Default instrument for a given kind. Newly created MIDI tracks get the simple
 * synth; passing `'gm'` yields GM program 0 (Acoustic Grand Piano). Used both for
 * track creation and to produce a clean shape when the user switches a track's
 * instrument kind (so no stale `adsr`/`waveform` carries onto a GM instrument).
 */
export function createDefaultMidiInstrument(
  kind: MidiInstrument['kind'] = 'simple-synth',
): MidiInstrument {
  if (kind === 'gm') {
    return { kind: 'gm', program: 0, isDrum: false, gain: 0.8 };
  }
  return {
    kind: 'simple-synth',
    waveform: 'triangle',
    adsr: { attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.2 },
    gain: 0.8,
  };
}

/**
 * Selectable instruments. Single entry today, but this is the extension point:
 * add a `kind` here (+ a synth implementation) and it appears in every picker
 * (track header dropdown, properties tab) with no further UI work.
 */
export const MIDI_INSTRUMENT_OPTIONS: ReadonlyArray<{ kind: MidiInstrument['kind']; label: string }> = [
  { kind: 'simple-synth', label: 'Simple Synth' },
  { kind: 'gm', label: 'Wavetable Synth' },
];

/** Oscillator waveforms offered for the simple synth. */
export const MIDI_WAVEFORM_OPTIONS: ReadonlyArray<{ value: OscillatorType; label: string }> = [
  { value: 'triangle', label: 'Triangle' },
  { value: 'sine', label: 'Sine' },
  { value: 'sawtooth', label: 'Sawtooth' },
  { value: 'square', label: 'Square' },
];

/**
 * Human-readable label for an instrument. GM instruments report their concrete
 * program (or drum-kit) name — e.g. "Acoustic Grand Piano" / "Standard Kit" —
 * rather than the generic "Wavetable Synth"; the simple synth reports its kind label.
 */
export function getMidiInstrumentLabel(instrument: MidiInstrument | undefined | null): string | null {
  if (!instrument) return null;
  if (instrument.kind === 'gm') {
    return instrument.isDrum
      ? getGmDrumKitName(instrument.program)
      : getGmProgramName(instrument.program);
  }
  return MIDI_INSTRUMENT_OPTIONS.find(option => option.kind === instrument.kind)?.label ?? 'Instrument';
}
