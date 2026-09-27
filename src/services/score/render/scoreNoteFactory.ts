// StaveNote construction for the score renderer (issue #366, port phase 2).
//
// Builds VexFlow StaveNotes from ChordRest slots: accidental-display rules
// (measure-context suppression, forced/courtesy naturals, tie suppression —
// deliberate custom behavior stock VexFlow doesn't cover), diatonic stem
// direction per clef, dots, and articulation ordering. Each slot's StaveNote
// carries the MODEL SLOT ID as its VexFlow element id, so the SVG contains
// `<g class="vf-stavenote" id="vf-<slotId>">` — the phase-3 hit-test layer
// maps DOM hits back to the model with a plain id lookup.

import { Accidental, Articulation, Dot, Modifier, StaveNote } from 'vexflow';
import type {
  ArticulationType,
  ChordRest,
  Clef,
  NoteDuration,
  NotePitch,
  PitchAlter,
  PitchStep,
} from '../../../types/scoreClip';
import { spellingDiatonicPos, spellingToMidi, spellingToVexflowKey } from '../pitchSpelling';

/**
 * Articulation render order — from note outward (first = closest to note
 * head). Staccato always hugs the note, tenuto sits next, accent is outermost,
 * whether the group is above or below the staff.
 */
export const ARTICULATION_RENDER_ORDER: ArticulationType[] = ['staccato', 'tenuto', 'accent'];

const ARTICULATION_VEX_CODES: Record<ArticulationType, string> = {
  accent: 'a>',
  staccato: 'a.',
  tenuto: 'a-',
};

/**
 * Clef configuration for stem direction calculation.
 * middleLineDiatonicPos: spellingDiatonicPos() of the middle (3rd) staff line.
 *   treble B4 = 34, bass D3 = 22, alto C4 = 28, tenor A3 = 26.
 */
export const CLEF_CONFIG: Record<Clef, { middleLineDiatonicPos: number }> = {
  treble: { middleLineDiatonicPos: 34 },
  bass: { middleLineDiatonicPos: 22 },
  alto: { middleLineDiatonicPos: 28 },
  tenor: { middleLineDiatonicPos: 26 },
};

/** A built StaveNote paired with its source slot and VexFlow key order. */
export interface BuiltSlotNote {
  slot: ChordRest;
  staveNote: StaveNote;
  /** Chord pitches sorted low→high by MIDI — index = VexFlow key index */
  sortedPitches: NotePitch[];
}

/**
 * Convert our NoteDuration to VexFlow duration format.
 * Appends 'd' for each dot (e.g., "qd" for dotted quarter) so VexFlow
 * calculates the correct tick value.
 */
export function convertDuration(duration: NoteDuration, dots: number = 0): string {
  let vexDuration: string = duration;
  for (let i = 0; i < dots; i++) {
    vexDuration += 'd';
  }
  return vexDuration;
}

/**
 * Diatonic stem direction: the pitch furthest from the clef's middle line
 * decides; at/above middle → stem down, below → stem up.
 */
export function calculateStemDirection(
  pitches: ReadonlyArray<{ step: PitchStep; octave: number }>,
  clef: Clef,
): number {
  const middleDiatonic = CLEF_CONFIG[clef].middleLineDiatonicPos;
  let maxDist = 0;
  let stemDirection = -1; // default down; middle-line notes follow this convention
  for (const p of pitches) {
    const dPos = spellingDiatonicPos(p.step, p.octave);
    const dist = Math.abs(dPos - middleDiatonic);
    if (dist > maxDist) {
      maxDist = dist;
      stemDirection = dPos >= middleDiatonic ? -1 : 1;
    }
  }
  return stemDirection;
}

/** Attach articulation modifiers in render order, positioned opposite the stem. */
export function addArticulations(
  staveNote: StaveNote,
  articulations: readonly ArticulationType[] | undefined,
  stemDirection: number,
): void {
  if (!articulations?.length) return;
  const position = stemDirection === 1 ? Modifier.Position.BELOW : Modifier.Position.ABOVE;
  const sorted = articulations.slice().sort(
    (a, b) => ARTICULATION_RENDER_ORDER.indexOf(a) - ARTICULATION_RENDER_ORDER.indexOf(b),
  );
  for (const art of sorted) {
    staveNote.addModifier(new Articulation(ARTICULATION_VEX_CODES[art]).setPosition(position), 0);
  }
}

/** VexFlow accidental sign for a non-natural alteration. */
export function alterToVexSign(alter: PitchAlter): string {
  return alter === 2 ? '##' : alter === 1 ? '#' : alter === -1 ? 'b' : 'bb';
}

/**
 * Create StaveNotes from ChordRest slots (one slot → one StaveNote).
 * Rests → rest StaveNote; Chords → multi-key StaveNote with accidental
 * suppression tracked per diatonic staff position across the measure.
 *
 * @param slots Slots already sorted by beat position (one measure)
 * @param clef Clef for stem direction calculation
 */
export function createStaveNotesFromSlots(slots: ChordRest[], clef: Clef = 'treble'): BuiltSlotNote[] {
  const built: BuiltSlotNote[] = [];

  // Currently active alteration per diatonic staff position within this
  // measure. Key = spellingDiatonicPos(step, octave); value = active alter
  // (0 = natural). A position absent from the map has not appeared yet.
  const activeMeasureAlterations = new Map<number, PitchAlter>();

  for (const slot of slots) {
    if (slot.type === 'rest') {
      const vexDuration = convertDuration(slot.duration, slot.dots || 0);
      // A plain whole rest at beat 0 is a whole-measure rest: stock VexFlow
      // centers it in the measure (alignCenter) and convention hangs it below
      // the fourth line (d/5). All other rests sit at the b/4 default.
      const isWholeMeasureRest =
        slot.duration === 'w' && !slot.dots && !slot.tupletId && slot.beat.num === 0;
      const staveNote = new StaveNote({
        keys: [isWholeMeasureRest ? 'd/5' : 'b/4'],
        duration: vexDuration + 'r',
        alignCenter: isWholeMeasureRest,
      });
      for (let d = 0; d < (slot.dots || 0); d++) {
        Dot.buildAndAttach([staveNote], { all: true });
      }
      staveNote.setAttribute('id', slot.id);
      built.push({ slot, staveNote, sortedPitches: [] });
      continue;
    }

    // Chord slot — decide which accidental sign (if any) to display per pitch.
    const displayAccidentals = new Map<string, string | null>();
    for (const p of slot.notes) {
      if (p.tiedFrom) {
        // Tied continuation: never re-show the accidental
        displayAccidentals.set(p.id, null);
        continue;
      }
      const dPos = spellingDiatonicPos(p.step, p.octave);
      const activeAlter = activeMeasureAlterations.get(dPos); // undefined = not seen yet

      if (p.alter !== 0) {
        // Non-natural pitch — show sign unless the same alteration is already active
        if (!p.forceAccidental && activeAlter === p.alter) {
          displayAccidentals.set(p.id, null); // suppress: redundant
        } else {
          displayAccidentals.set(p.id, alterToVexSign(p.alter));
          activeMeasureAlterations.set(dPos, p.alter);
        }
      } else if (activeAlter !== undefined && activeAlter !== 0) {
        // A previous note on this staff position was altered — show ♮ to cancel
        displayAccidentals.set(p.id, 'n');
        activeMeasureAlterations.set(dPos, 0);
      } else if (p.forceAccidental) {
        // Caller explicitly wants a courtesy natural sign
        displayAccidentals.set(p.id, 'n');
        activeMeasureAlterations.set(dPos, 0);
      } else {
        displayAccidentals.set(p.id, null); // no sign needed
      }
    }

    // Sort pitches low→high by MIDI value (VexFlow requires ascending key order)
    const sortedPitches = slot.notes.toSorted(
      (a, b) => spellingToMidi(a.step, a.alter, a.octave) - spellingToMidi(b.step, b.alter, b.octave),
    );
    const keys = sortedPitches.map(p => spellingToVexflowKey(p.step, p.alter, p.octave));

    const stemDirection = slot.stemDirection === 'up'
      ? 1
      : slot.stemDirection === 'down'
        ? -1
        : calculateStemDirection(slot.notes, clef);

    const vexDuration = convertDuration(slot.duration, slot.dots || 0);
    const staveNote = new StaveNote({ keys, duration: vexDuration, autoStem: false });
    staveNote.setStemDirection(stemDirection);
    staveNote.setAttribute('id', slot.id);

    // Accidental modifiers — VexFlow accepts '#', 'b', 'n', '##', 'bb'
    sortedPitches.forEach((p, idx) => {
      const acc = displayAccidentals.get(p.id) ?? null;
      if (acc) staveNote.addModifier(new Accidental(acc), idx);
    });

    for (let d = 0; d < (slot.dots || 0); d++) {
      Dot.buildAndAttach([staveNote], { all: true });
    }

    // Articulations are per-chord (stored on slot, not per pitch)
    addArticulations(staveNote, slot.articulations, stemDirection);

    built.push({ slot, staveNote, sortedPitches });
  }

  return built;
}
