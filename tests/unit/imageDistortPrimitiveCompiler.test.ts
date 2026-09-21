import { describe, expect, it } from 'vitest';
import type { BoundOperatorNode, EffectOperatorGraph } from '../../src/types/operatorGraph';
import { compileImageOperatorPreview, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
const n = (id: string, operator: string, value?: number | boolean): BoundOperatorNode => ({ id, operator, operatorVersion: 1, bindings: {}, ...(value === undefined ? {} : { constants: { value } }) });
const e = (from: string, output: string, to: string, input: string) => ({ id: `${from}-${to}-${input}`, from, output, to, input });
function graph(): EffectOperatorGraph {
  const nodes = [n('frame', 'image.frame'), n('output', 'image.output'), n('negative', 'values.number', -4), n('fraction', 'values.number', .5),
    n('two', 'values.number', 2), n('zero', 'values.number', 0), n('one', 'values.number', 1), n('minimum', 'math.min.scalar'),
    n('power', 'math.power.scalar'), n('atan2', 'math.atan2.scalar'), n('false-vector', 'vector.combine.vec2'), n('true-vector', 'vector.combine.vec2'),
    n('condition', 'values.boolean', true), n('select', 'select.vec2')];
  return { version: 1, schemaVersion: 1, domain: 'image', nodes, layout: {}, edges: [e('frame', 'image', 'output', 'image'),
    e('negative', 'value', 'minimum', 'a'), e('two', 'value', 'minimum', 'b'), e('negative', 'value', 'power', 'a'), e('fraction', 'value', 'power', 'b'),
    e('one', 'value', 'atan2', 'y'), e('zero', 'value', 'atan2', 'x'), e('zero', 'value', 'false-vector', 'x'), e('one', 'value', 'false-vector', 'y'),
    e('one', 'value', 'true-vector', 'x'), e('two', 'value', 'true-vector', 'y'), e('false-vector', 'value', 'select', 'falseValue'),
    e('true-vector', 'value', 'select', 'trueValue'), e('condition', 'value', 'select', 'condition')] };
}
const preview = (nodeId: string) => evaluateImageOperatorPlan(compileImageOperatorPreview(graph(), {}, { nodeId, direction: 'output', portId: 'value' }), [0, 0, 0, 0]);
describe('distortion image primitives', () => {
  it('keeps raw scalar minimum and power semantics distinct from guarded field math', () => {
    expect(preview('minimum')[0]).toBe(-4);
    expect(Number.isNaN(preview('power')[0])).toBe(true);
    expect(compileImageOperatorPreview(graph(), {}, { nodeId: 'power', direction: 'output', portId: 'value' }).wgsl).toContain('pow(');
  });
  it('uses explicit atan2 Y/X orientation in radians', () => {
    expect(preview('atan2')[0]).toBeCloseTo(Math.PI / 2, 12);
    expect(compileImageOperatorPreview(graph(), {}, { nodeId: 'atan2', direction: 'output', portId: 'value' }).wgsl).toContain('atan2(');
  });
  it('selects complete vec2 values from a Boolean condition', () => {
    expect(preview('select')).toEqual([1, 2, 0, 1]);
  });
});
