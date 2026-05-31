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
 * Instrument that renders a MIDI track's clips to audio. Kept deliberately
 * minimal for now (one oscillator + ADSR) but behind a `kind` discriminator so
 * future instruments (sampler, FM, …) slot in without reworking the data model.
 * The instrument lives on the *track* (DAW convention), notes live on the clip.
 */
export interface MidiInstrument {
  kind: 'simple-synth';     // extensible: future 'sampler' | 'fm' | ...
  waveform: OscillatorType; // 'triangle' for now
  adsr: MidiAdsr;
  gain: number;             // 0–1 instrument output gain
}

export interface MidiAdsr {
  attack: number;   // seconds
  decay: number;    // seconds
  sustain: number;  // 0–1 sustain level
  release: number;  // seconds
}

/** Default instrument applied to newly created MIDI tracks. */
export function createDefaultMidiInstrument(): MidiInstrument {
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
];

/** Oscillator waveforms offered for the simple synth. */
export const MIDI_WAVEFORM_OPTIONS: ReadonlyArray<{ value: OscillatorType; label: string }> = [
  { value: 'triangle', label: 'Triangle' },
  { value: 'sine', label: 'Sine' },
  { value: 'sawtooth', label: 'Sawtooth' },
  { value: 'square', label: 'Square' },
];

/** Human-readable label for an instrument (e.g. "Simple Synth"). */
export function getMidiInstrumentLabel(instrument: MidiInstrument | undefined | null): string | null {
  if (!instrument) return null;
  return MIDI_INSTRUMENT_OPTIONS.find(option => option.kind === instrument.kind)?.label ?? 'Instrument';
}
