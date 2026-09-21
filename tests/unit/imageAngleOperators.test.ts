import { describe, expect, it } from 'vitest';
import { packImageOperatorParameters } from '../../src/services/operators/imageOperatorParameters';
import { compileImageOperatorPreview, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../src/types/operatorGraph';

const node = (id: string, operator: string, value?: number, binding?: string): BoundOperatorNode => ({
  id, operator, operatorVersion: 1, bindings: binding ? { value: binding } : {},
  ...(value === undefined ? {} : { constants: { value } }),
});
const edge = (from: string, to: string, input: string, output = 'value'): OperatorEdge =>
  ({ id: `${from}-${to}-${input}`, from, output, to, input });

function graph(): EffectOperatorGraph {
  const nodes = [node('frame', 'image.frame'), node('output', 'image.output'), node('bound-degrees', 'values.number', undefined, 'angle'),
    node('bound-radians', 'convert.degrees-to-radians.scalar'), node('raw-plus-radians', 'math.add.scalar'),
    node('literal-degrees', 'values.number', -135.25), node('literal-radians', 'convert.degrees-to-radians.scalar'),
    node('computed-a', 'values.number', 30), node('computed-b', 'values.number', 15), node('computed-degrees', 'math.add.scalar'),
    node('computed-radians', 'convert.degrees-to-radians.scalar'), node('negative-angle', 'values.number', -.7),
    node('tan', 'math.tan.scalar'), node('atan-input', 'values.number', -1.25), node('atan', 'math.atan.scalar'),
    node('abs-input', 'values.number', -3.5), node('abs', 'math.abs.scalar')];
  const edges = [edge('frame', 'output', 'image', 'image'), edge('bound-degrees', 'bound-radians', 'value'),
    edge('bound-degrees', 'raw-plus-radians', 'a'), edge('bound-radians', 'raw-plus-radians', 'b'),
    edge('literal-degrees', 'literal-radians', 'value'), edge('computed-a', 'computed-degrees', 'a'), edge('computed-b', 'computed-degrees', 'b'),
    edge('computed-degrees', 'computed-radians', 'value'), edge('negative-angle', 'tan', 'value'), edge('atan-input', 'atan', 'value'), edge('abs-input', 'abs', 'value')];
  return { version: 1, schemaVersion: 1, domain: 'image', nodes, edges, layout: {} };
}

const preview = (source: EffectOperatorGraph, nodeId: string, params: Record<string, unknown> = {}) =>
  compileImageOperatorPreview(source, params, { nodeId, direction: 'output', portId: 'value' });
const scalar = (plan: ReturnType<typeof preview>) => evaluateImageOperatorPlan(plan, [0, 0, 0, 0])[0];

describe('image angle and raw unary math operators', () => {
  it('keeps raw signed tan, atan and absolute-value semantics', () => {
    const source = graph();
    expect(scalar(preview(source, 'tan'))).toBeCloseTo(Math.tan(-.7), 12);
    expect(scalar(preview(source, 'atan'))).toBeCloseTo(Math.atan(-1.25), 12);
    expect(scalar(preview(source, 'abs'))).toBe(3.5);
    expect(preview(source, 'tan').wgsl).toContain('tan(');
    expect(preview(source, 'atan').wgsl).toContain('atan(');
    expect(preview(source, 'abs').wgsl).toContain('abs(');
  });

  it('keeps dynamic degree conversion structural while its packed values change', () => {
    const source = graph(), first = preview(source, 'raw-plus-radians', { angle: 90 }), second = preview(source, 'raw-plus-radians', { angle: -45 });
    expect(first.key).toBe(second.key);
    expect(first.wgsl).toBe(second.wgsl);
    expect(first.values).not.toEqual(second.values);
    expect(scalar(first)).toBeCloseTo(90 + Math.PI / 2, 12);
    expect(scalar(second)).toBeCloseTo(-45 - Math.PI / 4, 12);
    const packed = Array.from(packImageOperatorParameters(first.values));
    expect(packed).toContain(Math.fround(90));
    expect(packed).toContain(Math.fround(90 * Math.PI / 180));
    expect(scalar(preview(source, 'bound-radians', { angle: 180 }))).toBeCloseTo(Math.PI, 12);
  });

  it('does not collide when one binding is consumed as raw degrees and converted radians', () => {
    const plan = preview(graph(), 'raw-plus-radians', { angle: 27.5 });
    expect(plan.values).toContain(27.5);
    expect(plan.values).toContain(27.5 * Math.PI / 180);
    expect(plan.values.filter(value => value !== 0)).toHaveLength(2);
    expect(scalar(plan)).toBeCloseTo(27.5 + 27.5 * Math.PI / 180, 12);
  });

  it('converts literals on the CPU before WGSL emission and preserves legacy f32 packing', () => {
    const plan = preview(graph(), 'literal-radians'), expected = -135.25 * Math.PI / 180;
    expect(plan.values).toEqual([]);
    expect(scalar(plan)).toBe(expected);
    expect(Math.fround(scalar(plan))).toBe(Math.fround(expected));
    expect(plan.instructions.some(instruction => instruction.operation === 'degrees-to-radians')).toBe(false);
  });

  it('uses a runtime conversion instruction for arbitrary computed degree inputs', () => {
    const plan = preview(graph(), 'computed-radians');
    expect(plan.instructions.some(instruction => instruction.operation === 'degrees-to-radians')).toBe(true);
    expect(scalar(plan)).toBeCloseTo(Math.PI / 4, 12);
  });

  it('bypasses conversion and raw unary math without changing degree values', () => {
    const source = graph();
    source.nodes.find(candidate => candidate.id === 'bound-radians')!.bypassed = true;
    const conversion = preview(source, 'bound-radians', { angle: -90 });
    expect(scalar(conversion)).toBe(-90);
    expect(conversion.instructions.some(instruction => instruction.operation === 'degrees-to-radians')).toBe(false);
    source.nodes.find(candidate => candidate.id === 'tan')!.bypassed = true;
    const tangent = preview(source, 'tan');
    expect(scalar(tangent)).toBe(-.7);
    expect(tangent.instructions.some(instruction => instruction.operation === 'tan-scalar')).toBe(false);
  });
});
