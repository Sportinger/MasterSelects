// Shared MIDI synth interface (issue #193).
//
// The one seam every note producer routes through, so the live scheduler, piano-
// roll preview, and offline export renderer can swap synth implementations
// (simple oscillator vs General MIDI wavetable) per MIDI track without any of them
// knowing which concrete synth they hold. `MidiSynth` (oscillator) and the future
// `WavetableSynth` (GM samples) both implement this; `createSynthForInstrument`
// picks the right one from a track's instrument.

import type { MidiInstrument, NoteAutomationWindow } from '../../types/midiClip';
import type { GmSoundRef } from './GmSampleBank';

export interface IMidiSynth {
  /**
   * Schedule a complete note (with its envelope) at AudioContext time `when` for
   * `duration` seconds. Safe to call ahead of time (look-ahead scheduling).
   *
   * `automation` is the clip's automation sliced to this note's window with
   * note-local point times (plan §3a) — the simple synth bakes it onto the voice;
   * the wavetable synth ignores it. Optional so preview / legacy callers compile
   * unchanged and a future compiled DSP core can consume note + modulation in one
   * call without reshaping this seam.
   */
  scheduleNote(
    inst: MidiInstrument,
    pitch: number,
    velocity: number,
    when: number,
    duration: number,
    automation?: NoteAutomationWindow,
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
