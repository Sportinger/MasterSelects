// ScoreEditorEngine tests (issue #366, phase 3) — port of kikoromantest's
// MusicEngine suite, plus coverage for the host-history commit contract that
// replaced its internal UndoRedoManager. No renderer/audio mocks needed: the
// engine is pure model logic; geometry only matters for pixel entry.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScoreEditorEngine, type ScoreCommitOptions } from '../../src/services/score/ScoreEditorEngine';
import { ScoreModel } from '../../src/services/score/ScoreModel';
import { fracCreate as frac } from '../../src/services/score/fraction';

function makeEngine() {
  const model = new ScoreModel('Engine Test', 120);
  model.addMeasure(); // second measure for overflow tests
  const commits: Array<{ description: string; options?: ScoreCommitOptions }> = [];
  const engine = new ScoreEditorEngine(
    model.toScoreData(),
    (description, options) => commits.push({ description, options }),
    () => null,
  );
  return { engine, commits };
}

type Engine = ReturnType<typeof makeEngine>['engine'];

function addNote(engine: Engine, params: Parameters<Engine['addNoteAtBeat']>[0]) {
  const note = engine.addNoteAtBeat(params);
  if (!note) throw new Error(`Failed to place note at measure ${params.measure}`);
  return note;
}

describe('ScoreEditorEngine.updateNote — overflow handling', () => {
  let engine: Engine;

  beforeEach(() => {
    engine = makeEngine().engine;
  });

  it('no overflow: extending a note that fits does not create a tie', () => {
    const note = addNote(engine, { step: 'C', alter: 0, octave: 4, duration: 'q', measure: 1, beat: frac(0, 1) });
    const updated = engine.updateNote(note.id, { duration: 'h' });

    expect(updated.duration).toBe('h');
    expect(updated.tiedTo).toBeUndefined();

    const m2 = engine.getScore().measures.find(m => m.number === 2)!;
    expect(m2.slots.filter(s => s.type !== 'rest')).toHaveLength(0);
  });

  it('overflow: extends across barline and creates a tied continuation', () => {
    // Quarter at beat 2 in 4/4 → 2 beats available. Whole (4b) → overflow 2b
    const note = addNote(engine, { step: 'E', alter: 0, octave: 4, duration: 'q', measure: 1, beat: frac(2, 1) });
    engine.updateNote(note.id, { duration: 'w' });

    const m1Note = engine.getNote(note.id)!;
    expect(m1Note.duration).toBe('h');
    expect(m1Note.tiedTo).toBeTruthy();

    const m2Note = engine.getNote(m1Note.tiedTo!)!;
    expect(m2Note.duration).toBe('h');
    expect(m2Note.measure).toBe(2);
    expect(m2Note.tiedFrom).toBe(note.id);
    expect(m2Note.step).toBe('E');
  });

  it('overflow: 3 beats remaining splits into two tied notes within the measure', () => {
    const note = addNote(engine, { step: 'G', alter: 0, octave: 4, duration: 'q', measure: 1, beat: frac(1, 1) });
    engine.updateNote(note.id, { duration: 'w' });

    const n1 = engine.getNote(note.id)!;
    expect(n1.duration).toBe('h');
    expect(n1.measure).toBe(1);
    expect(n1.tiedTo).toBeTruthy();

    const n2 = engine.getNote(n1.tiedTo!)!;
    expect(n2.duration).toBe('q');
    expect(n2.measure).toBe(1);
    expect(n2.tiedFrom).toBe(note.id);
    expect(n2.tiedTo).toBeTruthy();

    const n3 = engine.getNote(n2.tiedTo!)!;
    expect(n3.duration).toBe('q');
    expect(n3.measure).toBe(2);
    expect(n3.tiedFrom).toBe(n2.id);
    expect(n3.tiedTo).toBeUndefined();
  });

  it('overflow: dotted note that overflows is split correctly', () => {
    const note = addNote(engine, { step: 'A', alter: 0, octave: 4, duration: 'q', measure: 1, beat: frac(3, 1) });
    engine.updateNote(note.id, { duration: 'h', dots: 1 });

    const m1Note = engine.getNote(note.id)!;
    expect(m1Note.duration).toBe('q'); // 1 beat fits → quarter
    expect(m1Note.tiedTo).toBeTruthy();

    const next = engine.getNote(m1Note.tiedTo!)!;
    expect(next.measure).toBe(2);
    expect(next.step).toBe('A');
  });
});

describe('ScoreEditorEngine — edit semantics', () => {
  let engine: Engine;

  beforeEach(() => {
    engine = makeEngine().engine;
  });

  it('deleting a single note replaces it with a rest of the same duration', () => {
    const note = addNote(engine, { step: 'C', alter: 0, octave: 4, duration: 'h', measure: 1, beat: frac(0, 1) });
    expect(engine.deleteNote(note.id)).toBe(true);

    const m1 = engine.getScore().measures[0];
    const restAtZero = m1.slots.find(s => s.type === 'rest' && s.beat.num === 0);
    expect(restAtZero?.duration).toBe('h');
    expect(m1.slots.some(s => s.type === 'chord')).toBe(false);
  });

  it('deleting a chord member keeps the chord', () => {
    const first = addNote(engine, { step: 'C', alter: 0, octave: 4, duration: 'q', measure: 1, beat: frac(0, 1) });
    const second = engine.addChordNote({ step: 'E', alter: 0, octave: 4, duration: 'q', measure: 1, beat: frac(0, 1) });

    expect(engine.deleteNote(second.id)).toBe(true);
    expect(engine.getNote(first.id)).toBeTruthy();
    expect(engine.getNote(second.id)).toBeUndefined();
  });

  it('toggleTie links to the next slot and toggles off again', () => {
    const a = addNote(engine, { step: 'C', alter: 0, octave: 4, duration: 'q', measure: 1, beat: frac(0, 1) });
    const b = addNote(engine, { step: 'C', alter: 0, octave: 4, duration: 'q', measure: 1, beat: frac(1, 1) });

    expect(engine.toggleTie(a.id)).toBe(true);
    expect(engine.getNote(a.id)?.tiedTo).toBe(b.id);
    expect(engine.getNote(b.id)?.tiedFrom).toBe(a.id);

    expect(engine.toggleTie(a.id)).toBe(false);
    expect(engine.getNote(a.id)?.tiedTo).toBeUndefined();
    expect(engine.getNote(b.id)?.tiedFrom).toBeUndefined();
  });

  it('shortening a tied note breaks the tie when it no longer abuts the target', () => {
    const note = addNote(engine, { step: 'E', alter: 0, octave: 4, duration: 'q', measure: 1, beat: frac(2, 1) });
    engine.updateNote(note.id, { duration: 'w' }); // splits h + tied h in m2
    const head = engine.getNote(note.id)!;
    const tail = engine.getNote(head.tiedTo!)!;

    engine.updateNote(head.id, { duration: 'q' }); // no longer reaches the barline
    expect(engine.getNote(head.id)?.tiedTo).toBeUndefined();
    expect(engine.getNote(tail.id)?.tiedFrom).toBeUndefined();
  });

  it('toggleArticulation adds and removes', () => {
    const note = addNote(engine, { step: 'C', alter: 0, octave: 4, duration: 'q', measure: 1, beat: frac(0, 1) });
    expect(engine.toggleArticulation(note.id, 'staccato')?.articulations).toContain('staccato');
    expect(engine.toggleArticulation(note.id, 'staccato')?.articulations).not.toContain('staccato');
  });

  it('flipStemDirection forces the opposite of natural, then back to auto', () => {
    // B4 sits on the middle line (treble) → natural down → forced up
    const note = addNote(engine, { step: 'B', alter: 0, octave: 4, duration: 'q', measure: 1, beat: frac(0, 1) });
    expect(engine.flipStemDirection(note.id)?.stemDirection).toBe('up');
    expect(engine.flipStemDirection(note.id)?.stemDirection).toBeUndefined(); // back to auto
  });
});

describe('ScoreEditorEngine — commit contract (host history)', () => {
  it('every mutation commits once; transient updates are marked', () => {
    const { engine, commits } = makeEngine();

    const note = addNote(engine, { step: 'C', alter: 0, octave: 4, duration: 'q', measure: 1, beat: frac(0, 1) });
    expect(commits).toHaveLength(1);
    expect(commits[0].options?.transient).toBeUndefined();

    engine.updateNote(note.id, { step: 'D' }, { transient: true });
    expect(commits).toHaveLength(2);
    expect(commits[1].options?.transient).toBe(true);

    engine.commitTransientEdits('Drag pitch');
    expect(commits).toHaveLength(3);
    expect(commits[2].description).toBe('Drag pitch');
    expect(commits[2].options?.transient).toBeUndefined();
  });

  it('loadScoreData replaces the model without committing', () => {
    const { engine, commits } = makeEngine();
    const snapshot = engine.toScoreData();

    addNote(engine, { step: 'C', alter: 0, octave: 4, duration: 'q', measure: 1, beat: frac(0, 1) });
    const committed = commits.length;

    engine.loadScoreData(snapshot);
    expect(commits.length).toBe(committed);
    expect(engine.getScore().measures.every(m => m.slots.every(s => s.type === 'rest'))).toBe(true);
  });

  it('commits repair measure fill before persisting (tuplet gaps included)', () => {
    const { engine } = makeEngine();
    const onCommitSpy = vi.fn();
    void onCommitSpy;

    const note = addNote(engine, { step: 'C', alter: 0, octave: 4, duration: 'q', measure: 1, beat: frac(0, 1) });
    engine.applyTupletToNote(note.id);

    // The committed data is always fully filled: slot durations per measure
    // sum to 4 beats (validated indirectly — no non-rest gaps remain)
    const data = engine.toScoreData();
    for (const measure of data.measures) {
      const total = measure.slots.reduce((sum, slot) => {
        const d = slot.actualDuration!;
        return sum + d.num / d.den;
      }, 0);
      expect(total).toBeCloseTo(4);
    }
  });
});
