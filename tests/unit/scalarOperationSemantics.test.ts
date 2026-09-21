import { describe, expect, it } from 'vitest';
import { evaluateScalarOperation } from '../../src/services/operators/scalarOperationSemantics';
import { evaluateScalarField } from '../../src/services/operators/evaluateScalarField';
import { evaluateFlockValues } from '../../src/services/flock/compiler/flockParamEvaluation';

const flockMath = (op: string, a: number, b: number) => evaluateFlockValues({ values: [{
  nodeId: 'math', sourceNodeId: 'math', operator: 'flock.math', kind: 'math',
  params: { numbers: { a: { base: a }, b: { base: b } }, vectors: {}, colors: {}, enums: { op }, integers: {}, booleans: {}, assets: {} },
}] } as never, 0, { keyframesByProperty: new Map() }).values[0];

describe('shared scalar operation semantics', () => {
  it.each([
    ['add', 2, 3, 5, 2],
    ['subtract', 7, 2, 5, 3],
    ['multiply', -3, 4, -12, 4],
  ] as const)('keeps %s identical in pure, voxel and Flock evaluators', (operation, a, b, expected, opcode) => {
    expect(evaluateScalarOperation(operation, a, b)).toBe(expected);
    expect(evaluateScalarField({ operations: [[0, 0, 0, a], [0, 0, 0, b], [opcode, 0, 1, 0]], output: 2 }, 0)[2]).toBe(expected);
    expect(flockMath(operation, a, b)).toBe(expected);
  });

  it('normalizes reversed clamp bounds and deliberately propagates NaN', () => {
    expect(evaluateScalarOperation('clamp', 4, 10, 2)).toBe(4);
    expect(evaluateScalarOperation('clamp', -1, 10, 2)).toBe(2);
    expect(evaluateScalarOperation('clamp', 12, 10, 2)).toBe(10);
    expect(Number.isNaN(evaluateScalarOperation('add', Number.NaN, 1))).toBe(true);
  });

  it('shares absolute-value semantics while preserving scalar-field output limits', () => {
    expect(evaluateScalarOperation('abs', -7)).toBe(7);
    expect(evaluateScalarField({ operations: [[0, 0, 0, -7], [9, 0, 0, 0]], output: 1 }, 0)[1]).toBe(7);
    expect(flockMath('abs', -7, 123)).toBe(7);
    expect(evaluateScalarField({ operations: [[0, 0, 0, -20_000], [9, 0, 0, 0]], output: 1 }, 0)[1]).toBe(10_000);
  });
});
