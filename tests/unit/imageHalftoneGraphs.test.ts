import { describe, expect, it } from 'vitest';
import { halftone, patternHalftone } from '../../src/effects/halftone';
import { createDefaultHalftoneGraph } from '../../src/services/operators/halftoneEffectGraphs';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';

const sample = ([u, v]: [number, number]): [number, number, number, number] => [u, v, .2 + u * .3, .25 + v * .5];
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function reference(type: 'halftone' | 'pattern-halftone', uv: [number, number], params: Record<string, number | string>) {
  const angle = Number(params.angle) * Math.PI / 180, x = uv[0] - .5, y = uv[1] - .5;
  const rotated: [number, number] = [x * Math.cos(angle) - y * Math.sin(angle) + .5, x * Math.sin(angle) + y * Math.cos(angle) + .5];
  const cell = rotated.map((value, axis) => value * [64, 37][axis] / Math.max(Number(params.scale), 2) % 1 - .5) as [number, number];
  const color = sample(uv), tone = color[0] * .2126 + color[1] * .7152 + color[2] * .0722;
  const radius = type === 'halftone' ? Math.sqrt(Math.max(0, 1 - tone)) * .68 : (1 - tone) * .72;
  const shape = params.shape, distance = type === 'halftone' || shape === 'circle' ? Math.hypot(...cell)
    : shape === 'diamond' ? Math.abs(cell[0]) + Math.abs(cell[1]) : Math.abs(cell[1]);
  const width = type === 'halftone' ? .06 : .04, mark = 1 - smooth(radius - width, radius + width, distance);
  const colorA = [17, 24, 39].map(value => value / 255), colorB = [248, 250, 252].map(value => value / 255), amount = Number(params.amount);
  return [0, 1, 2].map(index => color[index] * (1 - amount) + (colorB[index] * (1 - mark) + colorA[index] * mark) * amount).concat(color[3]);
}

describe('halftone image graph factories', () => {
  it.each([['halftone', halftone], ['pattern-halftone', patternHalftone]] as const)('binds %s to catalog-owned parameters', (type, definition) => {
    const graph = createDefaultHalftoneGraph(type);
    for (const [nodeId, parameterId] of [['scale', 'scale'], ['amount', 'amount'], ['angle', 'angle'], ['color-a', 'colorA'], ['color-b', 'colorB']] as const) {
      expect(graph.nodes.find(node => node.id === nodeId)?.bindings).toEqual({ value: parameterId });
    }
    expect(graph.nodes.find(node => node.id === 'shape')?.bindings).toEqual(type === 'pattern-halftone' ? { value: 'shape' } : undefined);
    expect(definition.params.scale.default).toBe(14);
  });

  it.each([['halftone', 'circle'], ['pattern-halftone', 'circle'], ['pattern-halftone', 'diamond'], ['pattern-halftone', 'line']] as const)
  ('matches the %s/%s reference operation order', (type, shape) => {
    const definition = type === 'halftone' ? halftone : patternHalftone;
    const params = { scale: 9.5, amount: .73, angle: 31, colorA: '#111827', colorB: '#f8fafc', shape };
    const plan = compileImageOperatorGraph(createDefaultHalftoneGraph(type), params, { parameterSchema: definition.params });
    const context = { uv: [.73, .41] as [number, number], resolution: [64, 37] as [number, number], sampleImage: sample };
    const actual = evaluateImageOperatorPlan(plan, [0, 0, 0, 0], context), expected = reference(type, context.uv, params);
    expected.forEach((value, index) => expect(actual[index]).toBeCloseTo(value, 10));
  });
});
