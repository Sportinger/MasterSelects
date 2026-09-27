// Tuplet lifecycle operations for the score model (issue #366).
//
// Creation, lookup, remainder refill, and deletion of tuplets, as free
// functions over ScoreModel's public API — split out of ScoreModel so the
// model file owns slot CRUD only.

import type { Note, NoteDuration, Tuplet, Fraction } from '../../types/scoreClip';
import { ScoreModel } from './ScoreModel';
import {
  getTupletTotalBeatsFrac,
  isBeatInTupletFrac,
  noteSpansOverlapFrac,
  splitBeatsIntoDurations,
} from './musicUtils';
import {
  durationToFraction,
  fracAdd,
  fracCompare,
  fracCreate,
  fracLt,
  fracMul,
  fracSub,
  fracToNumber,
} from './fraction';
import { fillGapsWithRests } from './restFill';
import { generateScoreElementId } from './scoreIds';

/**
 * Create a tuplet in a measure. Removes any existing slots that overlap the
 * tuplet's time span; places no initial notes or rests (callers add the first
 * note and/or call refillTupletRemainder).
 */
export function createTuplet(
  model: ScoreModel,
  measureNumber: number,
  startBeat: Fraction,
  baseDuration: NoteDuration,
  numNotes: number = 3,
  notesOccupied: number = 2,
): Tuplet {
  const measure = model.getMeasure(measureNumber);
  if (!measure) {
    throw new Error(`Measure ${measureNumber} does not exist`);
  }

  const tuplet: Tuplet = {
    id: generateScoreElementId(),
    startBeat,
    baseDuration,
    numNotes,
    notesOccupied,
  };

  if (!measure.tuplets) {
    measure.tuplets = [];
  }
  measure.tuplets.push(tuplet);

  // Remove any existing slots that overlap with the tuplet's time span
  const tupletDurFrac = getTupletTotalBeatsFrac(baseDuration, notesOccupied);
  measure.slots = measure.slots.filter(slot => {
    const slotDurFrac = slot.actualDuration ?? durationToFraction(slot.duration, slot.dots ?? 0);
    return !noteSpansOverlapFrac(slot.beat, slotDurFrac, startBeat, tupletDurFrac);
  });

  measure.slots.sort((a, b) => fracCompare(a.beat, b.beat));

  return tuplet;
}

/** Get a tuplet by its ID. */
export function getTuplet(model: ScoreModel, tupletId: string): Tuplet | undefined {
  for (const measure of model.getScore().measures) {
    if (!measure.tuplets) continue;
    const tuplet = measure.tuplets.find(t => t.id === tupletId);
    if (tuplet) return tuplet;
  }
  return undefined;
}

/** Get the tuplet at a specific beat position in a measure. */
export function getTupletAtBeat(
  model: ScoreModel,
  measureNumber: number,
  beat: Fraction,
): Tuplet | undefined {
  const measure = model.getMeasure(measureNumber);
  if (!measure || !measure.tuplets) return undefined;
  return measure.tuplets.find(tuplet => isBeatInTupletFrac(beat, tuplet));
}

/** Get all notes that belong to a specific tuplet (as flat Notes). */
export function getNotesInTuplet(model: ScoreModel, tupletId: string): Note[] {
  for (const measure of model.getScore().measures) {
    const slots = measure.slots.filter(s => s.tupletId === tupletId);
    if (slots.length > 0) {
      // Flat notes inherit the slot's tupletId, so filtering the measure's
      // flat view by tupletId flattens exactly these slots.
      return model
        .getNotesInMeasure(measure.number)
        .filter(n => n.tupletId === tupletId);
    }
  }
  return [];
}

/**
 * Fill any empty gaps in a tuplet with filler rests.
 *
 * Algorithm:
 *   1. Collect all existing slots (notes AND rests) in the tuplet, sorted by beat.
 *   2. Walk the tuplet's time span looking for empty gaps (ranges with no slot).
 *   3. Fill only those empty gaps with new rests.
 *
 * Rests are treated as first-class slots and are never deleted here.
 * Callers are responsible for removing slots before calling this (e.g. when a
 * note grows into a rest's time span).
 */
export function refillTupletRemainder(
  model: ScoreModel,
  measureNumber: number,
  tuplet: Tuplet,
): void {
  const ratio = fracCreate(tuplet.notesOccupied, tuplet.numNotes);
  const inverseRatio = fracCreate(tuplet.numNotes, tuplet.notesOccupied);
  const tupletEnd = fracAdd(tuplet.startBeat, getTupletTotalBeatsFrac(tuplet.baseDuration, tuplet.notesOccupied));

  // Get ALL existing slots (notes and rests) sorted by beat
  const allSlots = getNotesInTuplet(model, tuplet.id)
    .sort((a, b) => fracCompare(a.beat, b.beat));

  // Fill a gap in actual-time [from, to) with tuplet filler rests
  const fillGap = (from: Fraction, to: Fraction): void => {
    if (!fracLt(from, to)) return;
    const actualGap = fracSub(to, from);
    const writtenGap = fracMul(actualGap, inverseRatio);
    const durations = splitBeatsIntoDurations(fracToNumber(writtenGap));
    let beat = from;
    for (const dur of durations) {
      const actualDur = fracMul(durationToFraction(dur), ratio);
      model.addNote({
        duration: dur,
        measure: measureNumber,
        beat,
        isRest: true,
        tupletId: tuplet.id,
        actualDuration: actualDur,
      });
      beat = fracAdd(beat, actualDur);
    }
  };

  // Walk through all slots filling empty gaps between them
  let pointer: Fraction = tuplet.startBeat;
  for (const slot of allSlots) {
    fillGap(pointer, slot.beat);
    const slotActual = slot.actualDuration
      ?? fracMul(durationToFraction(slot.duration, slot.dots ?? 0), ratio);
    pointer = fracAdd(slot.beat, slotActual);
  }
  fillGap(pointer, tupletEnd);
}

/** Delete a tuplet, removing its slots and refilling the span with rests. */
export function deleteTuplet(model: ScoreModel, tupletId: string): boolean {
  for (const measure of model.getScore().measures) {
    if (!measure.tuplets) continue;

    const tupletIndex = measure.tuplets.findIndex(t => t.id === tupletId);
    if (tupletIndex === -1) continue;

    // Remove all slots belonging to this tuplet
    measure.slots = measure.slots.filter(s => s.tupletId !== tupletId);

    // Remove the tuplet
    measure.tuplets.splice(tupletIndex, 1);

    // Re-fill gaps with rests
    fillGapsWithRests(measure);

    return true;
  }
  return false;
}
