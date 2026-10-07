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

interface AdsrTimingInput {
  attack: number;
  decay: number;
  release: number;
}

/** Exact amp-envelope lifetime shared by voice construction and cap planning. */
export function getSimpleSynthVoiceTiming(
  adsr: AdsrTimingInput,
  startAt: number,
  duration: number,
) {
  const attack = Math.max(0.001, adsr.attack);
  const decay = Math.max(0.001, adsr.decay);
  const release = Math.max(0.005, adsr.release);
  const decayEnd = startAt + attack + decay;
  const noteOffTime = Math.max(decayEnd, startAt + Math.max(0.02, duration));
  return {
    attack,
    decay,
    release,
    noteOffTime,
    endsAt: noteOffTime + release,
  };
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

// CC-lane → value mapping contract (shared by the DSP bake AND the UI live-value
// evaluator so the motorized-fader read-out matches what is actually rendered,
// plan §14). These define the *meaning* of a normalized lane value; they are the
// durable mapping, not disposable node code, so they live in this pure leaf.
export const CUTOFF_CC_RANGE_HZ = 8000;    // full cutoff lane (1.0) adds up to +8 kHz
export const MOD_WHEEL_VIBRATO_CENTS = 50; // full mod wheel (1.0) adds up to 50c vibrato

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

// Noise source (SFX). A fixed seed keeps live playback and offline export
// sample-identical; the start offset varies with pitch so different notes do not
// replay the exact same grain.
export const NOISE_BUFFER_SECONDS = 2;
const NOISE_SEED = 0x5eed1234;

/** Fill `target` with deterministic white noise in [-1, 1) (mulberry32). */
export function fillSeededNoise(target: Float32Array, seed = NOISE_SEED): Float32Array {
  let state = seed >>> 0;
  for (let i = 0; i < target.length; i++) {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    target[i] = (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  }
  return target;
}

/** Start offset (seconds) into the looping noise buffer for a note pitch. */
export function noiseStartOffset(pitch: number): number {
  const offset = (Math.max(0, Math.round(pitch)) * 0.1373) % NOISE_BUFFER_SECONDS;
  return Number.isFinite(offset) ? offset : 0;
}

/** Pitch-envelope start offset in cents, bounded to ±4 octaves. */
export function pitchEnvelopeCents(semitones: number | undefined): number {
  if (!Number.isFinite(semitones)) return 0;
  return Math.max(-4800, Math.min(4800, (semitones as number) * 100));
}
