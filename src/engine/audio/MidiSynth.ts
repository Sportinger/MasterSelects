// Internal MIDI synth (issue #182, Phase 4).
//
// A deliberately simple WebAudio instrument that renders MIDI notes to sound:
// one oscillator per voice shaped by an ADSR envelope, polyphonic. It is kept
// behind the `MidiInstrument` abstraction (see src/types/midiClip.ts) so future
// real DAW-style instruments (sampler, FM, …) can replace it without changing
// the scheduler or data model.
//
// The synth is agnostic about *when* notes play: callers pass AudioContext-time
// timestamps. The live transport scheduler (midiPlaybackScheduler) converts
// timeline seconds into context time; the piano roll uses `previewNote` for an
// immediate audible blip; the offline export path reuses `scheduleNote` against
// an OfflineAudioContext.

import type { MidiInstrument } from '../../types/midiClip';
import { Logger } from '../../services/logger';

const log = Logger.create('MidiSynth');

/** Convert a MIDI note number to frequency in Hz (A4 = 69 = 440 Hz). */
export function midiPitchToFrequency(pitch: number): number {
  return 440 * Math.pow(2, (pitch - 69) / 12);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

interface ActiveVoice {
  osc: OscillatorNode;
  gain: GainNode;
  /** AudioContext time at which the voice's release fully completes. */
  endsAt: number;
}

/**
 * Polyphonic triangle/-ish synth. One instance wraps a single AudioContext (live
 * or offline) and an output node to connect into (e.g. the master mixer input).
 */
export class MidiSynth {
  private readonly context: BaseAudioContext;
  private readonly destination: AudioNode;
  private readonly voices = new Set<ActiveVoice>();

  constructor(context: BaseAudioContext, destination: AudioNode) {
    this.context = context;
    this.destination = destination;
  }

  /**
   * Schedule a complete note with a baked-in ADSR envelope. `when` and `duration`
   * are in seconds on this synth's AudioContext clock. The note holds at its
   * sustain level for `duration`, then releases. Safe to call ahead of time
   * (look-ahead scheduling) — the envelope is fully scheduled on the param.
   */
  scheduleNote(
    instrument: MidiInstrument,
    pitch: number,
    velocity: number,
    when: number,
    duration: number,
  ): void {
    const ctx = this.context;
    const startAt = Math.max(when, ctx.currentTime);

    const attack = Math.max(0.001, instrument.adsr.attack);
    const decay = Math.max(0.001, instrument.adsr.decay);
    const release = Math.max(0.005, instrument.adsr.release);
    const sustain = clamp01(instrument.adsr.sustain);

    const peak = clamp01(velocity) * clamp01(instrument.gain);
    if (peak <= 0) return;
    const sustainLevel = Math.max(0.0001, peak * sustain);

    const osc = ctx.createOscillator();
    osc.type = instrument.waveform;
    osc.frequency.setValueAtTime(midiPitchToFrequency(pitch), startAt);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, startAt);

    // Attack -> peak
    const attackEnd = startAt + attack;
    gain.gain.exponentialRampToValueAtTime(peak, attackEnd);
    // Decay -> sustain
    const decayEnd = attackEnd + decay;
    gain.gain.exponentialRampToValueAtTime(sustainLevel, decayEnd);

    // Hold sustain until note-off, then release to (near) zero.
    const noteOff = Math.max(decayEnd, startAt + Math.max(0.02, duration));
    gain.gain.setValueAtTime(sustainLevel, noteOff);
    const releaseEnd = noteOff + release;
    gain.gain.exponentialRampToValueAtTime(0.0001, releaseEnd);

    osc.connect(gain);
    gain.connect(this.destination);
    osc.start(startAt);
    osc.stop(releaseEnd + 0.02);

    const voice: ActiveVoice = { osc, gain, endsAt: releaseEnd };
    this.voices.add(voice);
    osc.onended = () => {
      try {
        gain.disconnect();
      } catch {
        // node may already be disconnected
      }
      this.voices.delete(voice);
    };
  }

  /** Play an immediate short note (piano-roll preview when drawing/clicking). */
  previewNote(instrument: MidiInstrument, pitch: number, velocity = 0.8, duration = 0.3): void {
    if (!('currentTime' in this.context)) return;
    this.scheduleNote(instrument, pitch, velocity, this.context.currentTime, duration);
  }

  /**
   * Flush all sounding/scheduled voices with a tiny fade to avoid clicks. Used on
   * stop/pause/seek so notes don't ring out after the transport jumps.
   */
  stopAll(): void {
    const now = this.context.currentTime;
    for (const voice of this.voices) {
      try {
        voice.gain.gain.cancelScheduledValues(now);
        const current = Math.max(0.0001, voice.gain.gain.value);
        voice.gain.gain.setValueAtTime(current, now);
        voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.02);
        voice.osc.stop(now + 0.03);
      } catch {
        // ignore voices already stopped
      }
    }
    log.debug('stopAll: flushed voices', { count: this.voices.size });
  }

  /** Number of currently tracked voices (for diagnostics/tests). */
  get voiceCount(): number {
    return this.voices.size;
  }
}
