import { describe, expect, it } from 'vitest';
import { compileImageOperatorPreview, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { normalizeImageVector2 } from '../../src/services/operators/imageVectorSemantics';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

const graph = (x: number, y: number, bypassed = false): EffectOperatorGraph => ({
  version: 1, schemaVersion: 1, domain: 'image', layout: {},
  nodes: [{ id: 'frame', operator: 'image.frame', operatorVersion: 1, bindings: {} },
    { id: 'output', operator: 'image.output', operatorVersion: 1, bindings: {} },
    { id: 'x', operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: x } },
    { id: 'y', operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: y } },
    { id: 'vector', operator: 'vector.combine.vec2', operatorVersion: 1, bindings: {} },
    { id: 'normalize', operator: 'vector.normalize.vec2', operatorVersion: 1, bindings: {}, bypassed }],
  edges: [{ id: 'frame-output', from: 'frame', output: 'image', to: 'output', input: 'image' },
    { id: 'x-vector', from: 'x', output: 'value', to: 'vector', input: 'x' },
    { id: 'y-vector', from: 'y', output: 'value', to: 'vector', input: 'y' },
    { id: 'vector-normalize', from: 'vector', output: 'value', to: 'normalize', input: 'value' }],
});

describe('image vec2 normalization primitive', () => {
  it('uses component over Euclidean length for nonzero vectors', () => {
    const plan = compileImageOperatorPreview(graph(3, 4), {}, { nodeId: 'normalize', direction: 'output', portId: 'value' });
    expect(evaluateImageOperatorPlan(plan, [0, 0, 0, 0]).slice(0, 2)).toEqual([.6, .8]);
    expect(normalizeImageVector2([3, 4])).toEqual([.6, .8]);
    expect(plan.wgsl).toContain('normalize(');
  });

  it('defines CPU zero as zero and preserves passthrough bypass', () => {
    const zero = compileImageOperatorPreview(graph(0, 0), {}, { nodeId: 'normalize', direction: 'output', portId: 'value' });
    expect(evaluateImageOperatorPlan(zero, [0, 0, 0, 0]).slice(0, 2)).toEqual([0, 0]);
    const bypass = compileImageOperatorPreview(graph(3, 4, true), {}, { nodeId: 'normalize', direction: 'output', portId: 'value' });
    expect(evaluateImageOperatorPlan(bypass, [0, 0, 0, 0]).slice(0, 2)).toEqual([3, 4]);
    expect(bypass.instructions.some(instruction => instruction.operation === 'normalize-vec2')).toBe(false);
  });
});
