import { describe, expect, it } from 'vitest';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { roundImageScalarEven } from '../../src/services/operators/imageRoundingSemantics';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

const graph = (): EffectOperatorGraph => ({ version: 1, schemaVersion: 1, domain: 'image', layout: {}, nodes: [
  { id: 'value', operator: 'values.number', operatorVersion: 1, bindings: { value: 'amount' } },
  { id: 'round', operator: 'math.round-even.scalar', operatorVersion: 1, bindings: {} },
  { id: 'gray', operator: 'convert.scalar-to-rgb', operatorVersion: 1, bindings: {} },
  { id: 'frame', operator: 'image.frame', operatorVersion: 1, bindings: {} },
  { id: 'frame-color', operator: 'vector.split.rgba', operatorVersion: 1, bindings: {} },
  { id: 'combine', operator: 'vector.combine.rgba', operatorVersion: 1, bindings: {} },
  { id: 'output', operator: 'image.output', operatorVersion: 1, bindings: {} },
], edges: [
  { id: 'value-round', from: 'value', output: 'value', to: 'round', input: 'value' },
  { id: 'round-gray', from: 'round', output: 'value', to: 'gray', input: 'value' },
  { id: 'gray-combine', from: 'gray', output: 'rgb', to: 'combine', input: 'rgb' },
  { id: 'frame-color', from: 'frame', output: 'image', to: 'frame-color', input: 'image' },
  { id: 'alpha-combine', from: 'frame-color', output: 'alpha', to: 'combine', input: 'alpha' },
  { id: 'combine-output', from: 'combine', output: 'image', to: 'output', input: 'image' },
] });

describe('math.round-even.scalar', () => {
  it('matches WGSL nearest-even for positive and negative halfway cases', () => {
    expect([.5, 1.5, 2.5, -.5, -1.5, -2.5].map(roundImageScalarEven)).toEqual([0, 2, 2, 0, -2, -2]);
    expect(() => roundImageScalarEven(Number.POSITIVE_INFINITY)).toThrow(/finite f32/);
  });

  it('uses dynamic parameter slots without changing the structural shader key', () => {
    const a = compileImageOperatorGraph(graph(), { amount: 2.5 }), b = compileImageOperatorGraph(graph(), { amount: 3.5 });
    expect(a.key).toBe(b.key); expect(a.wgsl).toContain('round(');
    expect(evaluateImageOperatorPlan(a, [0, 0, 0, 1])).toEqual([2, 2, 2, 1]);
    expect(evaluateImageOperatorPlan(b, [0, 0, 0, 1])).toEqual([4, 4, 4, 1]);
  });

  it('honors the shared scalar bypass contract', () => {
    const bypassed = graph(); bypassed.nodes.find(node => node.id === 'round')!.bypassed = true;
    const plan = compileImageOperatorGraph(bypassed, { amount: 2.5 });
    expect(plan.instructions.some(item => item.operation === 'round-even-scalar')).toBe(false);
    expect(evaluateImageOperatorPlan(plan, [0, 0, 0, 1])).toEqual([2.5, 2.5, 2.5, 1]);
  });

  it('reuses the same lowering inside a lexical image sampling scope', () => {
    const scoped = graph(), outputEdge = scoped.edges.find(edge => edge.to === 'output')!;
    scoped.nodes.push({ id: 'uv', operator: 'image.normalized-uv', operatorVersion: 1, bindings: {} },
      { id: 'sample', operator: 'image.sample', operatorVersion: 1, bindings: {} });
    scoped.edges.push({ id: 'combine-sample', from: 'combine', output: 'image', to: 'sample', input: 'image' },
      { id: 'uv-sample', from: 'uv', output: 'uv', to: 'sample', input: 'uv' });
    outputEdge.from = 'sample'; outputEdge.id = 'sample-output';
    const plan = compileImageOperatorGraph(scoped, { amount: 2.5 });
    const rounded = plan.instructions.find(item => item.operation === 'round-even-scalar')!;
    expect(rounded.scope).not.toBe(0);
    expect(evaluateImageOperatorPlan(plan, [0, 0, 0, 1], { uv: [.5, .5], sampleImage: () => [0, 0, 0, 1] })).toEqual([2, 2, 2, 1]);
  });
});
