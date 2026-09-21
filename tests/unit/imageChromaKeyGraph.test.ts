import { describe, expect, it } from 'vitest';
import { chromaKey } from '../../src/effects/keying/chroma-key';
import { createDefaultChromaKeyGraph } from '../../src/services/operators/chromaKeyEffectGraph';
import { validateEffectGraph } from '../../src/services/operators/effectGraph';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';

type Rgba = [number, number, number, number];

const reference = (color: Rgba, keyColor: string, tolerance: number, softness: number, suppression: number): Rgba => {
  const key = keyColor === 'blue' ? [0, 0, 1] : [0, 1, 0];
  const ycbcr = ([r, g, b]: number[]) => { const y = .299 * r + .587 * g + .114 * b; return [.564 * (b - y), .713 * (r - y)]; };
  const sourceChroma = ycbcr(color), keyChroma = ycbcr(key);
  const distance = Math.hypot(sourceChroma[0] - keyChroma[0], sourceChroma[1] - keyChroma[1]);
  const t = Math.min(1, Math.max(0, (distance - tolerance) / (tolerance + softness - tolerance)));
  const matte = t * t * (3 - 2 * t), out = color.slice(0, 3);
  if (suppression > 0 && key[1] > key[0] && key[1] > key[2]) {
    const spill = Math.max(0, out[1] - Math.max(out[0], out[2])) * suppression;
    out[1] -= spill; out[0] += spill * .5; out[2] += spill * .5;
  } else if (suppression > 0 && key[2] > key[0] && key[2] > key[1]) {
    const spill = Math.max(0, out[2] - Math.max(out[0], out[1])) * suppression;
    out[2] -= spill; out[0] += spill * .5; out[1] += spill * .5;
  }
  return [out[0], out[1], out[2], color[3] * matte];
};

describe('Chroma Key image graph', () => {
  it('is a granular contextual graph with authoritative bindings', () => {
    const graph = createDefaultChromaKeyGraph();
    expect(validateEffectGraph(graph)).toEqual([]);
    expect(graph.nodes.find(node => node.id === 'key-color')?.bindings).toEqual({ value: 'keyColor' });
    expect(graph.nodes.find(node => node.id === 'tolerance')?.bindings).toEqual({ value: 'tolerance' });
    expect(graph.nodes.find(node => node.id === 'softness')?.bindings).toEqual({ value: 'softness' });
    expect(graph.nodes.find(node => node.id === 'spill-suppression')?.bindings).toEqual({ value: 'spillSuppression' });
    expect(graph.nodes.some(node => node.operator.includes('chroma-key'))).toBe(false);
    expect(graph.nodes.some(node => node.operator === 'image.sample')).toBe(false);
  });

  it.each(['green', 'blue', 'custom'])('matches %s keying, spill, and straight-alpha semantics', keyColor => {
    const graph = createDefaultChromaKeyGraph(), params = { keyColor, tolerance: .18, softness: .13, spillSuppression: .7 };
    const plan = compileImageOperatorGraph(graph, params, { parameterSchema: chromaKey.params });
    for (const color of [[.12, .83, .19, .6], [.14, .22, .91, .35], [.7, .25, .1, 0]] as Rgba[]) {
      const actual = evaluateImageOperatorPlan(plan, color);
      const expected = reference(color, keyColor, params.tolerance, params.softness, params.spillSuppression);
      actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 14));
    }
  });

  it('preserves the legacy custom-to-green fallback and suppression-zero boundary', () => {
    const graph = createDefaultChromaKeyGraph(), color: Rgba = [.1, .9, .2, .75];
    const compile = (keyColor: string, spillSuppression: number) => compileImageOperatorGraph(graph,
      { keyColor, tolerance: .2, softness: .1, spillSuppression }, { parameterSchema: chromaKey.params });
    expect(evaluateImageOperatorPlan(compile('custom', .5), color)).toEqual(evaluateImageOperatorPlan(compile('green', .5), color));
    const noSpill = evaluateImageOperatorPlan(compile('green', 0), color);
    expect(noSpill.slice(0, 3)).toEqual(color.slice(0, 3));
    expect(noSpill[3]).toBeLessThan(color[3]);
  });
});
