import { describe, expect, it } from 'vitest';
import { validateEffectGraph } from '../../src/services/operators/effectGraph';
import { compileImageOperatorPreview, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

const makeGraph = (condition = true): EffectOperatorGraph => ({
  version: 1, schemaVersion: 1, domain: 'image', layout: {}, nodes: [
    { id: 'frame', operator: 'image.frame', operatorVersion: 1, bindings: {} },
    { id: 'output', operator: 'image.output', operatorVersion: 1, bindings: {} },
    { id: 'condition', operator: 'values.boolean', operatorVersion: 1, bindings: {}, constants: { value: condition } },
    { id: 'seven', operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: 7 } },
    { id: 'one', operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: 1 } },
    { id: 'zero', operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: 0 } },
    { id: 'unused-ieee', operator: 'math.divide-ieee.scalar', operatorVersion: 1, bindings: {} },
    { id: 'lazy', operator: 'control.select.scalar', operatorVersion: 1, bindings: {} },
  ], edges: [
    { id: 'frame-output', from: 'frame', output: 'image', to: 'output', input: 'image' },
    { id: 'one-divide', from: 'one', output: 'value', to: 'unused-ieee', input: 'a' },
    { id: 'zero-divide', from: 'zero', output: 'value', to: 'unused-ieee', input: 'b' },
    { id: 'condition-lazy', from: 'condition', output: 'value', to: 'lazy', input: 'condition' },
    { id: 'false-lazy', from: 'unused-ieee', output: 'value', to: 'lazy', input: 'falseValue' },
    { id: 'true-lazy', from: 'seven', output: 'value', to: 'lazy', input: 'trueValue' },
  ],
});

describe('lazy scalar image selection', () => {
  it('emits lexical branch scopes and evaluates only the chosen scalar result', () => {
    const plan = compileImageOperatorPreview(makeGraph(), {}, { nodeId: 'lazy', direction: 'output', portId: 'value' });
    const select = plan.instructions.find(item => item.nodeId === 'lazy')!;
    expect(select).toMatchObject({ operation: 'select-lazy-scalar', type: 'scalar' });
    expect(plan.sampleScopes.filter(scope => select.inputs.slice(1).includes(scope.id)))
      .toEqual(expect.arrayContaining([expect.objectContaining({ type: 'scalar' }), expect.objectContaining({ type: 'scalar' })]));
    expect(evaluateImageOperatorPlan(plan, [0, 0, 0, 0])[0]).toBe(7);
    expect(plan.wgsl).toMatch(/var v\d+: f32;\n\s*if \(/);
  });

  it('retains strict Boolean condition and scalar branch port validation', () => {
    expect(validateEffectGraph(makeGraph())).toEqual([]);
    const invalid = makeGraph();
    invalid.edges.find(edge => edge.id === 'condition-lazy')!.from = 'seven';
    expect(validateEffectGraph(invalid)).toContain('Invalid connection: condition-lazy.');
  });

  it('rejects lazy scalar scopes as derivative inputs instead of treating scope IDs as registers', () => {
    const invalid = makeGraph();
    invalid.nodes.push({ id: 'derivative', operator: 'image.derivative.auto.scalar', operatorVersion: 1, bindings: {} });
    invalid.edges.push({ id: 'lazy-derivative', from: 'lazy', output: 'value', to: 'derivative', input: 'value' });
    expect(() => compileImageOperatorPreview(invalid, {}, { nodeId: 'derivative', direction: 'output', portId: 'value' }))
      .toThrow(/requires a root-local input expression/);
  });
});
