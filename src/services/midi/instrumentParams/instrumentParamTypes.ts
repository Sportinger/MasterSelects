// Instrument parameter descriptors — the durable, instrument-agnostic contract
// behind the motorized-fader read-out (plan §14).
//
// Each instrument kind declares its animatable parameters as a list of these
// descriptors. A descriptor knows how to read the parameter's BASE value from the
// patch, which clip-automation lane (if any) rides on top of it, and how to
// COMBINE the two into the value the UI should display at a moment in time. The
// combine rules mirror the DSP bake exactly (shared constants in synthVoiceMath),
// so the ghost the user sees matches what they hear.
//
// This layer never reads the DSP and never writes back to the patch — it
// re-derives the live value from data we already own, so it survives the future
// FAUST/WASM DSP swap untouched (same durable tier as the schema, plan §3a).

import type { MidiClipAutomation } from '../../../types/midiClip';

/** The four performed CC lanes a descriptor can be fed by. */
export type AutomationLaneId = keyof MidiClipAutomation; // 'cutoff' | 'mod' | 'expression' | 'pitchBend'

/**
 * One automatable instrument parameter. `id` is stable and unique within an
 * instrument (e.g. `'filter.cutoff'`, `'lfo.<lfoId>.depth'`) so a UI control can
 * bind to it and the live-value bus can key by it.
 */
export interface InstrumentParamDescriptor {
  /** Stable, unique-within-instrument id a control binds to. */
  id: string;
  /** Human label (matches the panel control). */
  label: string;
  /** Display range — same units as `getBase`/`combine` return. */
  min: number;
  max: number;
  /** Optional unit shown in the UI (e.g. "Hz", "cents"). */
  unit?: string;
  /** Which clip-automation lane feeds this param; absent = no live source. */
  lane?: AutomationLaneId;
  /** Read the parameter's base value from the patch; undefined if absent. */
  getBase: (instrument: import('../../../types/midiClip').MidiInstrument) => number | undefined;
  /**
   * Combine the base value with the sampled NORMALIZED lane value (as stored in
   * the lane: cutoff/mod/expression 0..1, pitchBend -1..1) into the displayed
   * value. `laneValue` is `undefined` when the lane is absent or empty at this
   * time. Return `undefined` to signal "nothing to animate" — the control then
   * shows only its static base value.
   */
  combine: (base: number | undefined, laneValue: number | undefined) => number | undefined;
}
