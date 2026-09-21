import { describe, expect, it } from 'vitest';
import { imageScopeReadsPrimaryInput } from '../../src/services/operators/imageOperatorScopes';
import type { ImagePlanInstruction } from '../../src/services/operators/imageOperatorGraph';

const instruction = (scope: number, operation: string, inputs: number[] = []): ImagePlanInstruction =>
  ({ nodeId: `${scope}:${operation}`, scope, operation, type: 'image', inputs });

describe('image lexical scope source analysis', () => {
  it('finds a primary input through nested lazy image and scalar child scopes', () => {
    const instructions = [instruction(0, 'constant'), instruction(1, 'select-image', [0, 2, 3]), instruction(2, 'resource-load-input'),
      instruction(3, 'select-lazy-scalar', [0, 4, 5]), instruction(4, 'constant'), instruction(5, 'input')];
    expect(imageScopeReadsPrimaryInput(instructions, 1)).toBe(true);
  });

  it('keeps resource-only scopes independent from the primary image loader', () => {
    const instructions = [instruction(1, 'select-image', [0, 2, 3]), instruction(2, 'resource-load-input'),
      instruction(3, 'resource-load-input')];
    expect(imageScopeReadsPrimaryInput(instructions, 1)).toBe(false);
  });

  it('terminates safely when malformed scope references form a cycle', () => {
    const instructions = [instruction(1, 'select-image', [0, 2, 2]), instruction(2, 'select-image', [0, 1, 1])];
    expect(imageScopeReadsPrimaryInput(instructions, 1)).toBe(false);
  });
});
