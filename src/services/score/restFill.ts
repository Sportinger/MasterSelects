// Rest-filling policy for score measures (issue #366).
//
// A measure is always fully filled: any time not covered by a chord or rest
// slot gets filler rests. These functions own that musical policy — which
// rest durations to use, beat-boundary alignment, tuplet-span exclusion —
// extracted from ScoreModel so the model file owns slot CRUD only.

import type { Measure, Note, Rest, TimeSignature, Fraction } from '../../types/scoreClip';
import {
  durationToFraction,
  fracAdd,
  fracCompare,
  fracCreate,
  fracGt,
  fracGte,
  fracLt,
  fracLte,
  fracToNumber,
} from './fraction';
import { beatToFrac, getMeasureDuration, getTupletTotalBeatsFrac } from './musicUtils';
import { generateScoreElementId } from './scoreIds';

/**
 * Get the beat unit (duration of one "count") for a time signature.
 * In 4/4: 1 (quarter note), in 7/8: 0.5 (eighth note), etc.
 * A whole note equals 4 quarter notes; quarter note = 1 internal beat.
 */
export function getBeatUnit(timeSignature: TimeSignature): number {
  return 4 / timeSignature.denominator;
}

/**
 * Fill an EMPTY measure with rests to complete its time signature.
 * For 4/4 time this creates a single whole rest.
 */
export function fillMeasureWithRests(measure: Measure): void {
  const totalBeats = getMeasureDuration(measure.timeSignature);

  // For 4/4 time, use a single whole rest
  if (totalBeats === 4 && measure.timeSignature.denominator === 4) {
    const rest: Rest = {
      id: generateScoreElementId(),
      type: 'rest',
      duration: 'w',
      measure: measure.number,
      beat: fracCreate(0, 1),
      actualDuration: durationToFraction('w'),
    };
    measure.slots.push(rest);
  } else {
    // For other time signatures, fill with musically appropriate rests
    const rests = createMusicalRests(0, totalBeats, measure.timeSignature);
    for (const rest of rests) {
      measure.slots.push({
        id: generateScoreElementId(),
        type: 'rest',
        duration: rest.duration,
        measure: measure.number,
        beat: rest.beat,
        actualDuration: durationToFraction(rest.duration),
      });
    }
  }
}

/**
 * Fill gaps between existing slots in a measure with rests.
 * Gaps that start inside a tuplet's span are left alone (the tuplet's own
 * refill handles those), and a gap that spans a tuplet start is clipped to it.
 */
export function fillGapsWithRests(measure: Measure): void {
  const totalBeats = getMeasureDuration(measure.timeSignature);
  const totalBeatsFrac: Fraction = fracCreate(Math.round(totalBeats * 8), 8);

  // Sort slots by beat position
  const sortedSlots = measure.slots.toSorted((a, b) => fracCompare(a.beat, b.beat));

  // Find gaps
  const gaps: Array<{ start: Fraction; end: Fraction }> = [];
  let currentBeat: Fraction = fracCreate(0, 1);

  for (const slot of sortedSlots) {
    if (fracLt(currentBeat, slot.beat)) {
      gaps.push({ start: currentBeat, end: slot.beat });
    }
    const slotDurFrac = slot.actualDuration ?? durationToFraction(slot.duration, slot.dots ?? 0);
    currentBeat = fracAdd(slot.beat, slotDurFrac);
  }

  // Check for gap at the end of the measure
  if (fracLt(currentBeat, totalBeatsFrac)) {
    gaps.push({ start: currentBeat, end: totalBeatsFrac });
  }

  // Filter out gaps that start inside a tuplet's span
  const tuplets = measure.tuplets || [];
  const filteredGaps = gaps.filter(gap => {
    for (const tuplet of tuplets) {
      const tupletEndFrac = fracAdd(
        tuplet.startBeat,
        getTupletTotalBeatsFrac(tuplet.baseDuration, tuplet.notesOccupied),
      );
      if (fracGte(gap.start, tuplet.startBeat) && fracLt(gap.start, tupletEndFrac)) {
        return false;
      }
    }
    return true;
  });

  // Fill each gap with musically appropriate rests
  for (const gap of filteredGaps) {
    const adjustedStart = gap.start;
    let adjustedEnd = gap.end;

    for (const tuplet of tuplets) {
      if (fracGt(tuplet.startBeat, adjustedStart) && fracLt(tuplet.startBeat, adjustedEnd)) {
        adjustedEnd = tuplet.startBeat;
      }
    }

    if (fracLte(adjustedEnd, adjustedStart)) continue;

    const rests = createMusicalRests(
      fracToNumber(adjustedStart),
      fracToNumber(adjustedEnd),
      measure.timeSignature,
    );
    for (const rest of rests) {
      measure.slots.push({
        id: generateScoreElementId(),
        type: 'rest',
        duration: rest.duration,
        measure: measure.number,
        beat: rest.beat,
        actualDuration: durationToFraction(rest.duration),
      });
    }
  }
}

/**
 * Create musically appropriate rests for a gap [start, end) in beats.
 * Off-beat positions are filled up to the next beat boundary with small rests;
 * on-beat positions use the largest rest that keeps beat alignment.
 */
export function createMusicalRests(
  start: number,
  end: number,
  timeSignature: TimeSignature,
): Array<{ beat: Fraction; duration: Note['duration'] }> {
  const rests: Array<{ beat: Fraction; duration: Note['duration'] }> = [];
  let current = start;
  const epsilon = 0.001;

  const beatUnit = getBeatUnit(timeSignature);

  while (current < end - epsilon) {
    const remaining = end - current;
    const beatFraction = current % beatUnit;
    const isOnBeat = beatFraction < epsilon || beatFraction > beatUnit - epsilon;

    if (!isOnBeat) {
      const toNextBeat = beatUnit - beatFraction;

      if (toNextBeat >= 0.5 - epsilon && remaining >= 0.5 - epsilon) {
        rests.push({ beat: beatToFrac(current), duration: '8' });
        current += 0.5;
      } else if (toNextBeat >= 0.25 - epsilon && remaining >= 0.25 - epsilon) {
        rests.push({ beat: beatToFrac(current), duration: '16' });
        current += 0.25;
      } else if (toNextBeat >= 0.125 - epsilon && remaining >= 0.125 - epsilon) {
        rests.push({ beat: beatToFrac(current), duration: '32' });
        current += 0.125;
      } else {
        break;
      }
    } else {
      if (remaining >= 4 - epsilon && Math.abs(current % 4) < epsilon) {
        rests.push({ beat: beatToFrac(current), duration: 'w' });
        current += 4;
      } else if (remaining >= 2 - epsilon && Math.abs(current % 2) < epsilon) {
        rests.push({ beat: beatToFrac(current), duration: 'h' });
        current += 2;
      } else if (remaining >= 1 - epsilon && beatUnit <= 1) {
        rests.push({ beat: beatToFrac(current), duration: 'q' });
        current += 1;
      } else if (remaining >= 0.5 - epsilon) {
        rests.push({ beat: beatToFrac(current), duration: '8' });
        current += 0.5;
      } else if (remaining >= 0.25 - epsilon && beatUnit <= 0.25) {
        rests.push({ beat: beatToFrac(current), duration: '16' });
        current += 0.25;
      } else if (remaining >= 0.125 - epsilon) {
        rests.push({ beat: beatToFrac(current), duration: '32' });
        current += 0.125;
      } else {
        break;
      }
    }
  }

  return rests;
}
