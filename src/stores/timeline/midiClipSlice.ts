// MIDI clip actions slice (issue #182).
//
// A MIDI clip is a data-only `TimelineClip` with `source.type === 'midi'` and
// note data in `clip.midiData`. It carries no media file (like solid/text/camera
// clips, it uses a placeholder `File`) and is rendered to audio by the track's
// instrument, not by the visual layer pipeline. Note CRUD actions are added in
// the piano-roll phase; this slice currently owns clip creation.

import type { TimelineClip } from '../../types';
import type { MidiClipData, MidiNote } from '../../types/midiClip';
import type { MidiClipActions, SliceCreator } from './types';
import { DEFAULT_TRANSFORM } from './constants';
import { generateMidiClipId, generateMidiNoteId } from './helpers/idGenerator';
import { captureSnapshot } from '../historyStore';
import { Logger } from '../../services/logger';

const log = Logger.create('MidiClipSlice');

const MIN_MIDI_CLIP_DURATION = 0.05;
const MIN_MIDI_NOTE_DURATION = 0.02;

function clampPitch(pitch: number): number {
  return Math.max(0, Math.min(127, Math.round(pitch)));
}

function clampVelocity(velocity: number): number {
  return Math.max(0, Math.min(1, velocity));
}

/** Replace a clip's midiData notes immutably, leaving other clips untouched. */
function mapClipNotes(
  clips: TimelineClip[],
  clipId: string,
  updater: (notes: MidiNote[]) => MidiNote[],
): TimelineClip[] {
  return clips.map((clip) => {
    if (clip.id !== clipId) return clip;
    const current: MidiClipData = clip.midiData ?? { notes: [] };
    return { ...clip, midiData: { ...current, notes: updater(current.notes) } };
  });
}

export const createMidiClipSlice: SliceCreator<MidiClipActions> = (set, get) => ({
  addMidiClip: (trackId, startTime, duration = 4) => {
    const { clips, tracks, updateDuration, invalidateCache } = get();
    const track = tracks.find(t => t.id === trackId);

    if (!track || track.type !== 'midi') {
      log.warn('MIDI clips can only be added to MIDI tracks', { trackId, trackType: track?.type });
      return null;
    }

    const safeStart = Math.max(0, startTime);
    const safeDuration = Math.max(MIN_MIDI_CLIP_DURATION, duration);
    const clipId = generateMidiClipId();

    const midiClip: TimelineClip = {
      id: clipId,
      trackId,
      name: 'MIDI Clip',
      // MIDI clips have no media file; use a placeholder like other data-only clips.
      file: new File([], 'midi-clip.dat', { type: 'application/octet-stream' }),
      startTime: safeStart,
      duration: safeDuration,
      inPoint: 0,
      outPoint: safeDuration,
      source: { type: 'midi', naturalDuration: safeDuration },
      transform: { ...DEFAULT_TRANSFORM },
      effects: [],
      midiData: { notes: [] },
      isLoading: false,
    };

    set({ clips: [...clips, midiClip] });
    updateDuration();
    invalidateCache();

    log.debug('Created MIDI clip', { clipId, trackId, startTime: safeStart, duration: safeDuration });
    return clipId;
  },

  clipRenameId: null,

  setClipRenameId: (clipId) => {
    set({ clipRenameId: clipId });
  },

  renameMidiClip: (clipId, name) => {
    const { clips } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip || clip.source?.type !== 'midi') {
      log.warn('Cannot rename: not a MIDI clip', { clipId });
      return;
    }
    const trimmed = name.trim();
    if (!trimmed || trimmed === clip.name) return;
    captureSnapshot('Rename MIDI clip');
    set({ clips: clips.map(c => (c.id === clipId ? { ...c, name: trimmed } : c)) });
  },

  addMidiNote: (clipId, note) => {
    const { clips, invalidateCache } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip || clip.source?.type !== 'midi') {
      log.warn('Cannot add MIDI note: not a MIDI clip', { clipId });
      return null;
    }

    const noteId = generateMidiNoteId();
    const newNote: MidiNote = {
      id: noteId,
      pitch: clampPitch(note.pitch),
      start: Math.max(0, note.start),
      duration: Math.max(MIN_MIDI_NOTE_DURATION, note.duration),
      velocity: clampVelocity(note.velocity ?? 0.8),
    };

    set({ clips: mapClipNotes(clips, clipId, notes => [...notes, newNote]) });
    invalidateCache();
    captureSnapshot('Add MIDI note');
    return noteId;
  },

  updateMidiNote: (clipId, noteId, patch, options) => {
    const { clips, invalidateCache } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip || clip.source?.type !== 'midi') return;

    set({
      clips: mapClipNotes(clips, clipId, notes => notes.map((n) => {
        if (n.id !== noteId) return n;
        return {
          ...n,
          ...(patch.pitch !== undefined ? { pitch: clampPitch(patch.pitch) } : {}),
          ...(patch.start !== undefined ? { start: Math.max(0, patch.start) } : {}),
          ...(patch.duration !== undefined ? { duration: Math.max(MIN_MIDI_NOTE_DURATION, patch.duration) } : {}),
          ...(patch.velocity !== undefined ? { velocity: clampVelocity(patch.velocity) } : {}),
        };
      })),
    });
    invalidateCache();
    // Live drags pass captureHistory:false; the final commit captures one snapshot.
    if (options?.captureHistory !== false) {
      captureSnapshot('Edit MIDI note');
    }
  },

  removeMidiNote: (clipId, noteId) => {
    const { clips, invalidateCache } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip || clip.source?.type !== 'midi') return;

    set({ clips: mapClipNotes(clips, clipId, notes => notes.filter(n => n.id !== noteId)) });
    invalidateCache();
    captureSnapshot('Delete MIDI note');
  },

  removeMidiNotes: (clipId, noteIds) => {
    const { clips, invalidateCache } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip || clip.source?.type !== 'midi' || noteIds.length === 0) return;

    // Batch delete so a multi-note selection collapses into ONE undo step
    // (the piano-roll select tool's Delete). A per-note removeMidiNote loop
    // would push N snapshots and require N undos.
    const ids = new Set(noteIds);
    set({ clips: mapClipNotes(clips, clipId, notes => notes.filter(n => !ids.has(n.id))) });
    invalidateCache();
    captureSnapshot(noteIds.length === 1 ? 'Delete MIDI note' : 'Delete MIDI notes');
  },
});
