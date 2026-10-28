import { describe, expect, it } from 'vitest';
import { compileImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';
import { createDefaultFlowMoshGraph } from '../../src/services/operators/flowMoshRecipe';
import { effectOperatorGraph, isImageGraphEffectType } from '../../src/services/operators/effectGraphOwner';
import { getDefaultParams, getEffect } from '../../src/effects';
import { isMixedOut } from '../../src/engine/render/layerEffectStack';
import { createImagePassEvaluator, discreteImage, type Pixel } from '../helpers/imageGraphPasses';

type Params = Record<string, number | string | boolean>;
const size: [number, number] = [48, 32];
/** Distinct colour per pixel, so a copied pixel can be traced back to where it came from. */
const coded = (x: number, y: number): Pixel => [x / 47, y / 31, ((x * 5 + y * 3) % 7) / 7, 1];
const source = (pixel: number[]) => [Math.round(pixel[0] * 47), Math.round(pixel[1] * 31)];
/** No glitch extras: only the traced flow. */
const plain: Params = { particles: 0, trails: 0, jumps: 0, slices: 0, turbulence: 0 };

function render(overrides: Params, image: (x: number, y: number) => Pixel = coded) {
  const params = { ...getDefaultParams('flow-mosh'), ...overrides };
  const plan = compileImageOperatorGraph(createDefaultFlowMoshGraph(), params, { parameterSchema: getEffect('flow-mosh')!.params });
  const evaluate = createImagePassEvaluator(plan, size, discreteImage(size[0], size[1], image), { filterResources: true, float16: true });
  return (x: number, y: number) => evaluate([(x + .5) / size[0], (y + .5) / size[1]]);
}

describe('Flow Mosh recipe', () => {
  it('is a graph-owned image effect whose flow field is cached at a quarter of the frame', () => {
    expect(isImageGraphEffectType('flow-mosh')).toBe(true);
    const graph = effectOperatorGraph({ id: 'fx', name: 'Flow Mosh', type: 'flow-mosh', enabled: true, params: getDefaultParams('flow-mosh') });
    const scales = Object.fromEntries(graph.nodes.filter(node => node.operator === 'image.materialize').map(node => [node.id, node.constants?.scale]));
    expect(scales).toEqual({ 'down-cache': '0.25', 'blur-x-cache': '0.25', 'blur-cache': '0.25', 'flow-field': '0.25', 'mosh-cache': undefined });
    // Sort Rows 0 folds its Switch: no Segment Sort pass is built.
    const plan = compileImageOperatorGraph(graph, getDefaultParams('flow-mosh'), { parameterSchema: getEffect('flow-mosh')!.params });
    expect(plan.passes!.some(pass => pass.segmentSort)).toBe(false);
    const sorting = compileImageOperatorGraph(graph, { ...getDefaultParams('flow-mosh'), sortRows: .5 }, { parameterSchema: getEffect('flow-mosh')!.params });
    expect(sorting.passes!.filter(pass => pass.segmentSort).map(pass => pass.segmentSort!.settings.axis)).toEqual(['rows']);
  });

  it('returns the input exactly at Progress 0 and is skipped there', () => {
    const output = render({ progress: 0, jumps: 1, slices: 1, particles: 1 });
    for (let y = 0; y < size[1]; y += 3) for (let x = 0; x < size[0]; x += 3) {
      const expected = coded(x, y);
      output(x, y).forEach((value, channel) => expect(value).toBeCloseTo(expected[channel], 3));
    }
    expect(isMixedOut({ type: 'flow-mosh', params: { progress: 0, amount: 1 } })).toBe(true);
  });

  it('moves whole cells against the drift on a flat picture', () => {
    // A flat stream value (constant red – green): the flow is the drift alone, here to the right (0°).
    const flat = (x: number, y: number): Pixel => [.5, .5, ((x * 7 + y * 11) % 13) / 13, 1];
    const blueAt = (x: number, y: number) => flat(x, y)[2];
    // Cell Size 216 at a 32-pixel-tall frame is 6.4 pixels; Distance 200 is about 5.9 pixels: one cell.
    const output = render({ ...plain, flowFrom: 'red-green', driftAngle: 0, cellSize: 216, distance: 200, progress: 1 }, flat);
    // Pixel 20 in cell 3 (19.2..25.6) copies the same place one cell to the left (back along the drift).
    expect(output(22, 10)[2]).toBeCloseTo(blueAt(22 - 6, 10), 2);
    // Pixels of one cell copy one cell: their offsets are equal.
    expect(output(20, 10)[2]).toBeCloseTo(blueAt(20 - 6, 10), 2);
  });

  it('copies pixels of the picture only (no new colours) and keeps alpha with Shape Keep', () => {
    const output = render({ progress: 1 });
    for (const [x, y] of [[5, 5], [30, 20], [44, 3], [12, 28]]) {
      const pixel = output(x, y), [sx, sy] = source(pixel);
      const original = coded(sx, sy);
      pixel.forEach((value, channel) => expect(value).toBeCloseTo(original[channel], 2));
    }
    const cut = (x: number, y: number): Pixel => x < 24 ? [0, 0, 0, 0] : coded(x, y);
    const kept = render({ progress: 1, driftAngle: 180 }, cut);
    expect(kept(4, 4)[3]).toBe(0);
    expect(kept(40, 4)[3]).toBe(1);
  });

  it('sorts rows in short runs with Sort Rows 1, keeping each row a permutation', () => {
    const output = render({ ...plain, progress: 1, distance: 0, sortRows: 1 });
    const luma = (pixel: number[]) => .2126 * pixel[0] + .7152 * pixel[1] + .0722 * pixel[2];
    // Distance 0: the mosh is the input; every row sorts in runs of 35 px at 1080p, at least 2 pixels: here pairs.
    const row = Array.from({ length: size[0] }, (_, x) => output(x, 9));
    const keys = row.map(luma);
    // Each row starts its runs at its own seeded offset (0 or 1 here): one of the two pairings is sorted.
    const sortedFrom = (start: number) => { for (let x = start; x + 1 < size[0]; x += 2) if (keys[x] > keys[x + 1] + 4e-3) return false; return true; };
    expect(sortedFrom(0) || sortedFrom(1)).toBe(true);
    expect(row.some((pixel, x) => source(pixel)[0] !== x)).toBe(true);
    const sources = new Set(row.map(pixel => source(pixel).join(',')));
    expect(sources.size).toBe(size[0]);
  });

  it('turns the flow round two vortices', () => {
    const flat = (x: number, y: number): Pixel => [.5, .5, ((x * 7 + y * 11) % 13) / 13, 1];
    const still = render({ ...plain, flowFrom: 'red-green', drift: 0, vortices: 0, progress: 1 }, flat);
    const whirl = render({ ...plain, flowFrom: 'red-green', drift: 0, vortices: 2, progress: 1 }, flat);
    let moved = 0;
    for (let y = 4; y < 28; y += 4) for (let x = 4; x < 44; x += 4) if (Math.abs(whirl(x, y)[2] - still(x, y)[2]) > 1e-3) moved++;
    expect(moved).toBeGreaterThan(10);
  });

  it('reports values outside the rendered range', () => {
    const warnings = getEffect('flow-mosh')!.paramWarnings!({ ...getDefaultParams('flow-mosh'), distance: 5000, particleSpeed: 12 }).join(' ');
    expect(warnings).toMatch(/Distance 5000/); expect(warnings).toMatch(/Particle Speed 12/);
  });
});
