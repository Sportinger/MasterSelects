// Score track/clip notation data model (issue #366).
//
// This is the DURABLE schema for `TimelineClip.scoreData`: plain JSON, no
// runtime handles, ported from the kikoromantest score editor. Unlike
// `midiClip.ts` (seconds-based free-placement piano-roll notes), a score clip
// stores real notation — measures, exact-fraction beats, per-pitch enharmonic
// spelling, tuplets, ties — edited in the detached score-editor window and
// rendered with VexFlow. The pure model logic lives in `src/services/score/`.

/**
 * Exact rational number for musical time. Musical time is rational — tuplets
 * create values like 1/3 that cannot be represented in floating point. Always
 * stored reduced with a positive denominator; the numerator carries the sign.
 * Unit: beats (quarter notes). See `src/services/score/fraction.ts` for ops.
 */
export interface Fraction {
  readonly num: number // integer numerator (carries sign)
  readonly den: number // integer denominator (always > 0)
}

/** Note duration types supported by the editor */
export type NoteDuration = 'w' | 'h' | 'q' | '8' | '16' | '32'

/** Tuplet definition (e.g., triplet = 3 notes in space of 2) */
export interface Tuplet {
  id: string
  /** Beat position where the tuplet starts (exact rational) */
  startBeat: Fraction
  /** Base note duration for the tuplet (e.g., 'q' for quarter note triplet) */
  baseDuration: NoteDuration
  /** Number of notes in the tuplet (e.g., 3 for triplet) */
  numNotes: number
  /** Number of base notes the tuplet occupies (e.g., 2 for triplet) */
  notesOccupied: number
}

/** Accidental display characters (legacy palette representation) */
export type Accidental = '#' | 'b' | 'n'

/** Diatonic step name (letter name of the note, independent of accidental) */
export type PitchStep = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B'

/**
 * Chromatic alteration in semitones.
 * -2 = double-flat (bb), -1 = flat (b), 0 = natural, 1 = sharp (#), 2 = double-sharp (##)
 */
export type PitchAlter = -2 | -1 | 0 | 1 | 2

/**
 * Enharmonic-aware pitch spelling: step + alteration + scientific octave.
 * This is the industry-standard representation (MusicXML, music21). Unlike a
 * bare MIDI integer, it distinguishes enharmonic equivalents:
 *   C#4 = { step: 'C', alter:  1, octave: 4 }  — MIDI 61
 *   Db4 = { step: 'D', alter: -1, octave: 4 }  — MIDI 61
 * MIDI is always *derived* from this (spellingToMidi), never primary.
 */
export interface PitchSpelling {
  step: PitchStep
  alter: PitchAlter
  /** Scientific octave number — C4 is middle C (MIDI 60) */
  octave: number
}

/** Articulation types */
export type ArticulationType = 'accent' | 'staccato' | 'tenuto'

/** Clef types */
export type Clef = 'treble' | 'bass' | 'alto' | 'tenor'

/**
 * Stem direction for notes.
 * 'auto' calculates from pitch and clef (default); 'up'/'down' force it.
 */
export type StemDirection = 'auto' | 'up' | 'down'

/**
 * A single musical note (or rest) in the FLAT backward-compat view used by the
 * editor engine (`getMeasureNotes`, ScoreModel getters). The durable structure
 * stores slots (Chord/Rest); this flattened shape is derived from them.
 * Pitch fields are undefined for rests (isRest === true).
 */
export interface Note {
  id: string
  /** Diatonic step name — undefined for rests */
  step?: PitchStep
  /** Chromatic alteration: -2=bb  -1=b  0=natural  1=#  2=## — undefined for rests */
  alter?: PitchAlter
  /** Scientific octave (C4 = middle C) — undefined for rests */
  octave?: number
  duration: NoteDuration
  /** Measure number (1-indexed) */
  measure: number
  /** Beat position within the measure (0-indexed, exact rational fraction) */
  beat: Fraction
  /** If true, always show the accidental sign even when measure rules would suppress it */
  forceAccidental?: boolean
  isRest?: boolean
  stemDirection?: StemDirection
  /** ID of the note this note is tied TO (forward tie) */
  tiedTo?: string
  /** ID of the note this note is tied FROM (backward tie) */
  tiedFrom?: string
  /** Number of dots (0=none, 1=dotted, 2=double-dotted) */
  dots?: number
  /** ID of the tuplet this note belongs to */
  tupletId?: string
  /**
   * Exact sounding duration as a rational fraction (in beats).
   * For regular notes equals durationToFraction(duration, dots).
   * For tuplet notes equals that value × (notesOccupied / numNotes).
   * Stored explicitly so all timing comparisons can be exact — no epsilon.
   */
  actualDuration?: Fraction
  articulations?: ArticulationType[]
}

/** Time signature representation */
export interface TimeSignature {
  /** Number of beats per measure */
  numerator: number
  /** Note value that gets the beat (4 = quarter note, 8 = eighth note) */
  denominator: number
}

/**
 * Pitch-only object stored inside a Chord. Pitch is stored as
 * step + alter + octave (MusicXML convention), NOT as a raw MIDI integer.
 */
export interface NotePitch {
  id: string
  step: PitchStep
  alter: PitchAlter
  /** Scientific octave — C4 is middle C */
  octave: number
  /** Show accidental sign even when measure context would suppress it */
  forceAccidental?: boolean
  tiedTo?: string      // ID of another NotePitch in another Chord
  tiedFrom?: string
}

/** A rhythmic slot containing one or more pitches */
export interface Chord {
  id: string
  type: 'chord'
  beat: Fraction
  duration: NoteDuration
  dots?: number
  measure: number
  voice?: 0 | 1 | 2 | 3
  stemDirection?: StemDirection
  tupletId?: string
  actualDuration?: Fraction
  articulations?: ArticulationType[]
  notes: NotePitch[]
}

/** An empty rhythmic slot (silence) */
export interface Rest {
  id: string
  type: 'rest'
  beat: Fraction
  duration: NoteDuration
  dots?: number
  measure: number
  voice?: 0 | 1 | 2 | 3
  tupletId?: string
  actualDuration?: Fraction
  tiedFrom?: string
}

export type ChordRest = Chord | Rest

/** A measure in the score */
export interface Measure {
  id: string
  /** Measure number (1-indexed) */
  number: number
  /** Rhythmic slots (chords and rests) in this measure */
  slots: ChordRest[]
  timeSignature: TimeSignature
  /** Optional key signature (number of sharps/flats, positive = sharps, negative = flats) */
  keySignature?: number
  tuplets: Tuplet[]
}

/** Key signature representation */
export interface KeySignature {
  /** Key name (e.g., 'C', 'G', 'Dm') */
  key: string
  /** Number of sharps (positive) or flats (negative) */
  accidentals: number
}

/** A complete musical score */
export interface Score {
  id: string
  title: string
  composer?: string
  measures: Measure[]
  /** Default tempo in BPM (initial port; timeline tempo-map integration is a later step) */
  tempo: number
  keySignature: KeySignature
  defaultTimeSignature: TimeSignature
  /** Clef for the score (default: 'treble') */
  clef?: Clef
  /** Schema version for JSON forward-compatibility. Current: 1. */
  schemaVersion?: number
}

/** Position in the score (for cursor, selection, etc.) */
export interface Position {
  /** Measure number (1-indexed) */
  measure: number
  /** Beat position (0-indexed, exact rational fraction) */
  beat: Fraction
}

/**
 * Parameters for creating or updating a note. Pitch is specified as
 * step + alter + octave; all three should be provided together for non-rests
 * and omitted for rests.
 */
export interface NoteParams {
  step?: PitchStep
  /** Chromatic alteration — omit for rests, defaults to 0 (natural) when step is provided */
  alter?: PitchAlter
  octave?: number
  duration: NoteDuration
  measure: number
  beat: Fraction
  forceAccidental?: boolean
  isRest?: boolean
  dots?: number
  tupletId?: string
  actualDuration?: Fraction
  articulations?: ArticulationType[]
  tiedTo?: string
  tiedFrom?: string
  stemDirection?: StemDirection}

/**
 * Notation data carried by a score clip (`TimelineClip.scoreData`): the Score
 * JSON with a required schema version. Plain JSON only — runtime handles must
 * never leak into project data.
 */
export interface ScoreData extends Score {
  schemaVersion: number
}

/** Current `ScoreData.schemaVersion` written by this editor. */
export const SCORE_DATA_SCHEMA_VERSION = 1
