// Offline render of MIDI clips to AudioBuffers for export (issue #182, Phase 5).
//
// A MIDI clip carries note data; the track carries the instrument. For export we
// render each clip's notes through the same `MidiSynth` used at playback, but into
// an `OfflineAudioContext`, producing an AudioBuffer that flows through the exact
// same clip-effects → track-effects → mix → master path as real audio clips
// (full mixer parity, no separate MIDI export path).

import type { TimelineClip, TimelineTrack } from '../../types';
import { createDefaultMidiInstrument, type MidiInstrument } from '../../types/midiClip';
import { MidiSynth } from './MidiSynth';
import { Logger } from '../../services/logger';

const log = Logger.create('MidiClipRenderer');

/** A note resolved to clip-local schedule times, ready for MidiSynth.scheduleNote. */
export interface PlannedMidiNote {
  pitch: number;
  startTime: number; // seconds, clip-local (0 = clip start)
  duration: number;  // seconds
  velocity: number;  // 0–1
}

export interface MidiClipRenderPlan {
  notes: PlannedMidiNote[];
  durationSeconds: number;
  instrument: MidiInstrument;
}

/**
 * Resolve a MIDI clip + its track into a render plan. Pure (no WebAudio) so the
 * note/timing logic is unit-testable. Notes are clip-local already
 * (`note.start` is relative to the clip start); we drop notes that begin at or
 * after the clip end and bound the render length to the clip duration so a clip's
 * audio never bleeds past its timeline region (matching audio-clip boundaries).
 */
export function planMidiClipNotes(
  clip: TimelineClip,
  track: TimelineTrack | undefined,
): MidiClipRenderPlan {
  const instrument = track?.midiInstrument ?? createDefaultMidiInstrument();
  const durationSeconds = Math.max(0.001, clip.duration);
  const sourceNotes = clip.midiData?.notes ?? [];

  const notes: PlannedMidiNote[] = [];
  for (const note of sourceNotes) {
    const startTime = Math.max(0, note.start);
    if (startTime >= durationSeconds) continue; // begins after the clip ends
    notes.push({
      pitch: note.pitch,
      startTime,
      // Don't let a note's body run past the clip edge; release may still be cut
      // by the offline context length, same as an audio clip trimmed at its out.
      duration: Math.max(0.001, Math.min(note.duration, durationSeconds - startTime)),
      velocity: note.velocity,
    });
  }

  return { notes, durationSeconds, instrument };
}

function getOfflineAudioContextCtor(): typeof OfflineAudioContext | null {
  const scope = globalThis as typeof globalThis & {
    webkitOfflineAudioContext?: typeof OfflineAudioContext;
  };
  return globalThis.OfflineAudioContext ?? scope.webkitOfflineAudioContext ?? null;
}

/**
 * Render a MIDI clip's notes to a stereo AudioBuffer at the given sample rate.
 * Returns null when there is nothing to render (no notes) or when offline audio
 * rendering is unavailable (e.g. non-browser test env).
 */
export async function renderMidiClipToBuffer(
  clip: TimelineClip,
  track: TimelineTrack | undefined,
  sampleRate: number,
): Promise<AudioBuffer | null> {
  const plan = planMidiClipNotes(clip, track);
  if (plan.notes.length === 0) {
    return null;
  }

  const OfflineCtor = getOfflineAudioContextCtor();
  if (!OfflineCtor) {
    log.warn('OfflineAudioContext unavailable; cannot render MIDI clip', { clip: clip.name });
    return null;
  }

  const frames = Math.max(1, Math.ceil(plan.durationSeconds * sampleRate));
  const context = new OfflineCtor(2, frames, sampleRate);
  const synth = new MidiSynth(context, context.destination);

  for (const note of plan.notes) {
    synth.scheduleNote(plan.instrument, note.pitch, note.velocity, note.startTime, note.duration);
  }

  const buffer = await context.startRendering();
  log.debug('Rendered MIDI clip', {
    clip: clip.name,
    notes: plan.notes.length,
    seconds: plan.durationSeconds.toFixed(2),
  });
  return buffer;
}
