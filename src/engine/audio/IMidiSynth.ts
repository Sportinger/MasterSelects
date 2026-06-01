// Shared MIDI synth interface (issue #193).
//
// The one seam every note producer routes through, so the live scheduler, piano-
// roll preview, and offline export renderer can swap synth implementations
// (simple oscillator vs General MIDI wavetable) per MIDI track without any of them
// knowing which concrete synth they hold. `MidiSynth` (oscillator) and the future
// `WavetableSynth` (GM samples) both implement this; `createSynthForInstrument`
// picks the right one from a track's instrument.

import type { MidiInstrument } from '../../types/midiClip';
import type { GmSoundRef } from './GmSampleBank';

export interface IMidiSynth {
  /**
   * Schedule a complete note (with its envelope) at AudioContext time `when` for
   * `duration` seconds. Safe to call ahead of time (look-ahead scheduling).
   */
  scheduleNote(
    inst: MidiInstrument,
    pitch: number,
    velocity: number,
    when: number,
    duration: number,
  ): void;

  /** Play an immediate short note (piano-roll draw/click preview). */
  previewNote(inst: MidiInstrument, pitch: number, velocity?: number, duration?: number): void;

  /** Flush all sounding/scheduled voices (stop/pause/seek). */
  stopAll(): void;

  /**
   * Ensure samples for the given GM sounds (program + drum flag) are loaded before
   * notes are scheduled. No-op for synths that need no assets (the simple synth).
   */
  preload(refs: GmSoundRef[]): Promise<void>;

  /** Number of currently tracked voices (diagnostics/tests). */
  readonly voiceCount: number;
}
