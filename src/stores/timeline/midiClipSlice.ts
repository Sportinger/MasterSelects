// MIDI clip actions slice (issue #182).
//
// A MIDI clip is a data-only `TimelineClip` with `source.type === 'midi'` and
// note data in `clip.midiData`. It carries no media file (like solid/text/camera
// clips, it uses a placeholder `File`) and is rendered to audio by the track's
// instrument, not by the visual layer pipeline. Note CRUD actions are added in
// the piano-roll phase; this slice currently owns clip creation.

import type { Keyframe, TimelineClip, TimelineTrack } from '../../types';
import type {
  AutomationPoint,
  MidiClipAutomation,
  MidiClipData,
  MidiClipProvenance,
  MidiNote,
} from '../../types/midiClip';
import type {
  CommitMidiTranscriptionInput,
  MidiClipActions,
  MidiTranscriptionNoteInput,
  MidiTranscriptionTrackInput,
  SliceCreator,
} from './types';
import { DEFAULT_TRANSFORM } from './constants';
import { generateMidiClipId, generateMidiNoteId, generateTrackId } from './helpers/idGenerator';
import { captureSnapshot } from '../historyStore';
import { Logger } from '../../services/logger';
import {
  getTimelineClipAudioSourceFileKey,
  resolveAudibleAudioClip,
} from '../../services/audio/audioClipResolution';
import { createProcessedClipAudioStateHash } from '../../services/audio/ProcessedWaveformPyramidService';

const log = Logger.create('MidiClipSlice');

const MIN_MIDI_CLIP_DURATION = 0.05;
const MIN_MIDI_NOTE_DURATION = 0.02;

function clampPitch(pitch: number): number {
  return Math.max(0, Math.min(127, Math.round(pitch)));
}

function clampVelocity(velocity: number): number {
  return Math.max(0, Math.min(1, velocity));
}

function getInstrumentLabel(track: MidiTranscriptionTrackInput): string {
  if (track.displayName?.trim()) return track.displayName.trim();
  return track.instrumentId
    .split('_')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizeTranscriptionNote(note: MidiTranscriptionNoteInput): Omit<MidiNote, 'id'> | null {
  if (![note.pitch, note.startTime, note.endTime].every(Number.isFinite)) return null;
  const start = Math.max(0, note.startTime);
  const end = Math.max(0, note.endTime);
  if (end <= start) return null;
  return {
    pitch: clampPitch(note.pitch),
    start,
    duration: Math.max(MIN_MIDI_NOTE_DURATION, end - start),
    velocity: clampVelocity(Number.isFinite(note.velocity) ? note.velocity! : 0.8),
  };
}

function cloneProvenance(provenance: MidiClipProvenance | undefined): MidiClipProvenance | undefined {
  if (!provenance) return undefined;
  try {
    return JSON.parse(JSON.stringify(provenance)) as MidiClipProvenance;
  } catch {
    return undefined;
  }
}

function buildTranscriptionCommit(
  input: CommitMidiTranscriptionInput,
  clips: readonly TimelineClip[],
  tracks: readonly TimelineTrack[],
  clipKeyframes: ReadonlyMap<string, readonly Keyframe[]>,
): { tracks: TimelineTrack[]; clips: TimelineClip[]; trackIds: string[]; clipIds: string[] } | null {
  const resolved = resolveAudibleAudioClip(clips, input.sourceClipId);
  if (!resolved) return null;

  const currentSourceFileKey = getTimelineClipAudioSourceFileKey(resolved.audioClip);
  if (input.sourceFileKey === undefined || currentSourceFileKey !== input.sourceFileKey) return null;
  if (input.processingStateHash !== undefined) {
    const currentProcessingStateHash = createProcessedClipAudioStateHash(resolved.audioClip, {
      keyframes: clipKeyframes.get(resolved.audioClip.id) ?? [],
    });
    if (currentProcessingStateHash !== input.processingStateHash) return null;
  }

  const sourceTrackIds = new Set([resolved.requestedClip.trackId, resolved.audioClip.trackId]);
  if (tracks.some(track => sourceTrackIds.has(track.id) && track.locked)) return null;

  const preparedTracks = input.tracks.flatMap((inputTrack) => {
    const instrumentId = inputTrack.instrumentId.trim();
    if (!instrumentId || !Number.isFinite(inputTrack.gmProgram)) return [];
    const notes = inputTrack.notes.flatMap((inputNote) => {
      const note = normalizeTranscriptionNote(inputNote);
      return note ? [{ ...note, id: generateMidiNoteId() }] : [];
    });
    return notes.length > 0 ? [{ inputTrack, instrumentId, notes }] : [];
  });
  if (preparedTracks.length === 0) return null;

  const maxNoteEnd = Math.max(...preparedTracks.flatMap(track => (
    track.notes.map(note => note.start + note.duration)
  )));
  const clipDuration = Math.max(
    MIN_MIDI_CLIP_DURATION,
    resolved.audioClip.duration,
    maxNoteEnd,
  );
  const baseProvenance = cloneProvenance(input.provenance);
  const createdTracks: TimelineTrack[] = [];
  const createdClips: TimelineClip[] = [];

  for (const { inputTrack, instrumentId, notes } of preparedTracks) {
    const trackId = generateTrackId('midi');
    const clipId = generateMidiClipId();
    const program = Math.max(0, Math.min(127, Math.round(inputTrack.gmProgram)));
    const isDrum = inputTrack.isDrum === true;
    const label = getInstrumentLabel(inputTrack);
    createdTracks.push({
      id: trackId,
      name: `${label} MIDI`,
      type: 'midi',
      height: 40,
      muted: false,
      visible: true,
      solo: false,
      midiInstrument: { kind: 'gm', program, isDrum, gain: 0.8 },
    });
    createdClips.push({
      id: clipId,
      trackId,
      name: label,
      file: new File([], 'midi-transcription.dat', { type: 'application/octet-stream' }),
      startTime: resolved.audioClip.startTime,
      duration: clipDuration,
      inPoint: 0,
      outPoint: clipDuration,
      source: { type: 'midi', naturalDuration: clipDuration },
      transform: { ...DEFAULT_TRANSFORM },
      effects: [],
      midiData: {
        notes: notes.toSorted((a, b) => a.start - b.start || a.pitch - b.pitch),
        provenance: {
          ...(baseProvenance ?? {}),
          sourceClipId: resolved.audioClip.id,
          sourceFingerprint: input.sourceFingerprint,
          ...(input.processingStateHash ? { processingStateHash: input.processingStateHash } : {}),
          sourceFileKey: currentSourceFileKey,
          instrumentId,
          gmProgram: program,
          isDrum,
        },
      },
      isLoading: false,
    });
  }

  return {
    tracks: createdTracks,
    clips: createdClips,
    trackIds: createdTracks.map(track => track.id),
    clipIds: createdClips.map(clip => clip.id),
  };
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
  commitMidiTranscription: (input) => {
    const state = get();
    const commit = buildTranscriptionCommit(input, state.clips, state.tracks, state.clipKeyframes);
    if (!commit) {
      log.debug('Ignored stale, locked, or empty MIDI transcription commit', {
        sourceClipId: input.sourceClipId,
        trackCount: input.tracks.length,
      });
      return null;
    }

    const nextClips = [...state.clips, ...commit.clips];
    const nextExpandedTracks = new Set(state.expandedTracks);
    commit.trackIds.forEach(trackId => nextExpandedTracks.add(trackId));
    const nextDuration = state.durationLocked
      ? state.duration
      : Math.max(60, ...nextClips.map(clip => clip.startTime + clip.duration + 10));

    set({
      tracks: [...state.tracks, ...commit.tracks],
      clips: nextClips,
      expandedTracks: nextExpandedTracks,
      duration: nextDuration,
    });
    state.invalidateCache();
    captureSnapshot('Music to MIDI');
    log.info('Committed music transcription to MIDI tracks', {
      sourceClipId: input.sourceClipId,
      trackCount: commit.trackIds.length,
      noteCount: input.tracks.reduce((sum, track) => sum + track.notes.length, 0),
    });
    return { trackIds: commit.trackIds, clipIds: commit.clipIds };
  },

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
      // Content time can be NEGATIVE: extending a MIDI clip from the left pushes
      // inPoint below the content origin (0), so the revealed space is valid
      // content time. Don't floor at 0 — that would snap left-region notes back
      // to the old origin (#249). The piano roll bounds placement to the window.
      start: note.start,
      duration: Math.max(MIN_MIDI_NOTE_DURATION, note.duration),
      velocity: clampVelocity(note.velocity ?? 0.8),
    };

    set({ clips: mapClipNotes(clips, clipId, notes => [...notes, newNote]) });
    invalidateCache();
    captureSnapshot('Add MIDI note');
    return noteId;
  },

  addMidiNotes: (clipId, newNotes) => {
    const { clips, invalidateCache } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip || clip.source?.type !== 'midi' || newNotes.length === 0) return [];

    // Build every note up front so the whole batch is one immutable insert and
    // one history snapshot (piano-roll paste/duplicate). Content time may be
    // negative on a left-extended clip — don't floor at 0 (see addMidiNote).
    const created: MidiNote[] = newNotes.map(note => ({
      id: generateMidiNoteId(),
      pitch: clampPitch(note.pitch),
      start: note.start,
      duration: Math.max(MIN_MIDI_NOTE_DURATION, note.duration),
      velocity: clampVelocity(note.velocity ?? 0.8),
    }));

    set({ clips: mapClipNotes(clips, clipId, notes => [...notes, ...created]) });
    invalidateCache();
    captureSnapshot(created.length === 1 ? 'Add MIDI note' : 'Paste MIDI notes');
    return created.map(n => n.id);
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
          // Negative content time is valid (left-extended clip) — don't floor at 0.
          ...(patch.start !== undefined ? { start: patch.start } : {}),
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

  setMidiClipAutomation: (clipId, automation) => {
    const { clips, invalidateCache } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip || clip.source?.type !== 'midi') return;
    set({ clips: clips.map(c => (c.id === clipId ? { ...c, automation } : c)) });
    invalidateCache();
    captureSnapshot('Edit MIDI automation');
  },

  setMidiClipAutomationLane: (clipId, lane, points, options) => {
    const { clips, invalidateCache } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip || clip.source?.type !== 'midi') return;

    // Sort breakpoints by time so downstream sampling (midiAutomationWindow) can
    // assume ascending order. Empty/undefined clears the lane; an object with no
    // remaining lanes collapses back to undefined so a cleared clip is clean data.
    const sorted: AutomationPoint[] | undefined = points && points.length > 0
      ? [...points].sort((a, b) => a.time - b.time)
      : undefined;

    const nextAutomation: MidiClipAutomation | undefined = (() => {
      const base: MidiClipAutomation = { ...(clip.automation ?? {}) };
      if (sorted) base[lane] = { points: sorted };
      else delete base[lane];
      return Object.values(base).some(Boolean) ? base : undefined;
    })();

    set({ clips: clips.map(c => (c.id === clipId ? { ...c, automation: nextAutomation } : c)) });
    invalidateCache();
    if (options?.captureHistory !== false) {
      captureSnapshot('Edit MIDI automation');
    }
  },
});
