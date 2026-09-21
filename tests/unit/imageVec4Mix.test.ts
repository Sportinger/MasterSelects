import { describe, expect, it } from 'vitest';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';
import { compileImageOperatorPreview, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';

const edge = (from: string, output: string, to: string, input: string) => ({ id: `${from}-${to}-${input}`, from, output, to, input });
function graph(bypassed = false): EffectOperatorGraph {
  const values = [['a-x', 0], ['a-y', .2], ['a-z', .4], ['a-w', .6], ['b-x', 1], ['b-y', .8], ['b-z', .6], ['b-w', .4], ['t', 1.5]] as const;
  return { version: 1, schemaVersion: 1, domain: 'image', layout: {}, nodes: [
    { id: 'frame', operator: 'image.frame', operatorVersion: 1, bindings: {} },
    { id: 'output', operator: 'image.output', operatorVersion: 1, bindings: {} },
    ...values.map(([id, value]) => ({ id, operator: 'values.number', operatorVersion: 1 as const, bindings: {}, constants: { value } })),
    { id: 'a', operator: 'vector.combine.vec4', operatorVersion: 1, bindings: {} },
    { id: 'b', operator: 'vector.combine.vec4', operatorVersion: 1, bindings: {} },
    { id: 'mix', operator: 'math.mix.vec4', operatorVersion: 1, bindings: {}, bypassed },
  ], edges: [edge('frame', 'image', 'output', 'image'),
    ...(['x', 'y', 'z', 'w'] as const).flatMap(component => [edge(`a-${component}`, 'value', 'a', component), edge(`b-${component}`, 'value', 'b', component)]),
    edge('a', 'value', 'mix', 'a'), edge('b', 'value', 'mix', 'b'), edge('t', 'value', 'mix', 't')] };
}

const evaluate = (bypassed = false) => {
  const plan = compileImageOperatorPreview(graph(bypassed), {}, { nodeId: 'mix', direction: 'output', portId: 'value' });
  return { plan, value: evaluateImageOperatorPlan(plan, [0, 0, 0, 0]) };
};

describe('vec4 image mix', () => {
  it('mixes all four components including alpha without clamping extrapolation', () => {
    const { plan, value } = evaluate();
    [1.5, 1.1, .7, .3].forEach((expected, index) => expect(value[index]).toBeCloseTo(expected, 12));
    expect(plan.wgsl).toContain('mix(');
  });

  it('passes B through when bypassed', () => {
    const { plan, value } = evaluate(true);
    expect(value).toEqual([1, .8, .6, .4]);
    expect(plan.instructions.some(instruction => instruction.operation === 'mix-rgb')).toBe(false);
  });
});
