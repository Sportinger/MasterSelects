// VexFlow score renderer pipeline smoke tests (issue #366, port phase 2).
//
// jsdom has no real canvas, so a stubbed measureText gives VexFlow usable
// text metrics; glyph pixel fidelity is verified live in the popup. These
// tests prove the render pipeline structurally: model slot ids land as SVG
// element ids, selection styles are applied pre-draw, ghost notes render as
// an overlay group, and ties build as stock StaveTie (partials across lines).

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ScoreModel } from '../../src/services/score/ScoreModel';
import { createTuplet, refillTupletRemainder } from '../../src/services/score/tupletOps';
import { fracCreate as frac } from '../../src/services/score/fraction';
import { VexFlowScoreRenderer } from '../../src/services/score/render/VexFlowScoreRenderer';
import { buildTies } from '../../src/services/score/render/scoreSpanners';
import type { Chord } from '../../src/types/scoreClip';

beforeAll(() => {
  // Minimal 2D context stub: VexFlow only needs measureText for glyph metrics.
  const measureText = (text: string) => ({
    width: (text?.length ?? 1) * 10,
    fontBoundingBoxAscent: 10,
    fontBoundingBoxDescent: 3,
    actualBoundingBoxAscent: 10,
    actualBoundingBoxDescent: 3,
    actualBoundingBoxLeft: 0,
    actualBoundingBoxRight: (text?.length ?? 1) * 10,
    alphabeticBaseline: 0,
    emHeightAscent: 10,
    emHeightDescent: 3,
    hangingBaseline: 8,
    ideographicBaseline: -2,
  });
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: function getContext(kind: string) {
      if (kind !== '2d') return null;
      return { font: '', measureText };
    },
  });
});

function makeRenderer(width = 800): { renderer: VexFlowScoreRenderer; container: HTMLDivElement } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const renderer = new VexFlowScoreRenderer(container);
  renderer.initialize(width, 200);
  return { renderer, container };
}

describe('VexFlowScoreRenderer', () => {
  let model: ScoreModel;

  beforeEach(() => {
    model = new ScoreModel('Render Test', 120);
  });

  it('renders slots as vf-stavenote groups carrying model slot ids', () => {
    model.addNote({ step: 'C', alter: 0, octave: 4, duration: 'q', measure: 1, beat: frac(0, 1) });
    model.addNote({ step: 'E', alter: 0, octave: 4, duration: 'q', measure: 1, beat: frac(0, 1) }); // chord
    model.addNote({ step: 'F', alter: 1, octave: 4, duration: '8', measure: 1, beat: frac(2, 1), dots: 0 });
    const score = model.getScore();

    const { renderer, container } = makeRenderer();
    renderer.renderScore(score, { width: 800 });

    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();

    // Every slot (chord + filler rests) renders one vf-stavenote group with its model id
    const slotIds = score.measures[0].slots.map(s => s.id);
    const groups = svg!.querySelectorAll('.vf-stavenote');
    expect(groups.length).toBe(slotIds.length);
    for (const slotId of slotIds) {
      expect(svg!.querySelector(`[id="vf-${slotId}"]`)).toBeTruthy();
    }

    // Note refs exist for every pitch and rest (interaction layer contract)
    const chord = score.measures[0].slots.find(s => s.type === 'chord') as Chord;
    for (const pitch of chord.notes) {
      expect(renderer.getNoteRef(pitch.id)).toBeTruthy();
    }
    expect(renderer.getStave(1)).toBeTruthy();
    expect(renderer.getMeasureBounds(1)?.noteStartX).toBeGreaterThan(0);
    expect(renderer.getRenderedHeight()).toBeGreaterThan(0);
  });

  it('applies the amber selection style pre-draw for the selected pitch', () => {
    const note = model.addNote({ step: 'G', alter: 0, octave: 4, duration: 'q', measure: 1, beat: frac(0, 1) });

    const { renderer, container } = makeRenderer();
    renderer.renderScore(model.getScore(), { width: 800, selection: { noteId: note.id } });
    expect(container.querySelector('svg')!.innerHTML).toContain('#F59E0B');

    // And not when nothing is selected
    renderer.renderScore(model.getScore(), { width: 800 });
    expect(container.querySelector('svg')!.innerHTML).not.toContain('#F59E0B');
  });

  it('renders a ghost note as a styled non-interactive overlay group', () => {
    const { renderer, container } = makeRenderer();
    renderer.renderScore(model.getScore(), {
      width: 800,
      ghostNote: { step: 'D', alter: 0, octave: 5, duration: 'q', measure: 1, beat: 1 },
    });

    const ghost = container.querySelector('.vf-score-ghost-note') as SVGGElement;
    expect(ghost).toBeTruthy();
    expect(ghost.style.pointerEvents).toBe('none');
    expect(ghost.innerHTML).toContain('rgba(59, 130, 246');
  });

  it('renders tuplets without failing the measure', () => {
    const tuplet = createTuplet(model, 1, frac(0, 1), '8', 3, 2);
    model.addNote({
      step: 'C', alter: 0, octave: 4, duration: '8', measure: 1, beat: frac(0, 1),
      tupletId: tuplet.id, actualDuration: frac(1, 3),
    });
    refillTupletRemainder(model, 1, tuplet);
    // Writers repair gaps before committing (the pre-render safety net):
    // fillGapsWithRests skips gaps that START inside a tuplet span, so the
    // beats after the tuplet are only filled once the tuplet itself is full.
    model.repairAllMeasureGaps();

    const { renderer } = makeRenderer();
    renderer.renderScore(model.getScore(), { width: 800 });
    expect(renderer.getTuplet(tuplet.id)).toBeTruthy();
  });

  it('builds one stock StaveTie on the same line and two partials across lines', () => {
    // Tie C4 h (m1 beat 2) → C4 h (m2 beat 0)
    model.addMeasure();
    const from = model.addNote({ step: 'C', alter: 0, octave: 4, duration: 'h', measure: 1, beat: frac(2, 1) });
    const to = model.addNote({ step: 'C', alter: 0, octave: 4, duration: 'h', measure: 2, beat: frac(0, 1) });
    model.updateNote(from.id, { tiedTo: to.id });
    model.updateNote(to.id, { tiedFrom: from.id });
    const score = model.getScore();

    // Wide: both measures on one line → a single full tie
    const wide = makeRenderer(900);
    wide.renderer.renderScore(score, { width: 900 });
    const refs = new Map([
      [from.id, wide.renderer.getNoteRef(from.id)!],
      [to.id, wide.renderer.getNoteRef(to.id)!],
    ]);
    expect(buildTies(score, refs, wide.renderer.getLayoutInfo()).length).toBe(1);

    // Narrow: one measure per line → two partial arcs
    const narrow = makeRenderer(260);
    narrow.renderer.renderScore(score, { width: 260 });
    const narrowRefs = new Map([
      [from.id, narrow.renderer.getNoteRef(from.id)!],
      [to.id, narrow.renderer.getNoteRef(to.id)!],
    ]);
    const lines = new Set(
      [...narrow.renderer.getLayoutInfo().values()].map(info => info.lineNumber),
    );
    expect(lines.size).toBe(2);
    expect(buildTies(score, narrowRefs, narrow.renderer.getLayoutInfo()).length).toBe(2);
  });

  it('renders a whole-measure rest as a stock center-aligned rest', () => {
    // A fresh measure holds one whole rest — stock VexFlow centers it
    const restSlot = model.getScore().measures[0].slots[0];
    expect(restSlot.type).toBe('rest');

    const { renderer } = makeRenderer();
    renderer.renderScore(model.getScore(), { width: 800 });

    const ref = renderer.getNoteRef(restSlot.id);
    expect(ref).toBeTruthy();
    expect(ref!.staveNote.isCenterAligned()).toBe(true);

    // A partial rest (e.g. the half rest after a half note) is NOT centered
    model.addNote({ step: 'C', alter: 0, octave: 4, duration: 'h', measure: 1, beat: frac(0, 1) });
    renderer.renderScore(model.getScore(), { width: 800 });
    const partialRest = model.getScore().measures[0].slots.find(s => s.type === 'rest')!;
    expect(renderer.getNoteRef(partialRest.id)!.staveNote.isCenterAligned()).toBe(false);
  });

  it('re-renders cleanly (full clear, no accumulation)', () => {
    model.addNote({ step: 'A', alter: 0, octave: 4, duration: 'q', measure: 1, beat: frac(0, 1) });
    const { renderer, container } = makeRenderer();

    renderer.renderScore(model.getScore(), { width: 800 });
    const countFirst = container.querySelectorAll('.vf-stavenote').length;
    renderer.renderScore(model.getScore(), { width: 800 });
    const countSecond = container.querySelectorAll('.vf-stavenote').length;
    expect(countSecond).toBe(countFirst);
  });
});
