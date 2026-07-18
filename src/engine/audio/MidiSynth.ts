// Internal MIDI synth (issue #182; subtractive upgrade #298).
//
// A polyphonic subtractive instrument: one oscillator → resonant lowpass filter →
// ADSR amp per voice, with a dedicated filter envelope, LFOs, and clip automation
// baked onto the voice. Kept behind the `IMidiSynth` abstraction (see
// src/engine/audio/IMidiSynth.ts) so a future compiled DSP core (FAUST→WASM in an
// AudioWorklet, plan §3a) can replace it without touching the scheduler or schema.
//
// The synth is agnostic about *when* notes play: callers pass AudioContext-time
// timestamps. The live transport scheduler (midiPlaybackScheduler) converts
// timeline seconds into context time; the piano roll uses `previewNote` for an
// immediate blip; the offline export path reuses `scheduleNote` against an
// OfflineAudioContext. The per-voice node graph lives in synth/MidiSynthVoice.ts;
// this file owns only voice lifecycle: polyphony, voice stealing, and flush.

import type { MidiInstrument, NoteAutomationWindow } from '../../types/midiClip';
import type { IMidiSynth } from './IMidiSynth';
import { buildSimpleSynthVoice, type VoiceHandle } from './synth/MidiSynthVoice';
import { midiPitchToFrequency } from './synth/synthVoiceMath';
import { DEFAULT_MAX_VOICES } from '../../services/midi/midiVoiceCap';
import { Logger } from '../../services/logger';

const log = Logger.create('MidiSynth');

// Re-exported for existing importers (tests, callers) after the pure math moved to
// the leaf module synth/synthVoiceMath.ts.
export { midiPitchToFrequency };

/**
 * Polyphonic subtractive synth. One instance wraps a single AudioContext (live or
 * offline) and an output node to connect into (e.g. the master mixer input).
 */
export class MidiSynth implements IMidiSynth {
  private readonly context: BaseAudioContext;
  private readonly destination: AudioNode;
  private readonly voices = new Set<VoiceHandle>();
  private readonly maxVoices: number;
  // OfflineAudioContext exposes `length`; a live AudioContext does not. Offline,
  // currentTime stays 0 during scheduling and voices never end mid-render, so
  // runtime stealing is both wrong (it would kill future notes at t=0) and
  // unnecessary — the analytic cap in midiVoiceCap owns offline polyphony (§5).
  private readonly isOffline: boolean;

  constructor(context: BaseAudioContext, destination: AudioNode, maxVoices: number = DEFAULT_MAX_VOICES) {
    this.context = context;
    this.destination = destination;
    this.maxVoices = Math.max(1, maxVoices);
    this.isOffline = 'length' in context;
  }

  /**
   * Schedule a complete note with a baked-in envelope + modulation. `when` and
   * `duration` are in seconds on this synth's AudioContext clock. Safe to call
   * ahead of time (look-ahead scheduling) — the whole voice is scheduled up front.
   */
  scheduleNote(
    instrument: MidiInstrument,
    pitch: number,
    velocity: number,
    when: number,
    duration: number,
    automation?: NoteAutomationWindow,
  ): void {
    // This synth only renders the oscillator instrument; GM instruments go to
    // WavetableSynth via the factory. Narrowing keeps the field access type-safe.
    if (instrument.kind !== 'simple-synth') return;

    // Live voice cap: steal before building so we never exceed the ceiling. (The
    // offline path caps analytically at plan time — see midiVoiceCap.)
    if (!this.isOffline && this.voices.size >= this.maxVoices) this.stealVoice();

    const voice = buildSimpleSynthVoice(
      this.context, this.destination, instrument, pitch, velocity, when, duration, automation,
    );
    if (!voice) return;

    this.voices.add(voice);
    voice.onEnded(() => {
      voice.disconnect();
      this.voices.delete(voice);
    });
  }

  /**
   * Steal one voice to stay under the cap: quietest voice already in its release
   * tail first, then quietest overall, then oldest. Faded fast (de-zipper) so the
   * steal doesn't click. Shares the "quietest, then oldest" ordering with the
   * offline analytic cap so playback and export drop the same notes (plan §5).
   */
  private stealVoice(): void {
    const now = this.context.currentTime;
    let victim: VoiceHandle | null = null;
    for (const voice of this.voices) {
      if (!victim || this.stealRank(voice, now) < this.stealRank(victim, now)) {
        victim = voice;
      }
    }
    if (!victim) return;
    this.fadeAndStop(victim, now);
    this.voices.delete(victim);
  }

  /** Lower rank = stolen first: releasing before held, then quieter, then older. */
  private stealRank(voice: VoiceHandle, now: number): number {
    const releasing = now >= voice.noteOff ? 0 : 1_000_000;
    // velocity dominates within a release class; startAt breaks ties (older wins).
    return releasing + voice.velocity * 1000 + voice.startAt * 0.001;
  }

  private fadeAndStop(voice: VoiceHandle, now: number): void {
    try {
      const g = voice.ampGain.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(Math.max(0.0001, g.value), now);
      g.exponentialRampToValueAtTime(0.0001, now + 0.02);
      voice.stop(now + 0.03);
    } catch {
      // voice already stopped
    }
  }

  /** Play an immediate short note (piano-roll preview when drawing/clicking). */
  previewNote(instrument: MidiInstrument, pitch: number, velocity = 0.8, duration = 0.3): void {
    if (!('currentTime' in this.context)) return;
    this.scheduleNote(instrument, pitch, velocity, this.context.currentTime, duration);
  }

  /** The oscillator synth needs no samples; preload is a no-op (IMidiSynth). */
  async preload(): Promise<void> {
    // intentionally empty
  }

  /**
   * Flush all sounding/scheduled voices with a tiny fade to avoid clicks. Used on
   * stop/pause/seek so notes don't ring out after the transport jumps.
   */
  stopAll(): void {
    const now = this.context.currentTime;
    const count = this.voices.size;
    for (const voice of this.voices) {
      this.fadeAndStop(voice, now);
    }
    log.debug('stopAll: flushed voices', { count });
  }

  /** Number of currently tracked voices (for diagnostics/tests). */
  get voiceCount(): number {
    return this.voices.size;
  }
}
