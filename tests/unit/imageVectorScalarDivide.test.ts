import { describe, expect, it } from 'vitest';
import { validateEffectGraph } from '../../src/services/operators/effectGraph';
import { compileImageOperatorPreview, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

const graph = (divisor: number, bypassed = false): EffectOperatorGraph => ({
  version: 1, schemaVersion: 1, domain: 'image', layout: {},
  nodes: [
    { id: 'frame', operator: 'image.frame', operatorVersion: 1, bindings: {} },
    { id: 'output', operator: 'image.output', operatorVersion: 1, bindings: {} },
    { id: 'x', operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: 6 } },
    { id: 'y', operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: -9 } },
    { id: 'vector', operator: 'vector.combine.vec2', operatorVersion: 1, bindings: {} },
    { id: 'divisor', operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: divisor } },
    { id: 'divide', operator: 'math.divide-ieee.vec2-scalar', operatorVersion: 1, bindings: {}, ...(bypassed ? { bypassed: true } : {}) },
  ],
  edges: [
    { id: 'frame-output', from: 'frame', output: 'image', to: 'output', input: 'image' },
    { id: 'x-vector', from: 'x', output: 'value', to: 'vector', input: 'x' },
    { id: 'y-vector', from: 'y', output: 'value', to: 'vector', input: 'y' },
    { id: 'vector-divide', from: 'vector', output: 'value', to: 'divide', input: 'a' },
    { id: 'scalar-divide', from: 'divisor', output: 'value', to: 'divide', input: 'b' },
  ],
});

const compile = (value: number, bypassed = false) => compileImageOperatorPreview(
  graph(value, bypassed), {}, { nodeId: 'divide', direction: 'output', portId: 'value' },
);

describe('image vec2/scalar IEEE divide', () => {
  it('evaluates finite and negative scalar divisors and emits one vector/scalar instruction', () => {
    const plan = compile(-3);
    expect(evaluateImageOperatorPlan(plan, [0, 0, 0, 0])).toEqual([-2, 3, 0, 1]);
    expect(plan.instructions).toContainEqual(expect.objectContaining({
      nodeId: 'divide', operation: 'divide-vector-scalar', type: 'vec2',
    }));
    expect(plan.wgsl).toContain(' / ');
  });

  it('preserves raw IEEE zero and near-zero behavior without guards', () => {
    const zero = evaluateImageOperatorPlan(compile(0), [0, 0, 0, 0]);
    expect(zero.slice(0, 2)).toEqual([Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]);
    const tiny = evaluateImageOperatorPlan(compile(1e-300), [0, 0, 0, 0]);
    expect(tiny.slice(0, 2)).toEqual([6e300, -9e300]);
  });

  it('passes the vector through when bypassed', () => {
    expect(evaluateImageOperatorPlan(compile(-3, true), [0, 0, 0, 0])).toEqual([6, -9, 0, 1]);
  });

  it('persists a strict scalar denominator port contract', () => {
    expect(validateEffectGraph(graph(2))).toEqual([]);
    const invalid = graph(2);
    invalid.edges.find(edge => edge.id === 'scalar-divide')!.from = 'vector';
    invalid.edges.find(edge => edge.id === 'scalar-divide')!.output = 'value';
    expect(validateEffectGraph(invalid)).toContain('Invalid connection: scalar-divide.');
  });
});
