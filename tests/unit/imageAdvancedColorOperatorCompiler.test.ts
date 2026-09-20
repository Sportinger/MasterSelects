import { describe, expect, it } from 'vitest';
import { compileImageOperatorGraph, compileImageOperatorPreview, createDefaultInvertImageGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

const node = (id: string, operator: string, value?: number) => ({ id, operator, operatorVersion: 1 as const, bindings: {}, ...(value === undefined ? {} : { constants: { value } }) });
const edge = (id: string, from: string, output: string, to: string, input: string) => ({ id, from, output, to, input });

function hueGraph(shift: number): EffectOperatorGraph {
  const nodes = [node('frame', 'image.frame'), node('rgba', 'vector.split.rgba'), node('hsv', 'convert.rgb-to-hsv'), node('split', 'vector.split.vec3'),
    node('shift', 'values.number', shift), node('add', 'math.add.scalar'), node('wrap', 'math.fract.scalar'), node('combine-hsv', 'vector.combine.vec3'),
    node('rgb', 'convert.hsv-to-rgb'), node('combine', 'vector.combine.rgba'), node('output', 'image.output')];
  const edges = [edge('a', 'frame', 'image', 'rgba', 'image'), edge('b', 'rgba', 'rgb', 'hsv', 'rgb'), edge('c', 'hsv', 'value', 'split', 'value'),
    edge('d', 'split', 'x', 'add', 'a'), edge('e', 'shift', 'value', 'add', 'b'), edge('f', 'add', 'value', 'wrap', 'value'),
    edge('g', 'wrap', 'value', 'combine-hsv', 'x'), edge('h', 'split', 'y', 'combine-hsv', 'y'), edge('i', 'split', 'z', 'combine-hsv', 'z'),
    edge('j', 'combine-hsv', 'value', 'rgb', 'value'), edge('k', 'rgb', 'rgb', 'combine', 'rgb'), edge('l', 'rgba', 'alpha', 'combine', 'alpha'),
    edge('m', 'combine', 'image', 'output', 'image')];
  return { version: 1, schemaVersion: 1, domain: 'image', nodes, edges, layout: Object.fromEntries(nodes.map((item, index) => [item.id, { x: index, y: 0 }])) };
}

describe('advanced reusable image color operators', () => {
  it('matches the legacy stabilized HSV conversion, hue wrapping, and alpha preservation', () => {
    const plan = compileImageOperatorGraph(hueGraph(0.5));
    const result = evaluateImageOperatorPlan(plan, [1, 0, 0, 0.25]);
    expect(result[0]).toBeCloseTo(0, 8);
    expect(result[1]).toBeCloseTo(1, 8);
    expect(result[2]).toBeCloseTo(1, 8);
    expect(result[3]).toBe(0.25);
    expect(plan.wgsl).toContain('1.0e-10');
    expect(plan.wgsl).toContain('fract(');
  });

  it('keeps legacy Levels division unguarded instead of inserting an epsilon', () => {
    const graph = createDefaultInvertImageGraph();
    graph.nodes.push(node('numerator', 'values.number', 1), node('zero-denominator', 'values.number', 0), node('raw-divide', 'math.divide-ieee.scalar'));
    graph.edges.push(edge('raw-a', 'numerator', 'value', 'raw-divide', 'a'), edge('raw-b', 'zero-denominator', 'value', 'raw-divide', 'b'));
    graph.layout.numerator = { x: 0, y: 0 }; graph.layout['zero-denominator'] = { x: 0, y: 0 }; graph.layout['raw-divide'] = { x: 0, y: 0 };
    const plan = compileImageOperatorPreview(graph, {}, { nodeId: 'raw-divide', direction: 'output', portId: 'value' });
    expect(evaluateImageOperatorPlan(plan, [0, 0, 0, 1])[0]).toBe(Number.POSITIVE_INFINITY);
    expect(plan.wgsl).toMatch(/v\d+ \/ v\d+/);
    expect(plan.wgsl).not.toContain('0.001');
  });

  it('lowers component reducers plus exp2 and reciprocal scalar math', () => {
    const graph = hueGraph(0);
    const extra = [node('min', 'vector.reduce-min.rgb'), node('max', 'vector.reduce-max.rgb'), node('exposure', 'values.number', 2),
      node('exp2', 'math.exp2.scalar'), node('reciprocal', 'math.reciprocal.scalar')];
    graph.nodes.push(...extra); extra.forEach((item, index) => { graph.layout[item.id] = { x: index, y: 10 }; });
    graph.edges.push(edge('min-rgb', 'rgba', 'rgb', 'min', 'rgb'), edge('max-rgb', 'rgba', 'rgb', 'max', 'rgb'),
      edge('exposure-exp2', 'exposure', 'value', 'exp2', 'value'), edge('exposure-reciprocal', 'exp2', 'value', 'reciprocal', 'value'));
    const min = compileImageOperatorPreview(graph, {}, { nodeId: 'min', direction: 'output', portId: 'value' });
    const max = compileImageOperatorPreview(graph, {}, { nodeId: 'max', direction: 'output', portId: 'value' });
    const reciprocal = compileImageOperatorPreview(graph, {}, { nodeId: 'reciprocal', direction: 'output', portId: 'value' });
    expect(evaluateImageOperatorPlan(min, [0.4, 0.1, 0.8, 1])[0]).toBe(0.1);
    expect(evaluateImageOperatorPlan(max, [0.4, 0.1, 0.8, 1])[0]).toBe(0.8);
    expect(evaluateImageOperatorPlan(reciprocal, [0, 0, 0, 1])[0]).toBe(0.25);
  });
});
