import { describe, expect, it } from 'vitest';
import type { BoundOperatorNode, EffectOperatorGraph } from '../../src/types/operatorGraph';
import { compileImageOperatorPreview, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';

const node = (id: string, operator: string, value?: number): BoundOperatorNode => ({
  id, operator, operatorVersion: 1, bindings: {}, ...(value === undefined ? {} : { constants: { value } }),
});
const edge = (from: string, output: string, to: string, input: string) => ({ id: `${from}-${to}-${input}`, from, output, to, input });

function bayerGraph(x: number, y: number): EffectOperatorGraph {
  return {
    version: 1, schemaVersion: 1, domain: 'image', layout: {},
    nodes: [node('frame', 'image.frame'), node('output', 'image.output'), node('x', 'values.number', x),
      node('y', 'values.number', y), node('pixel', 'vector.combine.vec2'), node('bayer', 'pattern.bayer4.vec2')],
    edges: [edge('frame', 'image', 'output', 'image'), edge('x', 'value', 'pixel', 'x'), edge('y', 'value', 'pixel', 'y'),
      edge('pixel', 'value', 'bayer', 'value')],
  };
}

const TABLE = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const evaluate = (x: number, y: number) => {
  const plan = compileImageOperatorPreview(bayerGraph(x, y), {}, { nodeId: 'bayer', direction: 'output', portId: 'value' });
  return { plan, value: evaluateImageOperatorPlan(plan, [0, 0, 0, 1])[0] };
};

describe('Bayer 4x4 image pattern primitive', () => {
  it('matches every canonical matrix cell and emits the shared WGSL helper', () => {
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const result = evaluate(x + .9, y + .2);
      expect(result.value).toBe((TABLE[y * 4 + x] + .5) / 16);
      expect(result.plan.wgsl).toContain('fn imageGraphBayer4(');
    }
  });

  it('wraps positive cells and clamps negative coordinates before indexing', () => {
    expect(evaluate(5.8, 6.4).value).toBe((TABLE[2 * 4 + 1] + .5) / 16);
    expect(evaluate(-1, 2.9).value).toBe((TABLE[2 * 4] + .5) / 16);
    expect(evaluate(3.2, -20).value).toBe((TABLE[3] + .5) / 16);
    expect(evaluate(-2, -3).value).toBe((TABLE[0] + .5) / 16);
  });

  it('mirrors f32 rounding and the finite WGSL u32 saturation boundary', () => {
    expect(evaluate(16_777_219, 0).value).toBe((TABLE[0] + .5) / 16);
    expect(evaluate(1e30, 3).value).toBe((TABLE[12] + .5) / 16);
  });
});
