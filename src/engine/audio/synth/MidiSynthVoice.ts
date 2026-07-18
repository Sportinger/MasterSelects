// Per-voice node graph for the subtractive Simple Synth (issue #298, plan §4).
//
// DISPOSABLE DSP (plan §3a): this JS Web Audio graph is a placeholder for a future
// compiled core (FAUST→WASM in an AudioWorklet). It is intentionally
// Simple-Synth-specific and not shared with the wavetable synth.
//
//   osc ─▶ [BiquadFilter lowpass] ─▶ ampGain(ADSR) ─▶ [exprGain] ─▶ destination
//
// The additive matrix (plan §4) is built with CARRIER nodes, never by scripting a
// shared param twice: each modulation source is its own node summed via .connect()
// into the target AudioParam, so filter env + keytrack + cutoff automation + LFOs
// all land on filter.frequency without a setValueCurveAtTime overlap throw. Filter
// carriers ride ConstantSourceNode.offset with LINEAR ramps (envAmount may be
// negative and cross 0 — exponential can't); only amp.gain, a single intrinsic
// writer that never reaches 0, keeps exponential ramps.

import type { NoteAutomationWindow, SimpleSynthInstrument, SynthLfo } from '../../../types/midiClip';
import { sampleLaneAt } from '../../../services/midi/midiAutomationWindow';
import {
  centsToHzDelta,
  clamp01,
  clampFilterHz,
  clampFilterQ,
  CUTOFF_CC_RANGE_HZ,
  getSimpleSynthVoiceTiming,
  keytrackCutoffHz,
  midiPitchToFrequency,
  MOD_WHEEL_VIBRATO_CENTS,
  semitonesToHzDelta,
} from './synthVoiceMath';

// The disposable DSP hardwires the four performed CC lanes to their canonical
// destinations (see scheduleNote's caller); the 0..1 → value mapping now lives in
// synthVoiceMath so the UI live-value evaluator shares it exactly (plan §14).
const CURVE_CONTROL_HZ = 120;         // automation → setValueCurve sampling rate
const CURVE_MAX_SAMPLES = 512;        // bound the curve array for long notes

/** A live handle to a sounding voice: its output stage + lifecycle controls. */
export interface VoiceHandle {
  /** The ADSR gain — faded to silence when the voice is stolen/flushed. */
  readonly ampGain: GainNode;
  readonly velocity: number;   // 0–1, for voice-stealing priority
  readonly startAt: number;    // ctx time the voice starts
  readonly noteOff: number;    // ctx time the release begins
  readonly endsAt: number;     // ctx time the voice is fully silent
  /** Stop every source node (osc/carriers/LFOs) at `atTime`. */
  stop(atTime: number): void;
  /** Disconnect every node (called on teardown). */
  disconnect(): void;
  /** Fire `cb` when the voice has finished sounding (osc `onended`). */
  onEnded(cb: () => void): void;
}

const VOICE_STEAL_FADE_SECONDS = 0.02;

/** Schedule the same click-free voice-steal fade in live and offline contexts. */
export function scheduleVoiceGainFade(gain: AudioParam, atTime: number): number {
  try {
    gain.cancelAndHoldAtTime(atTime);
  } catch {
    gain.cancelScheduledValues(atTime);
    gain.setValueAtTime(Math.max(0.0001, gain.value), atTime);
  }
  const fadeEnd = atTime + VOICE_STEAL_FADE_SECONDS;
  gain.exponentialRampToValueAtTime(0.0001, fadeEnd);
  return fadeEnd;
}

/** Sample a note-local automation lane into a Float32Array for setValueCurveAtTime. */
function laneToCurve(
  lane: NoteAutomationWindow[keyof NoteAutomationWindow],
  duration: number,
  map: (value: number) => number,
): Float32Array | null {
  if (!lane?.points || lane.points.length === 0) return null;
  const count = Math.max(2, Math.min(CURVE_MAX_SAMPLES, Math.ceil(duration * CURVE_CONTROL_HZ)));
  const curve = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const t = (i / (count - 1)) * duration;
    curve[i] = map(sampleLaneAt(lane, t) ?? 0);
  }
  return curve;
}

/**
 * Build one Simple-Synth voice into `destination`. Returns null when the note is
 * inaudible (zero gain). `automation` is the clip automation already sliced to this
 * note's window (note-local seconds); the four lanes are hardwired to their
 * canonical destinations (cutoff→filter, mod→vibrato depth, expression→amp,
 * pitchBend→pitch), and the mod-matrix adds velocity-sourced routings on top.
 */
export function buildSimpleSynthVoice(
  ctx: BaseAudioContext,
  destination: AudioNode,
  instrument: SimpleSynthInstrument,
  pitch: number,
  velocity: number,
  when: number,
  duration: number,
  automation?: NoteAutomationWindow,
  forcedStopAt?: number,
): VoiceHandle | null {
  const startAt = Math.max(when, ctx.currentTime);
  const freq = midiPitchToFrequency(pitch);

  const peak = clamp01(velocity) * clamp01(instrument.gain);
  if (peak <= 0) return null;

  const sources: AudioScheduledSourceNode[] = [];
  const nodes: AudioNode[] = [];

  // --- Amp ADSR (intrinsic, single writer — keeps exponential ramps) -----------
  const voiceTiming = getSimpleSynthVoiceTiming(instrument.adsr, startAt, duration);
  const { attack, decay } = voiceTiming;
  const sustain = clamp01(instrument.adsr.sustain);
  const sustainLevel = Math.max(0.0001, peak * sustain);

  const ampGain = ctx.createGain();
  nodes.push(ampGain);
  ampGain.gain.setValueAtTime(0.0001, startAt);
  const attackEnd = startAt + attack;
  ampGain.gain.exponentialRampToValueAtTime(peak, attackEnd);
  const decayEnd = attackEnd + decay;
  ampGain.gain.exponentialRampToValueAtTime(sustainLevel, decayEnd);
  const noteOff = voiceTiming.noteOffTime;
  ampGain.gain.setValueAtTime(sustainLevel, noteOff);
  const releaseEnd = voiceTiming.endsAt;
  ampGain.gain.exponentialRampToValueAtTime(0.0001, releaseEnd);
  const forcedFadeStart = forcedStopAt !== undefined && forcedStopAt < releaseEnd
    ? Math.max(startAt, forcedStopAt)
    : null;
  const forcedFadeEnd = forcedFadeStart === null
    ? null
    : scheduleVoiceGainFade(ampGain.gain, forcedFadeStart);
  // Latest time any source must keep running (extended by a longer filter release).
  let latestEnd = releaseEnd;

  // --- Oscillator --------------------------------------------------------------
  const osc = ctx.createOscillator();
  osc.type = instrument.waveform;
  osc.frequency.setValueAtTime(freq, startAt);
  sources.push(osc);
  nodes.push(osc);

  // Velocity-sourced mod-matrix routings the JS DSP honors (plan §3/§6B); the rest
  // are the durable schema's job and are left to the future compiled core.
  let velEnvScale = 1;
  let velCutoffAddHz = 0;
  for (const route of instrument.modMatrix ?? []) {
    if (route.source !== 'velocity') continue;
    if (route.destination.kind === 'filterEnvAmount') {
      velEnvScale *= 1 + clamp01(route.amount) * (clamp01(velocity) - 1);
    } else if (route.destination.kind === 'filterCutoff') {
      velCutoffAddHz += clamp01(velocity) * route.amount;
    }
  }

  // --- Filter + its additive carriers ------------------------------------------
  let ampInput: AudioNode = osc;
  const filterCfg = instrument.filter;
  if (filterCfg) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = clampFilterHz(filterCfg.cutoff + velCutoffAddHz); // base (never scripted)
    filter.Q.value = clampFilterQ(filterCfg.resonance);
    nodes.push(filter);
    osc.connect(filter);
    ampInput = filter;

    // Filter envelope carrier: normalized 0→1 ADSR on offset, scaled by envAmount.
    const env = instrument.filterEnv;
    const envAmount = filterCfg.envAmount * velEnvScale;
    if (env && envAmount !== 0) {
      const fa = Math.max(0.001, env.attack);
      const fd = Math.max(0.001, env.decay);
      const fr = Math.max(0.005, env.release);
      const fs = clamp01(env.sustain);
      // Keep event times strictly monotonic (like the amp env) so a short note
      // can't schedule the sustain hold before the decay ramp completes.
      const fDecayEnd = startAt + fa + fd;
      const fNoteOff = Math.max(fDecayEnd, noteOff);
      const envCarrier = ctx.createConstantSource();
      envCarrier.offset.setValueAtTime(0, startAt);
      envCarrier.offset.linearRampToValueAtTime(1, startAt + fa);
      envCarrier.offset.linearRampToValueAtTime(fs, fDecayEnd);
      envCarrier.offset.setValueAtTime(fs, fNoteOff);
      envCarrier.offset.linearRampToValueAtTime(0, fNoteOff + fr);
      latestEnd = Math.max(latestEnd, fNoteOff + fr);
      const envGain = ctx.createGain();
      envGain.gain.value = envAmount; // Hz at the env peak; may be negative
      envCarrier.connect(envGain);
      envGain.connect(filter.frequency);
      sources.push(envCarrier);
      nodes.push(envCarrier, envGain);
    }

    // Keytrack carrier: constant Hz offset from the note's distance to middle C.
    const kt = keytrackCutoffHz(pitch, filterCfg.keytrack);
    if (kt !== 0) {
      const ktCarrier = ctx.createConstantSource();
      ktCarrier.offset.setValueAtTime(kt, startAt);
      ktCarrier.connect(filter.frequency);
      sources.push(ktCarrier);
      nodes.push(ktCarrier);
    }

    // Cutoff automation carrier (CC74): setValueCurve on its OWN offset, summed in.
    const cutoffCurve = laneToCurve(automation?.cutoff, duration, (v) => clamp01(v) * CUTOFF_CC_RANGE_HZ);
    if (cutoffCurve) {
      const autoCarrier = ctx.createConstantSource();
      // The curve fully defines the offset over the note; no setValueAtTime before
      // it — an event at the curve's start instant throws NotSupportedError.
      autoCarrier.offset.setValueCurveAtTime(cutoffCurve, startAt, Math.max(0.02, duration));
      autoCarrier.connect(filter.frequency);
      sources.push(autoCarrier);
      nodes.push(autoCarrier);
    }
  }

  // --- LFOs (per-voice) --------------------------------------------------------
  // `global` shared LFOs are a documented follow-up; v1 renders every LFO per-voice
  // (retrigger + true vibrato), which is deterministic in both live and offline.
  for (const lfo of instrument.lfos ?? []) {
    attachLfo(ctx, lfo, { osc, filterFreq: filterCfg ? (ampInput as BiquadFilterNode).frequency : null,
      freq, startAt, endAt: latestEnd, duration, automation, sources, nodes });
  }

  // --- Pitch-bend carrier (into osc.frequency) ---------------------------------
  const bendRange = instrument.pitchBendRange ?? 2;
  const bendCurve = laneToCurve(automation?.pitchBend, duration, (v) => semitonesToHzDelta(freq, Math.max(-1, Math.min(1, v)) * bendRange));
  if (bendCurve) {
    const pbCarrier = ctx.createConstantSource();
    pbCarrier.offset.setValueCurveAtTime(bendCurve, startAt, Math.max(0.02, duration));
    pbCarrier.connect(osc.frequency);
    sources.push(pbCarrier);
    nodes.push(pbCarrier);
  }

  // --- Expression (amp) series stage: CC11 + amp-target LFO tremolo -------------
  const exprCurve = laneToCurve(automation?.expression, duration, (v) => clamp01(v));
  const ampLfos = (instrument.lfos ?? []).filter((l) => l.target === 'amp');
  if (exprCurve || ampLfos.length > 0) {
    const exprGain = ctx.createGain();
    nodes.push(exprGain);
    if (exprCurve) {
      exprGain.gain.setValueCurveAtTime(exprCurve, startAt, Math.max(0.02, duration));
    } else {
      exprGain.gain.setValueAtTime(1, startAt);
    }
    for (const lfo of ampLfos) {
      const { source, gain } = makeLfoNode(ctx, lfo, clamp01(lfo.depth));
      source.connect(gain);
      gain.connect(exprGain.gain); // sums onto the intrinsic expression value
      sources.push(source);        // started once in the uniform loop below
      nodes.push(source, gain);
    }
    ampInput.connect(ampGain);
    ampGain.connect(exprGain);
    exprGain.connect(destination);
  } else {
    ampInput.connect(ampGain);
    ampGain.connect(destination);
  }

  // --- Start / stop every source deterministically -----------------------------
  if (forcedFadeEnd !== null) latestEnd = forcedFadeEnd;
  const stopAt = forcedFadeStart === null ? latestEnd + 0.02 : forcedFadeStart + 0.03;
  for (const src of sources) {
    src.start(startAt);
    src.stop(stopAt);
  }

  return {
    ampGain,
    velocity: clamp01(velocity),
    startAt,
    noteOff: forcedFadeStart === null ? noteOff : Math.min(noteOff, forcedFadeStart),
    endsAt: forcedFadeEnd ?? releaseEnd,
    stop(atTime: number) {
      for (const src of sources) {
        try { src.stop(atTime); } catch { /* already stopped */ }
      }
    },
    disconnect() {
      for (const node of nodes) {
        try { node.disconnect(); } catch { /* already disconnected */ }
      }
    },
    onEnded(cb: () => void) {
      osc.onended = () => cb();
    },
  };
}

/** Create an LFO oscillator + its depth gain (not yet started/connected). */
function makeLfoNode(
  ctx: BaseAudioContext,
  lfo: SynthLfo,
  depth: number,
): { source: OscillatorNode; gain: GainNode } {
  const source = ctx.createOscillator();
  source.type = lfo.shape;
  source.frequency.value = Math.max(0.01, lfo.rate);
  const gain = ctx.createGain();
  gain.gain.value = depth;
  return { source, gain };
}

interface LfoWiring {
  osc: OscillatorNode;
  filterFreq: AudioParam | null;
  freq: number;
  startAt: number;
  endAt: number;
  duration: number;
  automation?: NoteAutomationWindow;
  sources: AudioScheduledSourceNode[];
  nodes: AudioNode[];
}

/** Wire a pitch/filter LFO to its target param (amp LFOs are handled inline). */
function attachLfo(ctx: BaseAudioContext, lfo: SynthLfo, w: LfoWiring): void {
  if (lfo.target === 'amp') return; // tremolo wired in the expression stage
  const target = lfo.target === 'pitch' ? w.osc.frequency : w.filterFreq;
  if (!target) return;

  const source = ctx.createOscillator();
  source.type = lfo.shape;
  source.frequency.value = Math.max(0.01, lfo.rate);
  const gain = ctx.createGain();

  if (lfo.target === 'pitch') {
    const baseDepthHz = centsToHzDelta(w.freq, lfo.depth);
    // Mod wheel (CC1) rides on top of the base vibrato depth (the standard row).
    const modCurve = laneToCurve(
      w.automation?.mod,
      w.duration,
      (v) => baseDepthHz + centsToHzDelta(w.freq, clamp01(v) * MOD_WHEEL_VIBRATO_CENTS),
    );
    if (modCurve) {
      gain.gain.setValueCurveAtTime(modCurve, w.startAt, Math.max(0.02, w.duration));
    } else {
      gain.gain.value = baseDepthHz;
    }
  } else {
    gain.gain.value = lfo.depth; // filter target: depth already in Hz
  }

  source.connect(gain);
  gain.connect(target);
  w.sources.push(source); // started once in the uniform loop in buildSimpleSynthVoice
  w.nodes.push(source, gain);
}
