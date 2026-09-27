// Beams, tuplets, and ties for the score renderer (issue #366, port phase 2).
//
// Beaming is stock VexFlow auto-beaming (Beam.generateBeams with the
// per-time-signature default groups) — the kikoromantest manual beam modes
// were dropped by decision to stay on default VexFlow behavior. Ties are
// stock VexFlow StaveTie everywhere (same-pitch ties only — decision 1),
// including the two partial arcs across a line break; the hand-drawn flat
// tie is gone.

import { Beam, StaveNote, StaveTie, Tuplet as VexFlowTuplet } from 'vexflow';
import type { ChordRest, Measure, Score, TimeSignature, Tuplet } from '../../../types/scoreClip';
import type { MeasureWidthInfo } from './scoreLayout';

/** Where a rendered StaveNote lives, for tie endpoints (key index = chord voice). */
export interface RenderedNoteRef {
  staveNote: StaveNote;
  noteIndex: number;
}

// ---------------------------------------------------------------------------
// Beams
// ---------------------------------------------------------------------------

/**
 * Build Beam objects for a measure with stock VexFlow auto-beaming, grouped
 * by the time signature's conventional beat groups (e.g. 6/8 in threes).
 * Must run BEFORE the voice is formatted — beaming adjusts stems.
 */
export function buildBeams(staveNotes: StaveNote[], timeSignature: TimeSignature): Beam[] {
  try {
    return Beam.generateBeams(staveNotes, {
      groups: Beam.getDefaultBeamGroups(`${timeSignature.numerator}/${timeSignature.denominator}`),
    });
  } catch {
    // A malformed measure renders unbeamed rather than failing
    return [];
  }
}

// ---------------------------------------------------------------------------
// Tuplets
// ---------------------------------------------------------------------------

/** A created VexFlow tuplet paired with its model tuplet. */
export interface BuiltTuplet {
  tupletId: string;
  tuplet: Tuplet;
  vexTuplet: VexFlowTuplet;
  staveNotes: StaveNote[];
}

/**
 * Tuplet bracket location: opposite the group's majority stem direction
 * (stems up → bracket below, stems down → bracket above).
 */
function calculateTupletLocation(staveNotes: StaveNote[]): number {
  const LOCATION_TOP = 1;
  const LOCATION_BOTTOM = -1;
  if (staveNotes.length === 0) return LOCATION_TOP;

  let stemsUp = 0;
  let stemsDown = 0;
  for (const note of staveNotes) {
    try {
      if (note.getStem() && note.getStemDirection() === 1) stemsUp++;
      else stemsDown++;
    } catch {
      stemsDown++; // getStem may fail for rests
    }
  }

  return stemsUp > stemsDown ? LOCATION_BOTTOM : LOCATION_TOP;
}

/**
 * Create VexFlow Tuplet objects for a measure's slots. MUST run before the
 * notes join a Voice — VexFlow adjusts the notes' tick values.
 */
export function buildTuplets(
  builtNotes: ReadonlyArray<{ slot: ChordRest; staveNote: StaveNote }>,
  measure: Measure,
): BuiltTuplet[] {
  const byTuplet = new Map<string, { staveNotes: StaveNote[]; tuplet: Tuplet }>();

  for (const { slot, staveNote } of builtNotes) {
    if (!slot.tupletId) continue;
    const tupletData = (measure.tuplets || []).find(t => t.id === slot.tupletId);
    if (!tupletData) continue;
    if (!byTuplet.has(slot.tupletId)) {
      byTuplet.set(slot.tupletId, { staveNotes: [], tuplet: tupletData });
    }
    byTuplet.get(slot.tupletId)!.staveNotes.push(staveNote);
  }

  const built: BuiltTuplet[] = [];
  for (const [tupletId, { staveNotes, tuplet }] of byTuplet) {
    if (staveNotes.length < 2) continue;
    try {
      const vexTuplet = new VexFlowTuplet(staveNotes, {
        numNotes: tuplet.numNotes,
        notesOccupied: tuplet.notesOccupied,
        location: calculateTupletLocation(staveNotes),
        bracketed: true,
      });
      built.push({ tupletId, tuplet, vexTuplet, staveNotes });
    } catch {
      // The notes render without a bracket rather than failing the measure
    }
  }

  return built;
}

// ---------------------------------------------------------------------------
// Ties
// ---------------------------------------------------------------------------

/** A tie ready to draw, with its model endpoints for selection styling and hit-testing. */
export interface BuiltTie {
  fromNoteId: string;
  toNoteId: string;
  tie: StaveTie;
  /** Endpoint refs (a partial tie has only one of these) */
  fromRef?: RenderedNoteRef;
  toRef?: RenderedNoteRef;
}

/** Find the measure number containing a pitch/rest id (tie targets). */
function findMeasureOfNote(score: Score, noteId: string): number | undefined {
  for (const m of score.measures) {
    for (const s of m.slots) {
      if (s.type === 'chord' && s.notes.some(p => p.id === noteId)) return m.number;
      if (s.type === 'rest' && s.id === noteId) return m.number;
    }
  }
  return undefined;
}

/**
 * Build stock StaveTie objects for every tiedTo link in the score.
 * Same line → one full tie; across a line break → two partial ties
 * (from-note to line end, line start to to-note).
 */
export function buildTies(
  score: Score,
  noteRefs: ReadonlyMap<string, RenderedNoteRef>,
  layoutInfo: ReadonlyMap<number, MeasureWidthInfo>,
): BuiltTie[] {
  const ties: BuiltTie[] = [];
  const processed = new Set<string>();

  for (const measure of score.measures) {
    for (const slot of measure.slots) {
      if (slot.type !== 'chord') continue;
      for (const pitch of slot.notes) {
        if (!pitch.tiedTo) continue;

        const tieKey = `${pitch.id}->${pitch.tiedTo}`;
        if (processed.has(tieKey)) continue;
        processed.add(tieKey);

        const fromInfo = noteRefs.get(pitch.id);
        const toInfo = noteRefs.get(pitch.tiedTo);
        if (!fromInfo || !toInfo) continue;

        const toMeasure = findMeasureOfNote(score, pitch.tiedTo);
        const fromLine = layoutInfo.get(slot.measure)?.lineNumber ?? 0;
        const toLine = toMeasure !== undefined ? layoutInfo.get(toMeasure)?.lineNumber ?? 0 : fromLine;

        // Curve direction is stock VexFlow (derived from the note's stem)
        if (fromLine === toLine) {
          const tie = new StaveTie({
            firstNote: fromInfo.staveNote,
            firstIndexes: [fromInfo.noteIndex],
            lastNote: toInfo.staveNote,
            lastIndexes: [toInfo.noteIndex],
          });
          ties.push({ fromNoteId: pitch.id, toNoteId: pitch.tiedTo, tie, fromRef: fromInfo, toRef: toInfo });
        } else {
          // Line break: two partial arcs
          const firstPartial = new StaveTie({
            firstNote: fromInfo.staveNote,
            firstIndexes: [fromInfo.noteIndex],
          });
          ties.push({ fromNoteId: pitch.id, toNoteId: pitch.tiedTo, tie: firstPartial, fromRef: fromInfo });

          const secondPartial = new StaveTie({
            lastNote: toInfo.staveNote,
            lastIndexes: [toInfo.noteIndex],
          });
          ties.push({ fromNoteId: pitch.id, toNoteId: pitch.tiedTo, tie: secondPartial, toRef: toInfo });
        }
      }
    }
  }

  return ties;
}

/**
 * Build a dangling (pending) tie from a note with no target yet — a partial
 * arc extending right, as while the user is choosing the tie target.
 */
export function buildPendingTie(
  score: Score,
  noteId: string,
  noteRefs: ReadonlyMap<string, RenderedNoteRef>,
): StaveTie | null {
  const info = noteRefs.get(noteId);
  if (!info) return null;

  for (const measure of score.measures) {
    for (const slot of measure.slots) {
      if (slot.type !== 'chord') continue;
      const pitch = slot.notes.find(n => n.id === noteId);
      if (!pitch) continue;

      // Curve direction is stock VexFlow (derived from the note's stem)
      return new StaveTie({
        firstNote: info.staveNote,
        firstIndexes: [info.noteIndex],
      });
    }
  }
  return null;
}
