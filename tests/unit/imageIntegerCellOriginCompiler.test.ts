import { describe, expect, it } from 'vitest';
import { compileImageOperatorPreview, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { imageIntegerCellOrigin } from '../../src/services/operators/imageCoordinateSemantics';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

const graph = (pixel: [number, number], size: number): EffectOperatorGraph => ({ version: 1, schemaVersion: 1, domain: 'image', layout: {}, nodes: [
  { id: 'frame', operator: 'image.frame', operatorVersion: 1, bindings: {} },
  { id: 'output', operator: 'image.output', operatorVersion: 1, bindings: {} },
  { id: 'x', operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: pixel[0] } },
  { id: 'y', operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: pixel[1] } },
  { id: 'pixel', operator: 'vector.combine.vec2', operatorVersion: 1, bindings: {} },
  { id: 'size', operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: size } },
  { id: 'origin', operator: 'coordinates.integer-cell-origin.vec2', operatorVersion: 1, bindings: {} },
], edges: [
  { id: 'frame-output', from: 'frame', output: 'image', to: 'output', input: 'image' },
  { id: 'x-pixel', from: 'x', output: 'value', to: 'pixel', input: 'x' }, { id: 'y-pixel', from: 'y', output: 'value', to: 'pixel', input: 'y' },
  { id: 'pixel-origin', from: 'pixel', output: 'value', to: 'origin', input: 'pixel' }, { id: 'size-origin', from: 'size', output: 'value', to: 'origin', input: 'size' },
] });

describe('coordinates.integer-cell-origin.vec2', () => {
  it.each([[11, 0], [12, 12], [23, 12], [24, 24]] as const)('preserves exact cell boundaries for pixel %s', (pixel, expected) => {
    expect(imageIntegerCellOrigin([pixel, 2], 12)).toEqual([expected, 0]);
    const plan = compileImageOperatorPreview(graph([pixel, 2], 12), {}, { nodeId: 'origin', direction: 'output', portId: 'value' });
    expect(evaluateImageOperatorPlan(plan, [0, 0, 0, 1])).toEqual([expected, 0, 0, 1]);
    expect(plan.wgsl).toContain('vec2i('); expect(plan.wgsl).toContain('/ i32(');
  });

  it('truncates pixel inputs and rejects invalid integer-domain context', () => {
    expect(imageIntegerCellOrigin([24.9, 11.9], 12)).toEqual([24, 0]);
    expect(() => imageIntegerCellOrigin([0, 0], 12.8)).toThrow(/positive i32/);
    expect(() => imageIntegerCellOrigin([-1, 0], 12)).toThrow(/positive i32/);
    expect(() => imageIntegerCellOrigin([0, 0], 0)).toThrow(/positive i32/);
  });

  it('normalizes through f32 before enforcing the signed integer boundary', () => {
    const largestI32F32 = 2_147_483_520;
    expect(imageIntegerCellOrigin([largestI32F32, 0], largestI32F32)).toEqual([largestI32F32, 0]);
    expect(() => imageIntegerCellOrigin([2_147_483_647, 0], 1)).toThrow(/positive i32/);
    expect(() => imageIntegerCellOrigin([0, 0], 2_147_483_647)).toThrow(/positive i32/);
  });
});
