import { describe, expect, it } from 'vitest';
import { getDefaultParams, getEffect } from '../../src/effects';
import { compileImageOperatorGraph, evaluateImageOperatorPlan, type ImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { createDefaultHalftoneGraph } from '../../src/services/operators/halftoneEffectGraphs';
import { createRisoPrintGraph } from '../../src/services/operators/risoPrintEffectGraph';
import { createDefaultDitheringGraph } from '../../src/services/operators/ditheringEffectGraph';
import { CELL_FILTER_MAX_TAPS } from '../../src/services/operators/patternCellFilter';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

type Rgba = [number, number, number, number];
const resolution: [number, number] = [1920, 1080];

/** Evaluates a multi-pass plan at one pixel; cached passes are evaluated where they are read (point reads). */
function renderPixel(graph: EffectOperatorGraph, type: string, params: Record<string, unknown>, picture: (uv: [number, number]) => Rgba, pixel: [number, number]) {
  const plan = compileImageOperatorGraph(graph, { ...getDefaultParams(type), ...params } as never, { parameterSchema: getEffect(type)!.params });
  const producers = new Map((plan.passes ?? []).filter(pass => pass.outputResource).map(pass => [pass.outputResource!, pass.program]));
  const at = (program: ImageOperatorPlan, uv: [number, number]): Rgba => evaluateImageOperatorPlan(program, picture(uv), { uv, resolution,
    timelineTimeSeconds: 0, sampleImage: picture, sampleResource: (id, point) => at(producers.get(id)!, point) }) as Rgba;
  const final = plan.passes?.length ? plan.passes.at(-1)!.program : plan;
  return at(final, [(pixel[0] + .5) / resolution[0], (pixel[1] + .5) / resolution[1]]);
}
const luma = (c: readonly number[]) => c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
/** White left of `edge` (pixels), black right of it. */
const edgePicture = (edge: number) => ([u]: [number, number]): Rgba => u * resolution[0] < edge ? [1, 1, 1, 1] : [0, 0, 0, 1];

/** Mean ink of one 8 × 8 cell (pixels 800..807, 400..407) while a hard edge crosses it in 1-pixel steps. */
function inkWhileEdgeMoves(graph: EffectOperatorGraph, type: string, params: Record<string, unknown>): number[] {
  const inks: number[] = [];
  for (let edge = 799; edge <= 809; edge += 1) {
    let ink = 0;
    for (let y = 400; y < 408; y += 1) for (let x = 800; x < 808; x += 1) ink += 1 - luma(renderPixel(graph, type, params, edgePicture(edge), [x, y]));
    inks.push(ink / 64);
  }
  return inks;
}

describe('Cell Filter of the pattern looks', () => {
  it('a Halftone dot follows an edge moving across its cell in small even steps instead of jumping', () => {
    const inks = inkWhileEdgeMoves(createDefaultHalftoneGraph('halftone'), 'halftone', { scale: 8, angle: 0, amount: 1, colorA: '#000000', colorB: '#ffffff' });
    const steps = inks.slice(1).map((value, index) => value - inks[index]);
    // The true cell average changes by 1/8 per pixel step; four point reads would jump by 1/4 and stand still between.
    expect(Math.max(...steps.map(Math.abs))).toBeLessThan(.19);
    expect(steps.filter(step => step < -.03).length).toBeGreaterThanOrEqual(6);
    // The edge moves right, so the cell turns from black (solid ink) to white (no ink).
    expect(inks[0]).toBeGreaterThan(.98);
    expect(inks.at(-1)!).toBeLessThan(.02);
  });

  it('a Dithering cell shows the average light of its whole cell while an edge crosses it', () => {
    const inks = inkWhileEdgeMoves(createDefaultDitheringGraph(), 'dither', { scale: 8, levels: 16, amount: 1 });
    const toSrgb = (c: number) => c <= .0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - .055;
    inks.forEach((ink, step) => {
      // Edge at 799 + step: the share of white pixels in the cell, averaged in linear light, shown in sRGB.
      const white = Math.min(Math.max((799 + step - 800) / 8, 0), 1);
      expect(Math.abs((1 - ink) - toSrgb(white)), `step ${step}`).toBeLessThanOrEqual(1 / 15 + .01);
    });
  });

  it('Riso, Halftone and Dithering read their cells through the filter; the reads per pass are bounded', () => {
    for (const graph of [createDefaultHalftoneGraph('halftone'), createRisoPrintGraph(), createDefaultDitheringGraph()]) {
      const taps = graph.nodes.filter(node => /(^|-)tap-\d+-sample$/.test(node.id));
      expect(taps.length).toBeGreaterThanOrEqual(4);
      for (const tap of taps) expect(graph.edges.find(edge => edge.to === tap.id && edge.input === 'image')?.from).toBe('cell-filter');
      expect(graph.nodes.find(node => node.id === 'cell-filter-max-taps')?.constants?.value).toBe(CELL_FILTER_MAX_TAPS);
    }
    // Pattern Halftone keeps its per-pixel tone: it has no cell reads.
    expect(createDefaultHalftoneGraph('pattern-halftone').nodes.some(node => node.id === 'cell-filter')).toBe(false);
  });
});
