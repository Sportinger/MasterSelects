// Clips that carry their own content instead of media: solids (and transparent Blank
// clips) and MIDI clips with notes.

import { useTimelineStore } from '../../../stores/timeline';
import { BLANK_CLIP_COLOR } from '../../timeline/blankClip';
import type { ToolResult } from '../types';

const fail = (error: string): ToolResult => ({ success: false, error });
const COLOR = /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i;

function finite(value: unknown, name: string, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name} must be a number.`);
  return value;
}

function trackFor(trackId: unknown, type: 'video' | 'midi') {
  const { tracks } = useTimelineStore.getState();
  if (trackId !== undefined) {
    const track = tracks.find(item => item.id === trackId);
    if (!track) throw new Error(`Track not found: ${String(trackId)}`);
    if (track.type !== type) throw new Error(`Track ${track.name} is a ${track.type} track; a ${type} track is required.`);
    if (track.locked) throw new Error(`Track ${track.name} is locked.`);
    return track;
  }
  const track = tracks.find(item => item.type === type && !item.locked);
  if (!track) throw new Error(type === 'midi' ? 'Create a MIDI track first (createTrack type "midi").' : 'Add a video track first.');
  return track;
}

/** A solid color clip; "#00000000" (or blank: true) makes a transparent Blank clip for generator effects. */
export async function handleCreateSolidClip(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const color = args.blank === true ? BLANK_CLIP_COLOR : args.color === undefined ? '#ffffff' : String(args.color);
    if (!COLOR.test(color)) return fail('color must be #rrggbb or #rrggbbaa.');
    const state = useTimelineStore.getState();
    const track = trackFor(args.trackId, 'video');
    const start = Math.max(0, finite(args.start, 'start', state.playheadPosition));
    const duration = finite(args.duration, 'duration', 5);
    if (duration <= 0) return fail('duration must be greater than 0.');
    const clipId = state.addSolidClip(track.id, start, color, duration, true);
    if (!clipId) return fail('Could not create the solid clip.');
    const name = typeof args.name === 'string' && args.name.trim() ? args.name.trim() : color === BLANK_CLIP_COLOR ? 'Blank' : undefined;
    if (name) useTimelineStore.getState().updateClip(clipId, { name });
    return { success: true, data: { clipId, trackId: track.id, start, duration, color } };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

/** A MIDI clip with notes; note times are clip seconds (0 = clip start). */
export async function handleCreateMidiClip(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const state = useTimelineStore.getState();
    const track = trackFor(args.trackId, 'midi');
    const start = Math.max(0, finite(args.start, 'start', state.playheadPosition));
    const notes = args.notes === undefined ? [] : args.notes;
    if (!Array.isArray(notes)) return fail('notes must be an array of { time, pitch, duration?, velocity? }.');
    const parsed = notes.map((note: unknown, index) => {
      if (!note || typeof note !== 'object') throw new Error(`notes[${index}] must be an object.`);
      const value = note as Record<string, unknown>;
      const pitch = finite(value.pitch, `notes[${index}].pitch`);
      if (!Number.isInteger(pitch) || pitch < 0 || pitch > 127) throw new Error(`notes[${index}].pitch must be a MIDI note 0..127.`);
      const velocity = finite(value.velocity, `notes[${index}].velocity`, 0.85);
      if (velocity < 0 || velocity > 1) throw new Error(`notes[${index}].velocity must be 0..1.`);
      return { start: finite(value.time, `notes[${index}].time`), pitch, duration: finite(value.duration, `notes[${index}].duration`, 0.15), velocity };
    });
    const end = parsed.reduce((max, note) => Math.max(max, note.start + note.duration), 0);
    const duration = finite(args.duration, 'duration', Math.max(1, Math.ceil(end * 4) / 4));
    if (duration <= 0) return fail('duration must be greater than 0.');
    const clipId = state.addMidiClip(track.id, start, duration);
    if (!clipId) return fail('Could not create the MIDI clip.');
    if (parsed.length) useTimelineStore.getState().addMidiNotes(clipId, parsed);
    if (typeof args.name === 'string' && args.name.trim()) useTimelineStore.getState().updateClip(clipId, { name: args.name.trim() });
    return { success: true, data: { clipId, trackId: track.id, start, duration, noteCount: parsed.length } };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}
