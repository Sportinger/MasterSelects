// MouseNoteEntry tests (issue #366, phase 3): the pixel-position entry logic
// against a synthetic ScoreEntryGeometry (beat n sits at x = 50 + n·100),
// covering directional beat resolution, chord joins, same-pitch rejection,
// entry-zone guards, and overflow tie-splitting.

import { beforeEach, describe, expect, it } from 'vitest';
import { MouseNoteEntry, type ScoreEntryGeometry } from '../../src/services/score/MouseNoteEntry';
import { NoteEntryCoordinator } from '../../src/services/score/NoteEntryCoordinator';
import { CollisionDetector } from '../../src/services/score/CollisionDetector';
import { ScoreModel } from '../../src/services/score/ScoreModel';
import { fracCreate as frac, fracToNumber } from '../../src/services/score/fraction';
import type { PitchSpelling } from '../../src/types/scoreClip';

const START_X = 50;
const PX_PER_BEAT = 100;
const beatToX = (beat: number) => START_X + beat * PX_PER_BEAT;

/** Geometry over the live model: slots sit at beatToX, pitch fixed by caller. */
function makeGeometry(model: () => ScoreModel, pitchForY: (y: number) => PitchSpelling): ScoreEntryGeometry {
  return {
    measureAtPoint: () => 1,
    yToNaturalPitch: (y) => pitchForY(y),
    noteEntryXRange: () => ({ startX: START_X, endX: START_X + 4 * PX_PER_BEAT }),
    staffYRange: () => ({ topY: 40, bottomY: 80 }),
    findNotesLeftRight: (x, measure) => {
      let nearestLeft = null;
      let nearestRight = null;
      let leftDistance = Infinity;
      let rightDistance = Infinity;
      const seen = new Set<string>();
      for (const n of model().getNotesInMeasure(measure)) {
        const beat = fracToNumber(n.beat);
        const key = `${beat}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const centerX = beatToX(beat);
        const distance = centerX - x;
        const neighbor = { type: n.isRest ? 'rest' as const : 'note' as const, beat };
        if (distance <= 0 && Math.abs(distance) < leftDistance) {
          leftDistance = Math.abs(distance);
          nearestLeft = neighbor;
        }
        if (distance >= 0 && distance < rightDistance) {
          rightDistance = distance;
          nearestRight = neighbor;
        }
      }
      return { nearestLeft, nearestRight, leftDistance, rightDistance };
    },
    xToBeat: (x, _measure, beatsInMeasure) =>
      Math.max(0, Math.min(beatsInMeasure, (x - START_X) / PX_PER_BEAT)),
  };
}

describe('MouseNoteEntry.addNoteAtPosition', () => {
  let model: ScoreModel;
  let entry: MouseNoteEntry;
  let commits: string[];
  const C5: PitchSpelling = { step: 'C', alter: 0, octave: 5 };

  beforeEach(() => {
    model = new ScoreModel('Mouse Test', 120);
    model.addMeasure();
    commits = [];
    const collision = new CollisionDetector();
    const coordinator = new NoteEntryCoordinator(() => model, collision, d => commits.push(d));
    const geometry = makeGeometry(() => model, () => C5);
    entry = new MouseNoteEntry(() => model, coordinator, collision, () => geometry, d => commits.push(d));
  });

  it('places a note on the whole rest at the clicked beat (directional snap)', () => {
    // Only the whole rest at beat 0 exists; a click at beat 2 is FAR from it
    // → coordinate calculation, then landed on the covering rest span
    const note = entry.addNoteAtPosition({ x: beatToX(2), y: 50 }, 'q');
    expect(note).toBeTruthy();
    expect(note!.step).toBe('C');
    expect(fracToNumber(note!.beat)).toBe(2);
    expect(commits).toContain('Add note');
    // Measure stays fully filled around it
    model.repairAllMeasureGaps();
    const total = model.getScore().measures[0].slots.reduce((sum, s) => sum + s.actualDuration!.num / s.actualDuration!.den, 0);
    expect(total).toBeCloseTo(4);
  });

  it('joins an existing note as a chord at the same beat (different pitch)', () => {
    model.addNote({ step: 'E', alter: 0, octave: 4, duration: 'q', measure: 1, beat: frac(1, 1) });
    const note = entry.addNoteAtPosition({ x: beatToX(1), y: 50 }, 'q');
    expect(note).toBeTruthy();
    const chord = model.getScore().measures[0].slots.find(s => s.type === 'chord' && s.beat.num === 1);
    expect(chord?.type === 'chord' && chord.notes.length).toBe(2);
  });

  it('rejects a same-pitch click on an existing note', () => {
    model.addNote({ step: 'C', alter: 0, octave: 5, duration: 'q', measure: 1, beat: frac(1, 1) });
    const before = model.getNotesInMeasure(1).filter(n => !n.isRest).length;
    const note = entry.addNoteAtPosition({ x: beatToX(1), y: 50 }, 'q');
    // Same pitch at the same beat replaces the note (Sibelius overwrite)
    expect(note).toBeTruthy();
    expect(model.getNotesInMeasure(1).filter(n => !n.isRest).length).toBe(before);
  });

  it('rejects clicks outside the note-entry X range', () => {
    expect(entry.addNoteAtPosition({ x: START_X - 30, y: 50 }, 'q')).toBeNull();
  });

  it('rejects clicks far above the staff', () => {
    expect(entry.addNoteAtPosition({ x: beatToX(1), y: 300 }, 'q')).toBeNull();
  });

  it('splits an overflowing note across the barline with a tie', () => {
    // Fill beats 0–2 so the click at beat 3 snaps to the rest there (the
    // empty-space path would quantize a half note to beat 2 instead)
    model.addNote({ step: 'E', alter: 0, octave: 4, duration: 'q', measure: 1, beat: frac(0, 1) });
    model.addNote({ step: 'F', alter: 0, octave: 4, duration: 'q', measure: 1, beat: frac(1, 1) });
    model.addNote({ step: 'G', alter: 0, octave: 4, duration: 'q', measure: 1, beat: frac(2, 1) });

    // Half note at beat 3 in 4/4 → 1 beat fits, 1 beat overflows into m2
    const note = entry.addNoteAtPosition({ x: beatToX(3), y: 50 }, 'h');
    expect(note).toBeTruthy();
    expect(note!.duration).toBe('q');
    expect(note!.measure).toBe(1);

    const head = model.getNote(note!.id)!;
    expect(head.tiedTo).toBeTruthy();
    const tail = model.getNote(head.tiedTo!)!;
    expect(tail.measure).toBe(2);
    expect(tail.duration).toBe('q');
    expect(tail.tiedFrom).toBe(head.id);
  });
});
