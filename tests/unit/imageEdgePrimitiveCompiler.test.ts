import { describe, expect, it } from 'vitest';
import type { BoundOperatorNode, EffectOperatorGraph } from '../../src/types/operatorGraph';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';

const node = (id: string, operator: string, value?: number): BoundOperatorNode => ({ id, operator, operatorVersion: 1, bindings: {},
  ...(value === undefined ? {} : { constants: { value } }) });
const edge = (from: string, output: string, to: string, input: string) => ({ id: `${from}-${to}-${input}`, from, output, to, input });
const primitiveGraph = (): EffectOperatorGraph => ({ version: 1, schemaVersion: 1, domain: 'image', layout: {},
  nodes: [node('frame', 'image.frame'), node('luma', 'color.luminance-rec709.image'), node('sqrt', 'math.sqrt.scalar'),
    node('minimum', 'values.number', .8), node('maximum', 'values.number', .2), node('clamp', 'math.clamp.scalar'),
    node('rgba', 'convert.scalar-to-vec4'), node('image', 'convert.vec4-to-image'), node('output', 'image.output')],
  edges: [edge('frame', 'image', 'luma', 'image'), edge('luma', 'value', 'sqrt', 'value'), edge('sqrt', 'value', 'clamp', 'value'),
    edge('minimum', 'value', 'clamp', 'min'), edge('maximum', 'value', 'clamp', 'max'), edge('clamp', 'value', 'rgba', 'value'),
    edge('rgba', 'value', 'image', 'value'), edge('image', 'image', 'output', 'image')] });

describe('edge-detect image primitives', () => {
  it('reads Rec.709 from the current image value, ignores alpha and normalizes clamp bounds', () => {
    const plan = compileImageOperatorGraph(primitiveGraph());
    const luma = .2126 * .25 + .7152 * .5 + .0722 * .75;
    const result = evaluateImageOperatorPlan(plan, [.25, .5, .75, .01]);
    result.forEach(value => expect(value).toBeCloseTo(Math.sqrt(luma), 12));
    expect(plan.instructions.filter(item => item.operation === 'input')).toHaveLength(1);
    expect(plan.instructions.some(item => item.operation === 'sample-image')).toBe(false);
    expect(plan.wgsl).toMatch(/dot\(v\d+\.rgb, vec3f\(0\.2126, 0\.7152, 0\.0722\)\)/);
    expect(plan.wgsl).toContain('clamp(');
    expect(plan.wgsl).toContain('sqrt(');
  });

  it('keeps ordinary square-root domain behavior without a hidden clamp', () => {
    const graph = primitiveGraph();
    graph.nodes.find(item => item.id === 'minimum')!.constants = { value: -2 };
    graph.nodes.find(item => item.id === 'maximum')!.constants = { value: 2 };
    const result = evaluateImageOperatorPlan(compileImageOperatorGraph(graph), [-1, -1, -1, 1]);
    expect(result.every(Number.isNaN)).toBe(true);
  });
});
