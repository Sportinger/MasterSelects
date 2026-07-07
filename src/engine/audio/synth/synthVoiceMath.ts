// Pure DSP math for the subtractive Simple Synth (issue #298).
//
// A leaf module (no Web Audio, no imports from the synth) so it is trivially
// unit-testable and safe to import from both the voice builder and MidiSynth
// without an import cycle. Everything here is the small-signal math the additive
// node graph needs: pitch↔Hz, cents/semitone offsets, keytracking, and the safety
// clamps that keep the BiquadFilter stable (plan §9).

/** MIDI note number → frequency in Hz (A4 = 69 = 440 Hz). */
export function midiPitchToFrequency(pitch: number): number {
  return 440 * Math.pow(2, (pitch - 69) / 12);
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * Hz delta equivalent to shifting `freqHz` by `cents`. Web Audio sums a Hz offset
 * onto `osc.frequency`, but musical pitch is logarithmic; linearizing around the
 * note frequency is accurate for the small depths vibrato uses and lets an LFO stay
 * a single Hz-domain gain (no per-sample exp). Exact at the note's own pitch.
 */
export function centsToHzDelta(freqHz: number, cents: number): number {
  return freqHz * (Math.pow(2, cents / 1200) - 1);
}

/** Hz delta equivalent to shifting `freqHz` by `semitones` (pitch-bend bake). */
export function semitonesToHzDelta(freqHz: number, semitones: number): number {
  return freqHz * (Math.pow(2, semitones / 12) - 1);
}

// Keytracking reference: cutoff shift is measured relative to middle C, so notes
// above it open the filter and notes below close it.
export const KEYTRACK_REFERENCE_PITCH = 60;

/**
 * Additive keytrack contribution (Hz) for a note. At `keytrack` = 1 the cutoff
 * shifts by the note's full Hz distance from middle C; at 0 there is no tracking.
 * Returned value is summed onto the filter's base cutoff via a constant carrier.
 */
export function keytrackCutoffHz(pitch: number, keytrack: number): number {
  if (keytrack <= 0) return 0;
  return keytrack * (midiPitchToFrequency(pitch) - midiPitchToFrequency(KEYTRACK_REFERENCE_PITCH));
}

// Filter safety bounds (plan §9). The BiquadFilter itself clamps frequency to
// [0, Nyquist], but we bound the BASE cutoff and Q so a patch/automation can't
// drive it into instability or DC.
export const MIN_FILTER_HZ = 20;
export const MAX_FILTER_HZ = 18000;
export const MIN_FILTER_Q = 0.0001;
export const MAX_FILTER_Q = 24;

export function clampFilterHz(hz: number): number {
  if (!Number.isFinite(hz)) return MIN_FILTER_HZ;
  return Math.max(MIN_FILTER_HZ, Math.min(MAX_FILTER_HZ, hz));
}

export function clampFilterQ(q: number): number {
  if (!Number.isFinite(q)) return MIN_FILTER_Q;
  return Math.max(MIN_FILTER_Q, Math.min(MAX_FILTER_Q, q));
}
