import type { GmInstrument, MidiNote } from '../../types/midiClip';
import type {
  MuscriptorTranscribedNote,
  MuscriptorTranscriptionResult,
} from '../nativeHelper/protocol';

export const MUSCRIPTOR_INSTRUMENT_GROUPS = [
  'acoustic_piano',
  'electric_piano',
  'chromatic_percussion',
  'organ',
  'acoustic_guitar',
  'clean_electric_guitar',
  'distorted_electric_guitar',
  'acoustic_bass',
  'electric_bass',
  'violin',
  'viola',
  'cello',
  'contrabass',
  'orchestral_harp',
  'timpani',
  'string_ensemble',
  'synth_strings',
  'voice',
  'orchestra_hit',
  'trumpet',
  'trombone',
  'tuba',
  'french_horn',
  'brass_section',
  'soprano_and_alto_sax',
  'tenor_sax',
  'baritone_sax',
  'oboe',
  'english_horn',
  'bassoon',
  'clarinet',
  'flutes',
  'synth_lead',
  'synth_pad',
  'drums',
] as const;

export type MuscriptorInstrumentGroup = typeof MUSCRIPTOR_INSTRUMENT_GROUPS[number];

const GM_PROGRAM_BY_GROUP: Readonly<Record<MuscriptorInstrumentGroup, number>> = {
  acoustic_piano: 0,
  electric_piano: 4,
  chromatic_percussion: 9,
  organ: 19,
  acoustic_guitar: 24,
  clean_electric_guitar: 27,
  distorted_electric_guitar: 30,
  acoustic_bass: 32,
  electric_bass: 33,
  violin: 40,
  viola: 41,
  cello: 42,
  contrabass: 43,
  orchestral_harp: 46,
  timpani: 47,
  string_ensemble: 48,
  synth_strings: 50,
  voice: 52,
  orchestra_hit: 55,
  trumpet: 56,
  trombone: 57,
  tuba: 58,
  french_horn: 60,
  brass_section: 61,
  soprano_and_alto_sax: 65,
  tenor_sax: 66,
  baritone_sax: 67,
  oboe: 68,
  english_horn: 69,
  bassoon: 70,
  clarinet: 71,
  flutes: 73,
  synth_lead: 80,
  synth_pad: 89,
  drums: 0,
};

const GROUP_ORDER = new Map<string, number>(
  MUSCRIPTOR_INSTRUMENT_GROUPS.map((group, index) => [group, index]),
);
const PROGRAM_INSTRUMENT_PATTERN = /^program_(\d{1,3})$/;
const NOTE_VELOCITY = 0.8;
const MIN_NOTE_DURATION_SECONDS = 0.02;

export interface MuscriptorMappedTrack {
  instrumentGroup: string;
  displayName: string;
  gmInstrument: GmInstrument;
  notes: MidiNote[];
}

export interface MuscriptorTimelineTranscription {
  jobId: string;
  sourceAudioClipId: string;
  sourceFingerprint: string;
  processingStateHash: string;
  sourceFileKey: string | null;
  timelineStart: number;
  duration: number;
  tracks: MuscriptorTimelineTrackInput[];
}

export interface MapMuscriptorTimelineOptions {
  sourceAudioClipId: string;
  sourceFingerprint: string;
  processingStateHash: string;
  sourceFileKey: string | null;
  timelineStart: number;
  duration: number;
}

export interface MuscriptorTimelineNoteInput {
  pitch: number;
  startTime: number;
  endTime: number;
  velocity: number;
}

export interface MuscriptorTimelineTrackInput {
  instrumentId: string;
  displayName: string;
  gmProgram: number;
  isDrum: boolean;
  notes: MuscriptorTimelineNoteInput[];
}

interface ValidatedNote extends MuscriptorTranscribedNote {
  sourceIndex: number;
}

export function getMuscriptorGmInstrument(instrumentGroup: string): GmInstrument | null {
  if (instrumentGroup === 'drums') {
    return { kind: 'gm', program: 0, isDrum: true, gain: NOTE_VELOCITY };
  }

  const canonicalProgram = GM_PROGRAM_BY_GROUP[instrumentGroup as MuscriptorInstrumentGroup];
  if (canonicalProgram !== undefined) {
    return { kind: 'gm', program: canonicalProgram, isDrum: false, gain: NOTE_VELOCITY };
  }

  const rawProgram = PROGRAM_INSTRUMENT_PATTERN.exec(instrumentGroup)?.[1];
  const program = rawProgram === undefined ? Number.NaN : Number(rawProgram);
  return Number.isInteger(program) && program >= 0 && program <= 127
    ? { kind: 'gm', program, isDrum: false, gain: NOTE_VELOCITY }
    : null;
}

export function mapMuscriptorNotes(notes: readonly unknown[]): MuscriptorMappedTrack[] {
  const grouped = new Map<string, ValidatedNote[]>();

  notes.forEach((candidate, sourceIndex) => {
    const note = validateNote(candidate, sourceIndex);
    if (!note || !getMuscriptorGmInstrument(note.instrument)) return;
    const group = grouped.get(note.instrument) ?? [];
    group.push(note);
    grouped.set(note.instrument, group);
  });

  return [...grouped.entries()]
    .sort(([left], [right]) => compareInstrumentGroups(left, right))
    .map(([instrumentGroup, groupNotes]) => {
      const gmInstrument = getMuscriptorGmInstrument(instrumentGroup);
      if (!gmInstrument) {
        throw new Error(`Missing GM mapping for validated MuScriptor group: ${instrumentGroup}`);
      }

      const sorted = groupNotes.toSorted(compareNotes);
      return {
        instrumentGroup,
        displayName: formatInstrumentGroup(instrumentGroup),
        gmInstrument,
        notes: sorted.map((note, sortedIndex) => ({
          id: createDeterministicNoteId(note, sortedIndex),
          pitch: note.pitch,
          start: note.start_time,
          duration: Math.max(MIN_NOTE_DURATION_SECONDS, note.end_time - note.start_time),
          velocity: NOTE_VELOCITY,
        })),
      };
    });
}

export function mapMuscriptorTimelineTranscription(
  result: MuscriptorTranscriptionResult,
  options: MapMuscriptorTimelineOptions,
): MuscriptorTimelineTranscription {
  return {
    jobId: result.job_id,
    sourceAudioClipId: options.sourceAudioClipId,
    sourceFingerprint: options.sourceFingerprint,
    processingStateHash: options.processingStateHash,
    sourceFileKey: options.sourceFileKey,
    timelineStart: finiteNonNegative(options.timelineStart, 0),
    duration: finiteNonNegative(options.duration, 0),
    tracks: toMuscriptorTimelineTracks(mapMuscriptorNotes(result.notes)),
  };
}

export function toMuscriptorTimelineTracks(
  tracks: readonly MuscriptorMappedTrack[],
): MuscriptorTimelineTrackInput[] {
  return tracks.map(track => ({
    instrumentId: track.instrumentGroup,
    displayName: track.displayName,
    gmProgram: track.gmInstrument.program,
    isDrum: track.gmInstrument.isDrum === true,
    notes: track.notes.map(note => ({
      pitch: note.pitch,
      startTime: note.start,
      endTime: note.start + note.duration,
      velocity: note.velocity,
    })),
  }));
}

function validateNote(candidate: unknown, sourceIndex: number): ValidatedNote | null {
  if (!candidate || typeof candidate !== 'object') return null;
  const value = candidate as Record<string, unknown>;
  const pitch = value.pitch;
  const startTime = value.start_time;
  const endTime = value.end_time;
  const instrument = typeof value.instrument === 'string' ? value.instrument.trim() : '';

  if (!Number.isInteger(pitch) || (pitch as number) < 0 || (pitch as number) > 127) return null;
  if (typeof startTime !== 'number' || !Number.isFinite(startTime) || startTime < 0) return null;
  if (typeof endTime !== 'number' || !Number.isFinite(endTime) || endTime < startTime) return null;
  if (!instrument) return null;

  return {
    pitch: pitch as number,
    start_time: startTime,
    end_time: endTime,
    instrument,
    sourceIndex,
  };
}

function compareInstrumentGroups(left: string, right: string): number {
  const leftOrder = GROUP_ORDER.get(left);
  const rightOrder = GROUP_ORDER.get(right);
  if (leftOrder !== undefined || rightOrder !== undefined) {
    return (leftOrder ?? Number.MAX_SAFE_INTEGER) - (rightOrder ?? Number.MAX_SAFE_INTEGER);
  }

  const leftProgram = Number(PROGRAM_INSTRUMENT_PATTERN.exec(left)?.[1]);
  const rightProgram = Number(PROGRAM_INSTRUMENT_PATTERN.exec(right)?.[1]);
  if (Number.isFinite(leftProgram) && Number.isFinite(rightProgram)) return leftProgram - rightProgram;
  return left.localeCompare(right);
}

function compareNotes(left: ValidatedNote, right: ValidatedNote): number {
  return left.start_time - right.start_time
    || left.pitch - right.pitch
    || left.end_time - right.end_time
    || left.sourceIndex - right.sourceIndex;
}

function createDeterministicNoteId(note: ValidatedNote, sortedIndex: number): string {
  const startMicros = Math.round(note.start_time * 1_000_000);
  const endMicros = Math.round(note.end_time * 1_000_000);
  return `muscriptor-${note.instrument}-${startMicros}-${endMicros}-${note.pitch}-${sortedIndex}`;
}

function formatInstrumentGroup(group: string): string {
  const program = PROGRAM_INSTRUMENT_PATTERN.exec(group)?.[1];
  if (program !== undefined) return `GM Program ${Number(program) + 1}`;
  return group.split('_').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function finiteNonNegative(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}
