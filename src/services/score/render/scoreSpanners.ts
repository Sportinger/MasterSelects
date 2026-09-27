// Beams, tuplets, and ties for the score renderer (issue #366, port phase 2).
//
// Beam grouping honors explicit BeamMode overrides (single/begin/continue/end)
// on top of beat-boundary auto-grouping — deliberate custom behavior stock
// VexFlow auto-beaming doesn't cover. Ties are stock VexFlow StaveTie
// everywhere (same-pitch ties only — decision 1), including the two partial
// arcs across a line break; kikoromantest's hand-drawn flat tie is gone.

import { Beam, StaveNote, StaveTie, Tuplet as VexFlowTuplet } from 'vexflow';
import type { Chord, ChordRest, Clef, Fraction, Measure, NoteDuration, NotePitch, Score, Tuplet } from '../../../types/scoreClip';
import { fracEq, fracToNumber } from '../fraction';
import { spellingDiatonicPos } from '../pitchSpelling';
import { CLEF_CONFIG } from './scoreNoteFactory';
import type { MeasureWidthInfo } from './scoreLayout';

/** Where a rendered StaveNote lives, for tie endpoints (key index = chord voice). */
export interface RenderedNoteRef {
  staveNote: StaveNote;
  noteIndex: number;
}

// ---------------------------------------------------------------------------
// Beams
// ---------------------------------------------------------------------------

/** Check if a duration is beamable (8th note or shorter). */
function isBeamableDuration(duration: NoteDuration): boolean {
  return duration === '8' || duration === '16' || duration === '32';
}

/**
 * Beat group for auto-beaming: beam within each integer beat.
 * (Compound-meter groupings, e.g. 6/8 in threes, are a later refinement.)
 */
function getBeatGroup(beat: number): number {
  return Math.floor(beat);
}

/**
 * Stem direction for an entire beam group: an explicit override on any chord
 * wins; otherwise the pitch furthest from the clef's middle line decides.
 */
function calculateBeamGroupStemDirection(slots: ChordRest[], clef: Clef): number {
  for (const slot of slots) {
    if (slot.type === 'chord' && slot.stemDirection === 'up') return 1;
    if (slot.type === 'chord' && slot.stemDirection === 'down') return -1;
  }

  const middleDiatonic = CLEF_CONFIG[clef].middleLineDiatonicPos;
  let maxDistance = 0;
  let furthestDiatonic = middleDiatonic;
  let hasPitch = false;

  for (const slot of slots) {
    if (slot.type === 'rest') continue;
    for (const p of slot.notes) {
      const dPos = spellingDiatonicPos(p.step, p.octave);
      const distance = Math.abs(dPos - middleDiatonic);
      if (!hasPitch || distance > maxDistance) {
        maxDistance = distance;
        furthestDiatonic = dPos;
        hasPitch = true;
      }
    }
  }

  return furthestDiatonic >= middleDiatonic ? -1 : 1;
}

/**
 * Group StaveNotes into beam groups, honoring explicit BeamMode overrides:
 * 'single' isolates, 'begin' opens a forced group, 'continue' bridges beat
 * boundaries, 'end' closes; rests and unbeamable durations always break.
 */
function createBeamGroups(
  staveNotes: StaveNote[],
  slots: ChordRest[],
): { staveNotes: StaveNote[]; slots: ChordRest[] }[] {
  const beamGroups: { staveNotes: StaveNote[]; slots: ChordRest[] }[] = [];
  let currentStaveNotes: StaveNote[] = [];
  let currentSlots: ChordRest[] = [];
  let currentBeatGroup: number | null = null;
  let isForced = false; // true when group was started by an explicit 'begin'

  const flush = () => {
    if (currentStaveNotes.length >= 2) {
      beamGroups.push({ staveNotes: currentStaveNotes, slots: currentSlots });
    }
    currentStaveNotes = [];
    currentSlots = [];
    currentBeatGroup = null;
    isForced = false;
  };

  for (let i = 0; i < staveNotes.length && i < slots.length; i++) {
    const staveNote = staveNotes[i];
    const slot = slots[i];

    // Rests always break beams (can't beam silence)
    if (slot.type === 'rest') { flush(); continue; }

    // Non-beamable durations (quarter and above) always break beams
    if (!isBeamableDuration(slot.duration)) { flush(); continue; }

    const beam = slot.beam;

    if (beam === 'single') {
      flush();
      continue;
    }

    if (beam === 'begin') {
      flush();
      currentStaveNotes = [staveNote];
      currentSlots = [slot];
      currentBeatGroup = getBeatGroup(fracToNumber(slot.beat));
      isForced = true;
      continue;
    }

    if (beam === 'continue') {
      // Bridge across a beat boundary — override normal grouping rules
      if (currentStaveNotes.length > 0) {
        currentStaveNotes.push(staveNote);
        currentSlots.push(slot);
      } else {
        // Orphaned continue (no preceding group) — start one
        currentStaveNotes = [staveNote];
        currentSlots = [slot];
        isForced = true;
      }
      currentBeatGroup = getBeatGroup(fracToNumber(slot.beat));
      continue;
    }

    if (beam === 'end') {
      // Close the current group after adding this note; an orphaned 'end'
      // yields a single-note group that flush()'s min-2 check drops.
      currentStaveNotes.push(staveNote);
      currentSlots.push(slot);
      flush();
      continue;
    }

    // beam === undefined/'auto' — standard beat-boundary logic
    if (isForced) {
      // Inside a forced group (between begin and a future end)
      currentStaveNotes.push(staveNote);
      currentSlots.push(slot);
      currentBeatGroup = getBeatGroup(fracToNumber(slot.beat));
    } else {
      const beatGroup = getBeatGroup(fracToNumber(slot.beat));
      if (currentBeatGroup === null || beatGroup === currentBeatGroup) {
        currentStaveNotes.push(staveNote);
        currentSlots.push(slot);
        currentBeatGroup = beatGroup;
      } else {
        flush();
        currentStaveNotes = [staveNote];
        currentSlots = [slot];
        currentBeatGroup = beatGroup;
      }
    }
  }

  flush();
  return beamGroups;
}

/** Build Beam objects for a measure, forcing a shared stem direction per group. */
export function buildBeams(staveNotes: StaveNote[], sortedSlots: ChordRest[], clef: Clef): Beam[] {
  const beamGroups = createBeamGroups(staveNotes, sortedSlots);
  const beams: Beam[] = [];

  for (const beamGroup of beamGroups) {
    try {
      const beamStemDirection = calculateBeamGroupStemDirection(beamGroup.slots, clef);
      for (const staveNote of beamGroup.staveNotes) {
        staveNote.setStemDirection(beamStemDirection);
      }
      beams.push(new Beam(beamGroup.staveNotes));
    } catch {
      // A malformed group renders unbeamed rather than failing the measure
    }
  }

  return beams;
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

/** A tie ready to draw, with its model endpoints for selection styling. */
export interface BuiltTie {
  fromNoteId: string;
  toNoteId: string;
  tie: StaveTie;
}

/**
 * Tie direction for a pitch within a chord: outer voices curve away from the
 * chord (top up, bottom down); middle notes follow the nearest outer voice;
 * single notes curve away from the middle line.
 * Returns -1 for UP, 1 for DOWN (VexFlow convention).
 */
function getTieDirection(notePitch: NotePitch, beat: Fraction, measure: Measure, clef: Clef): number {
  const chordAtBeat = measure.slots.find(
    (s): s is Chord => s.type === 'chord' && fracEq(s.beat, beat),
  );

  const thisDiatonic = spellingDiatonicPos(notePitch.step, notePitch.octave);

  if (!chordAtBeat || chordAtBeat.notes.length <= 1) {
    const middleDiatonic = CLEF_CONFIG[clef].middleLineDiatonicPos;
    return thisDiatonic >= middleDiatonic ? -1 : 1;
  }

  const sortedDiatonics = chordAtBeat.notes
    .map(n => spellingDiatonicPos(n.step, n.octave))
    .toSorted((a, b) => a - b);
  const lowestDiatonic = sortedDiatonics[0];
  const highestDiatonic = sortedDiatonics[sortedDiatonics.length - 1];

  if (thisDiatonic === highestDiatonic) return -1; // Top note: tie curves UP
  if (thisDiatonic === lowestDiatonic) return 1; // Bottom note: tie curves DOWN

  const distToTop = highestDiatonic - thisDiatonic;
  const distToBottom = thisDiatonic - lowestDiatonic;
  return distToTop <= distToBottom ? -1 : 1;
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
  const clef: Clef = score.clef || 'treble';
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
        const direction = getTieDirection(pitch, slot.beat, measure, clef);

        if (fromLine === toLine) {
          const tie = new StaveTie({
            firstNote: fromInfo.staveNote,
            firstIndexes: [fromInfo.noteIndex],
            lastNote: toInfo.staveNote,
            lastIndexes: [toInfo.noteIndex],
          });
          tie.setDirection(direction);
          ties.push({ fromNoteId: pitch.id, toNoteId: pitch.tiedTo, tie });
        } else {
          // Line break: two partial arcs
          const firstPartial = new StaveTie({
            firstNote: fromInfo.staveNote,
            firstIndexes: [fromInfo.noteIndex],
          });
          firstPartial.setDirection(direction);
          ties.push({ fromNoteId: pitch.id, toNoteId: pitch.tiedTo, tie: firstPartial });

          const secondPartial = new StaveTie({
            lastNote: toInfo.staveNote,
            lastIndexes: [toInfo.noteIndex],
          });
          secondPartial.setDirection(direction);
          ties.push({ fromNoteId: pitch.id, toNoteId: pitch.tiedTo, tie: secondPartial });
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

      const direction = getTieDirection(pitch, slot.beat, measure, score.clef || 'treble');
      const pendingTie = new StaveTie({
        firstNote: info.staveNote,
        firstIndexes: [info.noteIndex],
      });
      pendingTie.setDirection(direction);
      return pendingTie;
    }
  }
  return null;
}
