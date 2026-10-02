// scoreToEvents tests (issue #366, phase 4): pure extraction of schedulable
// events from the notation model — tempo mapping, chords, rest skipping,
// same-pitch tie merging, and exact tuplet timing.

import { beforeEach, describe, expect, it } from 'vitest';
import { ScoreModel } from '../../src/services/score/ScoreModel';
import { createTuplet, refillTupletRemainder } from '../../src/services/score/tupletOps';
import { fracCreate as frac } from '../../src/services/score/fraction';
import { scoreToEvents } from '../../src/services/score/scoreToEvents';

describe('scoreToEvents', () => {
  let model: ScoreModel;

  beforeEach(() => {
    model = new ScoreModel('Events Test', 120); // 2 beats/second
    model.addMeasure();
  });

  it('maps beats to seconds at the score tempo and skips rests', () => {
    model.addNote({ step: 'C', alter: 0, octave: 4, duration: 'q', measure: 1, beat: frac(0, 1) });
    model.addNote({ step: 'D', alter: 0, octave: 4, duration: 'h', measure: 1, beat: frac(2, 1) });

    const { events, totalDuration } = scoreToEvents(model.getScore());
    expect(events).toHaveLength(2);

    expect(events[0].midi).toBe(60);
    expect(events[0].start).toBeCloseTo(0);
    expect(events[0].duration).toBeCloseTo(0.5); // quarter @120

    expect(events[1].midi).toBe(62);
    expect(events[1].start).toBeCloseTo(1.0); // beat 2 @120
    expect(events[1].duration).toBeCloseTo(1.0); // half @120

    expect(totalDuration).toBeCloseTo(4.0); // two 4/4 measures @120
  });

  it('offsets events in later measures by the preceding measure lengths', () => {
    model.addNote({ step: 'G', alter: 1, octave: 4, duration: 'q', measure: 2, beat: frac(1, 1) });
    const { events } = scoreToEvents(model.getScore());
    expect(events).toHaveLength(1);
    expect(events[0].midi).toBe(68); // G#4
    expect(events[0].start).toBeCloseTo(2.5); // 4 beats + 1 beat @120
  });

  it('emits one event per chord pitch with a shared onset', () => {
    for (const step of ['C', 'E', 'G'] as const) {
      model.addNote({ step, alter: 0, octave: 4, duration: 'q', measure: 1, beat: frac(0, 1) });
    }
    const { events } = scoreToEvents(model.getScore());
    expect(events).toHaveLength(3);
    expect(new Set(events.map(e => e.start.toFixed(4))).size).toBe(1);
    expect(events.map(e => e.midi).toSorted((a, b) => a - b)).toEqual([60, 64, 67]);
  });

  it('merges same-pitch tie chains into one long event', () => {
    // E4 h (m1 beat 2) tied to E4 h (m2 beat 0): one 4-beat event
    const from = model.addNote({ step: 'E', alter: 0, octave: 4, duration: 'h', measure: 1, beat: frac(2, 1) });
    const to = model.addNote({ step: 'E', alter: 0, octave: 4, duration: 'h', measure: 2, beat: frac(0, 1) });
    model.updateNote(from.id, { tiedTo: to.id });
    model.updateNote(to.id, { tiedFrom: from.id });

    const { events } = scoreToEvents(model.getScore());
    expect(events).toHaveLength(1);
    expect(events[0].start).toBeCloseTo(1.0);
    expect(events[0].duration).toBeCloseTo(2.0); // 4 beats @120
  });

  it('times tuplet notes by their exact actual duration', () => {
    const tuplet = createTuplet(model, 1, frac(0, 1), '8', 3, 2);
    const beats = [frac(0, 1), frac(1, 3), frac(2, 3)];
    const steps = ['A', 'B', 'C'] as const;
    beats.forEach((beat, i) => {
      model.addNote({
        step: steps[i], alter: 0, octave: 4, duration: '8', measure: 1, beat,
        tupletId: tuplet.id, actualDuration: frac(1, 3),
      });
    });
    refillTupletRemainder(model, 1, tuplet);
    model.repairAllMeasureGaps();

    const { events } = scoreToEvents(model.getScore());
    const tupletEvents = events.filter(e => e.start < 0.6).toSorted((a, b) => a.start - b.start);
    expect(tupletEvents).toHaveLength(3);
    expect(tupletEvents[0].start).toBeCloseTo(0);
    expect(tupletEvents[1].start).toBeCloseTo(1 / 6); // 1/3 beat @120
    expect(tupletEvents[2].start).toBeCloseTo(2 / 6);
    for (const event of tupletEvents) {
      expect(event.duration).toBeCloseTo(1 / 6);
    }
  });

  it('applies the requested velocity uniformly', () => {
    model.addNote({ step: 'C', alter: 0, octave: 4, duration: 'q', measure: 1, beat: frac(0, 1) });
    const { events } = scoreToEvents(model.getScore(), 0.6);
    expect(events[0].velocity).toBe(0.6);
  });
});
