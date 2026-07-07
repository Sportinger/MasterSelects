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

/**
 * The oscillator synth (issue #182), upgraded to a real subtractive voice
 * (issue #298): resonant lowpass filter + dedicated filter envelope, LFOs, and an
 * additive mod-matrix. The subtractive fields are **optional** for back-compat —
 * a legacy `{ waveform, adsr, gain }` instrument still validates and renders as a
 * bare oscillator (no filter/LFO) until the user (or a preset) adds them.
 *
 * This shape is the DURABLE schema (plan §3a): plain JSON, no runtime handles. A
 * future compiled DSP core (FAUST→WASM in an AudioWorklet) reads the same object.
 */
export interface SimpleSynthInstrument {
  kind: 'simple-synth';
  waveform: OscillatorType; // 'sawtooth' default (rich harmonics for the filter to shape)
  adsr: MidiAdsr;           // amplitude envelope
  gain: number;             // 0–1 instrument output gain
  filter?: SynthFilter;         // resonant lowpass; absent = filter bypassed
  filterEnv?: MidiAdsr;         // dedicated filter envelope (drives filter.envAmount)
  pitchBendRange?: number;      // semitones, ± range for the pitch-bend CC lane (default 2)
  lfos?: SynthLfo[];            // 0..N low-frequency oscillators (per-voice unless global)
  modMatrix?: ModMatrixRoute[]; // additive source → destination → amount routings
}

/** Resonant lowpass filter config (BiquadFilter in the Phase-1 JS DSP). */
export interface SynthFilter {
  cutoff: number;     // Hz, base cutoff
  resonance: number;  // BiquadFilter Q (musical range ~0.7..15)
  envAmount: number;  // Hz added to cutoff at filter-env peak (can be NEGATIVE)
  keytrack: number;   // 0..1, how much cutoff follows note pitch
}

export type SynthLfoShape = 'sine' | 'triangle' | 'sawtooth' | 'square';
/** Default destination an LFO modulates; the mod-matrix can add more. */
export type SynthLfoTarget = 'pitch' | 'filter' | 'amp';

/**
 * One low-frequency oscillator. `depth`'s UNIT is decided by `target`: cents for
 * `pitch`, Hz for `filter`, 0..1 for `amp` (tremolo). Referenced from the
 * mod-matrix by the stable `id` (never a positional index — indices rot on
 * reorder, plan §6B).
 */
export interface SynthLfo {
  id: string;             // STABLE id — mod-matrix routings refer to this
  target: SynthLfoTarget;
  shape: SynthLfoShape;
  rate: number;           // Hz (free-run) — tempo-sync division is a later field
  depth: number;          // unit per `target`: cents | Hz | 0..1
  global: boolean;        // true = one shared phase-coherent LFO for all voices
  fadeIn: number;         // reserved delayed-vibrato fade-in seconds (v1 ships 0)
}

/** A performed/automatable modulation source (plan §3, §6B). */
export type ModSource =
  | 'velocity'
  | 'modWheel'      // CC1  (drawn by the mod-wheel lane)
  | 'expression'    // CC11 (drawn by the expression lane)
  | 'cutoffCC'      // CC74 (drawn by the filter-cutoff lane)
  | 'pitchBend'     // drawn by the pitch-bend lane
  | 'keytrack';     // note pitch as a modulation source

/**
 * Typed modulation destination — a discriminated union, NOT a dotted string, so
 * `tsc` checks every routing and LFOs are referenced by stable id (plan §6B).
 */
export type ModDestination =
  | { kind: 'filterCutoff' }
  | { kind: 'filterEnvAmount' }
  | { kind: 'ampGain' }
  | { kind: 'pitch' }
  | { kind: 'lfoDepth'; lfoId: string }
  | { kind: 'lfoRate'; lfoId: string };

/** One additive routing: `source` adds `amount`-scaled signal onto `destination`. */
export interface ModMatrixRoute {
  source: ModSource;
  destination: ModDestination;
  amount: number;
}

// --- Clip-level automation (the four performed CC lanes, plan §3/§6B) ---------
// Stored on the CLIP (not per-note) as time-based breakpoint envelopes. Point
// `time` is in CONTENT time — the same base as `MidiNote.start` (0 = clip content
// origin) — so notes and automation share one time base and a resized/trimmed clip
// reads the matching curve segment.

/** One breakpoint in an automation lane. */
export interface AutomationPoint {
  time: number;   // seconds, content time (same base as MidiNote.start)
  value: number;  // normalized per lane (see MidiClipAutomation)
}

/** A single automation lane = a time-ordered breakpoint envelope. */
export interface AutomationLane {
  points: AutomationPoint[];
}

/**
 * The four performed CC lanes stored on a MIDI clip. Values are normalized so the
 * lane UI and bake-time mapping are stable across patches:
 * - `cutoff`     0..1 → filter cutoff (CC74), mapped to Hz at bake
 * - `mod`        0..1 → mod wheel (CC1), adds vibrato depth
 * - `expression` 0..1 → expression (CC11), scales amp
 * - `pitchBend` -1..1 → ± `pitchBendRange` semitones
 */
export interface MidiClipAutomation {
  cutoff?: AutomationLane;
  mod?: AutomationLane;
  expression?: AutomationLane;
  pitchBend?: AutomationLane;
}

/**
 * A clip's automation sliced to one note's `[start, start+duration]` window, with
 * point times rebased to NOTE-LOCAL seconds (0 = note start). Shape mirrors
 * `MidiClipAutomation`; the distinct name documents that times are note-local,
 * which is what a synth voice needs to bake its own modulation (plan §3a). The
 * simple synth consumes this (Phase-1 DSP); the wavetable synth accepts + ignores.
 */
export type NoteAutomationWindow = MidiClipAutomation;

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
 * Default instrument for a given kind. Newly created MIDI tracks default to the
 * Wavetable Synth (GM program 0, Acoustic Grand Piano); pass `'simple-synth'` for
 * the oscillator synth. Used both for track creation and to produce a clean shape
 * when the user switches a track's instrument kind (so no stale `adsr`/`waveform`
 * carries onto a GM instrument).
 */
export function createDefaultMidiInstrument(
  kind: MidiInstrument['kind'] = 'gm',
): MidiInstrument {
  if (kind === 'gm') {
    return { kind: 'gm', program: 0, isDrum: false, gain: 0.8 };
  }
  return {
    kind: 'simple-synth',
    waveform: 'sawtooth',
    adsr: { attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.2 },
    gain: 0.8,
    // Subtractive defaults (#298) so a fresh Simple Synth track sounds like a real
    // filtered synth, not a bare oscillator. Legacy saved instruments omit these
    // fields and keep rendering as a plain oscillator (back-compat).
    filter: { ...DEFAULT_SIMPLE_SYNTH_FILTER },
    filterEnv: { ...DEFAULT_SIMPLE_SYNTH_FILTER_ENV },
    pitchBendRange: 2,
    lfos: [],
    modMatrix: [],
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

// --- Subtractive synth defaults + UI option lists (issue #298) ----------------
// The schema's single home for default values, so createDefaultMidiInstrument, the
// synth panel sections, and any preset seed all agree.

export const DEFAULT_SIMPLE_SYNTH_FILTER: SynthFilter = {
  cutoff: 2200, resonance: 1.2, envAmount: 1800, keytrack: 0.35,
};
export const DEFAULT_SIMPLE_SYNTH_FILTER_ENV: MidiAdsr = {
  attack: 0.01, decay: 0.25, sustain: 0.5, release: 0.25,
};

/** A fresh LFO with a musical default (per-voice sine vibrato). */
export function createDefaultSynthLfo(id: string): SynthLfo {
  return { id, target: 'pitch', shape: 'sine', rate: 5, depth: 6, global: false, fadeIn: 0 };
}

export const SYNTH_LFO_SHAPE_OPTIONS: ReadonlyArray<{ value: SynthLfoShape; label: string }> = [
  { value: 'sine', label: 'Sine' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'sawtooth', label: 'Saw' },
  { value: 'square', label: 'Square' },
];

/** LFO destination + the unit its `depth` field carries. */
export const SYNTH_LFO_TARGET_OPTIONS: ReadonlyArray<{ value: SynthLfoTarget; label: string; depthUnit: string }> = [
  { value: 'pitch', label: 'Pitch (vibrato)', depthUnit: 'cents' },
  { value: 'filter', label: 'Filter (wobble)', depthUnit: 'Hz' },
  { value: 'amp', label: 'Amp (tremolo)', depthUnit: '0–1' },
];

export const MOD_SOURCE_OPTIONS: ReadonlyArray<{ value: ModSource; label: string }> = [
  { value: 'velocity', label: 'Velocity' },
  { value: 'modWheel', label: 'Mod Wheel (CC1)' },
  { value: 'expression', label: 'Expression (CC11)' },
  { value: 'cutoffCC', label: 'Cutoff (CC74)' },
  { value: 'pitchBend', label: 'Pitch Bend' },
  { value: 'keytrack', label: 'Key Track' },
];

export const MOD_DESTINATION_OPTIONS: ReadonlyArray<{ value: ModDestination['kind']; label: string; needsLfo?: boolean }> = [
  { value: 'filterCutoff', label: 'Filter Cutoff' },
  { value: 'filterEnvAmount', label: 'Filter Env Amount' },
  { value: 'ampGain', label: 'Amp Gain' },
  { value: 'pitch', label: 'Pitch' },
  { value: 'lfoDepth', label: 'LFO Depth', needsLfo: true },
  { value: 'lfoRate', label: 'LFO Rate', needsLfo: true },
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
