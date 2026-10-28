import { describe, expect, it } from 'vitest';
import { compileImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';
import { createDefaultBlockDissolveGraph } from '../../src/services/operators/blockDissolveRecipe';
import { effectOperatorGraph, isImageGraphEffectType } from '../../src/services/operators/effectGraphOwner';
import { getDefaultParams, getEffect } from '../../src/effects';
import { createImagePassEvaluator, discreteImage, type Pixel } from '../helpers/imageGraphPasses';

type Params = Record<string, number | string | boolean>;
const size: [number, number] = [96, 64];
/** No holes, solid fill, dither or displacement: blocks only keep or drop the original. */
const plain: Params = { holes: 0, solid: 0, dither: 0, edgeDither: 0, displace: 0, scale: 120, variation: 0, edgeAmount: 1 };

function render(overrides: Params, image: (x: number, y: number) => Pixel, time = 0) {
  const params = { ...getDefaultParams('block-dissolve'), ...overrides };
  const plan = compileImageOperatorGraph(createDefaultBlockDissolveGraph(), params, { parameterSchema: getEffect('block-dissolve')!.params });
  const evaluate = createImagePassEvaluator(plan, size, discreteImage(size[0], size[1], image), { filterResources: true, float16: true, timelineTimeSeconds: time });
  return (x: number, y: number) => evaluate([(x + .5) / size[0], (y + .5) / size[1]]);
}

/** A dark grey disc (the object) on white. */
const disc = (x: number, y: number): Pixel => Math.hypot(x - 48, y - 32) < 22 ? [.12, .1, .3, 1] : [1, 1, 1, 1];
/** The same disc on transparency. */
const cutOut = (x: number, y: number): Pixel => Math.hypot(x - 48, y - 32) < 22 ? [.9, .4, .1, 1] : [0, 0, 0, 0];

function frame(output: (x: number, y: number) => Pixel) {
  const pixels: Pixel[] = [];
  for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) pixels.push(output(x, y));
  return pixels;
}
const differs = (a: Pixel[], b: Pixel[]) => a.filter((pixel, index) => pixel.some((value, channel) => Math.abs(value - b[index][channel]) > 1e-3)).length;

describe('Block Dissolve recipe', () => {
  it('is a graph-owned image effect whose default graph compiles', () => {
    expect(isImageGraphEffectType('block-dissolve')).toBe(true);
    const graph = effectOperatorGraph({ id: 'fx', name: 'Block Dissolve', type: 'block-dissolve', enabled: true, params: getDefaultParams('block-dissolve') });
    expect(graph.nodes.some(node => node.operator === 'image.output')).toBe(true);
  });

  it('leaves every pixel unchanged at Amount 0', () => {
    const output = render({ amount: 0, holes: 1, dither: 1 }, disc, .7);
    for (let y = 0; y < size[1]; y += 3) for (let x = 0; x < size[0]; x += 3) {
      const expected = disc(x, y);
      output(x, y).forEach((value, channel) => expect(Math.abs(value - expected[channel])).toBeLessThan(2e-3));
    }
  });

  it('keeps the inside of the object and paints everything outside it Paper', () => {
    const output = render({ ...plain, colorB: '#ff0000' }, disc);
    // The disc centre is inside a block that lies wholly in the object; a corner lies outside it.
    output(48, 32).forEach((value, channel) => expect(Math.abs(value - disc(48, 32)[channel])).toBeLessThan(2e-3));
    const corner = output(1, 1);
    expect(corner[0]).toBeCloseTo(1, 2); expect(corner[1]).toBeCloseTo(0, 2); expect(corner[3]).toBeCloseTo(1, 2);
  });

  it('turns removed pixels transparent with Removed: Transparent, and reads the object from alpha', () => {
    const output = render({ ...plain, mask: 'alpha', threshold: .5, fill: 'transparent' }, cutOut);
    expect(output(1, 1)[3]).toBeCloseTo(0, 3);
    expect(output(48, 32)[3]).toBeCloseTo(1, 3);
  });

  it('dithers dark blocks into Ink and white into Paper', () => {
    const output = render({ ...plain, dither: 1, edgeDither: 1, pattern: 'bayer', dotColor: 'ink', colorA: '#00ff00' }, disc);
    // Dark disc: mostly Ink dots; white background stays Paper (white).
    let ink = 0;
    for (let y = 26; y < 38; y++) for (let x = 42; x < 54; x++) if (output(x, y)[1] > .9 && output(x, y)[0] < .1) ink++;
    expect(ink).toBeGreaterThan(100);
    expect(output(1, 1).slice(0, 3).every(value => value > .99)).toBe(true);
  });

  it('keeps each dot in its own colour with Dot Colour: Original', () => {
    const output = render({ ...plain, dither: 1, edgeDither: 1, pattern: 'bayer' }, disc);
    // Dots of the disc carry the disc colour (blue-ish), the rest is Paper.
    let own = 0;
    for (let y = 26; y < 38; y++) for (let x = 42; x < 54; x++) { const [r, g, b] = output(x, y); if (b > .25 && b < .35 && r < .2) own++; }
    expect(own).toBeGreaterThan(100);
  });

  it('finds an object as bright as its gradient backdrop with Object: Differs from edge', () => {
    // A pale green disc on a light grey gradient: brightness cannot tell them apart.
    const backdrop = (x: number, y: number): Pixel => Math.hypot(x - 48, y - 32) < 22 ? [.75, .9, .5, 1] : [.9 - y * .002, .9 - y * .002, .92 - y * .002, 1];
    const output = render({ ...plain, solid: 1, mask: 'edge', threshold: .08 }, backdrop);
    expect(output(48, 32).slice(0, 3)).toEqual([0, 0, 0]);
    expect(output(4, 60).slice(0, 3).every(value => Math.abs(value - 1) < 1e-3)).toBe(true);
  });

  it('paints dots in Mark Colour with Dot Colour: Mark Colour', () => {
    const output = render({ ...plain, dither: 1, pattern: 'checker', dotColor: 'mark', markColor: '#ff0000' }, disc);
    const inside: Pixel[] = [];
    for (let y = 24; y < 40; y++) for (let x = 40; x < 56; x++) inside.push(output(x, y));
    expect(inside.some(pixel => pixel[0] > .99 && pixel[1] < .01 && pixel[2] < .01)).toBe(true);
  });

  it('fills inside blocks flat with Ink by Solid', () => {
    const output = render({ ...plain, solid: 1, colorA: '#00ff00' }, disc);
    expect(output(48, 32)[1]).toBeCloseTo(1, 2);
    expect(output(48, 32)[0]).toBeCloseTo(0, 2);
  });

  it('never glitches the background: far from the object it stays Paper even with every block displaced and dithered', () => {
    for (const time of [.05, .4, 1.3]) {
      const output = render({ ...plain, displace: 1, dither: 1, edgeDither: 1, holes: .5 }, disc, time);
      for (const [x, y] of [[2, 2], [93, 60], [5, 40], [90, 5]]) expect(output(x, y).slice(0, 3).every(value => value > .99)).toBe(true);
    }
  });

  it('dithers every other dot with Pattern: Checker, whatever the brightness', () => {
    const output = render({ ...plain, dither: 1, edgeDither: 1, ditherSize: 16 }, disc);
    let shown = 0, total = 0;
    for (let y = 26; y < 38; y++) for (let x = 42; x < 54; x++) { total++; if (output(x, y)[0] < .5) shown++; }
    expect(shown / total).toBeGreaterThan(.3); expect(shown / total).toBeLessThan(.7);
  });

  it('dithers edge blocks only in a band along the real outline, in the colour of the object beside it', () => {
    // Large blocks so the disc outline crosses whole edge blocks; a wide band, checker in its own colour.
    const output = render({ ...plain, scale: 600, edgeDither: 1, edgeWidth: 120, ditherSize: 20 }, disc);
    const plainOut = render({ ...plain, scale: 600 }, disc);
    let banded = 0;
    // Just outside the disc (radius 22) the band shows dots in the disc colour on Paper.
    for (let a = 0; a < 360; a += 15) {
      const x = Math.round(48 + 25 * Math.cos(a * Math.PI / 180)), y = Math.round(32 + 25 * Math.sin(a * Math.PI / 180));
      const [r, , b] = output(x, y);
      if (b > .25 && b < .35 && r < .2) banded++;
      expect(plainOut(x, y).slice(0, 3).every(value => value > .99)).toBe(true);
    }
    expect(banded).toBeGreaterThan(2);
  });

  it('keeps the outline smooth outside the stretches Edge Amount picks', () => {
    // With no glitching stretch every block keeps the picture: the disc on white comes out unchanged.
    const source = frame(disc);
    expect(differs(frame(render({ ...plain, edgeDither: 1, edgeAmount: 0, displace: 1, flickerRate: 15 }, disc, .4)), source)).toBe(0);
    expect(differs(frame(render({ ...plain, edgeDither: 1, edgeAmount: 1 }, disc, .4)), source)).toBeGreaterThan(20);
  });

  it('draws Paper Marks on the removed area only, in Mark Colour', () => {
    const output = render({ ...plain, paperMarks: 'crosses', markGrid: 400, markSize: 24, markColor: '#ff0000', colorB: '#000000' }, disc);
    // Grid points sit on the frame centre (on the disc: no mark) and every 400 px: none other in this frame.
    // Inside blocks keep the disc; edge blocks (from about 11 px out) may be removed and carry marks.
    const centre = output(48, 32);
    expect(centre[0]).toBeLessThan(.2);
    const marked = render({ ...plain, paperMarks: 'dots', markGrid: 20, markSize: 6, markColor: '#ff0000', colorB: '#000000' }, disc);
    let red = 0, redOnDisc = 0;
    for (let y = 0; y < 64; y++) for (let x = 0; x < 96; x++) {
      const [r, gr] = marked(x, y);
      if (r > .9 && gr < .1) { red++; if (Math.hypot(x - 48, y - 32) < 11) redOnDisc++; }
    }
    expect(red).toBeGreaterThan(20);
    expect(redOnDisc).toBe(0);
  });

  it('turns the checker by 45° with Pattern: Diagonal', () => {
    const square = render({ ...plain, dither: 1, edgeDither: 1, ditherSize: 16 }, disc), diagonal = render({ ...plain, dither: 1, edgeDither: 1, ditherSize: 16, pattern: 'diagonal' }, disc);
    let changed = 0;
    for (let y = 26; y < 38; y++) for (let x = 42; x < 54; x++) if (Math.abs(square(x, y)[0] - diagonal(x, y)[0]) > .1) changed++;
    expect(changed).toBeGreaterThan(20);
  });

  it('bites holes in from the outline with Placement: Edges, and anywhere with Anywhere', () => {
    // A frame-filling object: every hole lies wholly on it, so Edges places none.
    const full = (): [number, number, number, number] => [.1, .1, .1, 1];
    const kept = frame(render(plain, full)), edges = frame(render({ ...plain, holes: 1, holeSize: 2 }, full));
    expect(differs(kept, edges)).toBe(0);
    const anywhere = frame(render({ ...plain, holes: 1, holeSize: 2, holePlacement: 'anywhere' }, full));
    expect(differs(kept, anywhere)).toBeGreaterThan(50);
  });

  it('removes whole areas with Holes', () => {
    const kept = frame(render(plain, disc)), holed = frame(render({ ...plain, holes: 1, holeSize: 2 }, disc));
    expect(differs(kept, holed)).toBeGreaterThan(50);
  });

  it('changes over time, block by block at their own moments; rates 0 freeze it', () => {
    const params = { holes: .5, dither: .4, displace: .3, scale: 60, flickerRate: 15 };
    const at = (time: number, overrides: Params = {}) => frame(render({ ...params, ...overrides }, disc, time));
    // Every block has its own tempo and phase: a short step changes some blocks, a long one more.
    const short = differs(at(.3), at(.36)), long = differs(at(.3), at(2.3));
    expect(short).toBeGreaterThan(0);
    expect(long).toBeGreaterThan(short);
    expect(differs(at(.01, { structureRate: 0, flickerRate: 0 }), at(7.3, { structureRate: 0, flickerRate: 0 }))).toBe(0);
  });

  it('keeps the inside calm: with Structure Rate 0 only edge blocks change', () => {
    const output = (time: number) => render({ holes: 0, dither: .5, edgeDither: .5, displace: .3, scale: 60, structureRate: 0 }, disc, time);
    const a = output(.2), b = output(1.7);
    // The disc centre lies in an inside block: it never changes.
    expect(a(48, 32)).toEqual(b(48, 32));
  });

  it('changes with Seed', () => {
    const params = { holes: .5, dither: .4, displace: .3, scale: 60 };
    expect(differs(frame(render(params, disc, .3)), frame(render({ ...params, seed: 7 }, disc, .3)))).toBeGreaterThan(0);
  });

  it('reports values outside the rendered range', () => {
    const definition = getEffect('block-dissolve')!;
    const notes = 'paramWarnings' in definition ? definition.paramWarnings?.({ ...getDefaultParams('block-dissolve'), holes: 3, flickerRate: -2 }) ?? [] : [];
    expect(notes.join(' ')).toContain('Holes 3 is outside');
    expect(notes.join(' ')).toContain('Flicker Rate -2 is below 0');
  });
});
