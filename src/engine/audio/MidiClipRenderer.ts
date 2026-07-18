// Offline render of MIDI clips to AudioBuffers for export (issue #182, Phase 5).
//
// A MIDI clip carries note data; the track carries the instrument. For export we
// render each clip's notes through the same `MidiSynth` used at playback, but into
// an `OfflineAudioContext`, producing an AudioBuffer that flows through the exact
// same clip-effects → track-effects → mix → master path as real audio clips
// (full mixer parity, no separate MIDI export path).

import type { TimelineClip, TimelineTrack } from '../../types';
import {
  createDefaultMidiInstrument,
  type MidiInstrument,
  type NoteAutomationWindow,
} from '../../types/midiClip';
import { createSynthForInstrument } from './createSynthForInstrument';
import { contentTimeToClipLocal, isNoteStartInWindow } from '../../services/midi/midiClipTiming';
import { sliceAutomationToNote } from '../../services/midi/midiAutomationWindow';
import {
  DEFAULT_MAX_VOICES,
  planConcurrentNoteStops,
} from '../../services/midi/midiVoiceCap';
import { Logger } from '../../services/logger';
import { getSimpleSynthVoiceTiming } from './synth/synthVoiceMath';

const log = Logger.create('MidiClipRenderer');

/** A note resolved to clip-local schedule times, ready for MidiSynth.scheduleNote. */
export interface PlannedMidiNote {
  pitch: number;
  startTime: number; // seconds, clip-local (0 = clip start)
  duration: number;  // seconds
  velocity: number;  // 0–1
  /** Clip-local context time at which voice stealing starts its short fade. */
  forcedStopAt?: number;
  // Clip automation sliced to this note's window, note-local (plan §3a). Sliced
  // per note in BOTH paths so offline export and live playback bake identical
  // modulation — the §2 offline-parity guarantee.
  automation?: NoteAutomationWindow;
}

export interface MidiClipRenderPlan {
  notes: PlannedMidiNote[];
  durationSeconds: number;
  instrument: MidiInstrument;
}

/**
 * Resolve a MIDI clip + its track into a render plan. Pure (no WebAudio) so the
 * note/timing logic is unit-testable. `note.start` is content time; we keep only
 * notes inside the clip's in/out window, position them relative to the window's
 * left edge, drop ones that begin at or after the clip end, and bound the render
 * length to the clip duration so a clip's audio never bleeds past its timeline
 * region (matching audio-clip boundaries).
 */
export function planMidiClipNotes(
  clip: TimelineClip,
  track: TimelineTrack | undefined,
  applyVoiceCap = true,
): MidiClipRenderPlan {
  const instrument = track?.midiInstrument ?? createDefaultMidiInstrument();
  const durationSeconds = Math.max(0.001, clip.duration);
  const sourceNotes = clip.midiData?.notes ?? [];

  const notes: PlannedMidiNote[] = [];
  for (const note of sourceNotes) {
    // Notes outside the clip's in/out window are silent (#232); inside, position
    // them relative to the window's left edge so a resized clip renders correctly.
    if (!isNoteStartInWindow(clip, note)) continue;
    const startTime = Math.max(0, contentTimeToClipLocal(clip, note.start));
    if (startTime >= durationSeconds) continue; // begins after the clip ends
    // Don't let a note's body run past the clip edge; release may still be cut
    // by the offline context length, same as an audio clip trimmed at its out.
    const duration = Math.max(0.001, Math.min(note.duration, durationSeconds - startTime));
    notes.push({
      pitch: note.pitch,
      startTime,
      duration,
      velocity: note.velocity,
      // Automation is stored in content time (like note.start), so slice from the
      // note's original content start — not the clip-local startTime.
      automation: sliceAutomationToNote(clip.automation, note.start, duration),
    });
  }

  // Enforce the Simple Synth polyphony cap analytically (no runtime stealing
  // offline). The shared envelope lifetime + arrival-time victim selector includes
  // release tails exactly as the live look-ahead synth does. GM playback has no
  // live cap, so its offline plan must remain uncapped too.
  let plannedNotes = notes;
  if (applyVoiceCap && instrument.kind === 'simple-synth') {
    const forcedStops = planConcurrentNoteStops(notes, DEFAULT_MAX_VOICES, (note) => {
      const timing = getSimpleSynthVoiceTiming(instrument.adsr, note.startTime, note.duration);
      return { noteOffTime: timing.noteOffTime, endsAt: timing.endsAt };
    });
    plannedNotes = notes.flatMap((note) => {
      const forcedStopAt = forcedStops.get(note);
      if (forcedStopAt === undefined) return [note];
      if (forcedStopAt <= note.startTime) return [];
      return [{ ...note, forcedStopAt }];
    });
    if (forcedStops.size > 0) {
      log.debug('Voice cap planned forced stops', { count: forcedStops.size });
    }
  }

  return { notes: plannedNotes, durationSeconds, instrument };
}

interface TrackPlannedMidiNote extends PlannedMidiNote {
  clipId: string;
  clipStartTime: number;
  note: PlannedMidiNote;
}

/**
 * Plan every MIDI clip on a track under one shared polyphony ceiling. Live
 * playback owns one synth bus per track, so export must make admission decisions
 * over the same absolute-time note stream instead of capping each clip alone.
 */
export function planMidiTrackClips(
  clips: readonly TimelineClip[],
  track: TimelineTrack,
): Map<string, MidiClipRenderPlan> {
  const plans = new Map<string, MidiClipRenderPlan>();
  for (const clip of clips) {
    plans.set(clip.id, planMidiClipNotes(clip, track, false));
  }

  const instrument = track.midiInstrument ?? createDefaultMidiInstrument();
  if (instrument.kind !== 'simple-synth') return plans;

  const trackNotes: TrackPlannedMidiNote[] = [];
  for (const clip of clips) {
    const plan = plans.get(clip.id);
    if (!plan) continue;
    for (const note of plan.notes) {
      trackNotes.push({
        ...note,
        clipId: clip.id,
        clipStartTime: clip.startTime,
        note,
        startTime: clip.startTime + note.startTime,
      });
    }
  }

  const forcedStops = planConcurrentNoteStops(trackNotes, DEFAULT_MAX_VOICES, (note) => {
    const timing = getSimpleSynthVoiceTiming(instrument.adsr, note.startTime, note.duration);
    return { noteOffTime: timing.noteOffTime, endsAt: timing.endsAt };
  });
  const entryByNote = new Map(trackNotes.map((entry) => [entry.note, entry]));
  for (const [clipId, plan] of plans) {
    const plannedNotes = plan.notes.flatMap((note) => {
      const entry = entryByNote.get(note);
      const absoluteStopAt = entry ? forcedStops.get(entry) : undefined;
      if (absoluteStopAt === undefined || !entry) return [note];
      const forcedStopAt = absoluteStopAt - entry.clipStartTime;
      if (forcedStopAt <= note.startTime) return [];
      return [{ ...note, forcedStopAt }];
    });
    plans.set(clipId, { ...plan, notes: plannedNotes });
  }
  return plans;
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
  preparedPlan?: MidiClipRenderPlan,
): Promise<AudioBuffer | null> {
  const plan = preparedPlan ?? planMidiClipNotes(clip, track);
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
  const synth = createSynthForInstrument(plan.instrument, context, context.destination);

  for (const note of plan.notes) {
    synth.scheduleNote(
      plan.instrument,
      note.pitch,
      note.velocity,
      note.startTime,
      note.duration,
      note.automation,
      note.forcedStopAt,
    );
  }

  const buffer = await context.startRendering();
  log.debug('Rendered MIDI clip', {
    clip: clip.name,
    notes: plan.notes.length,
    seconds: plan.durationSeconds.toFixed(2),
  });
  return buffer;
}
