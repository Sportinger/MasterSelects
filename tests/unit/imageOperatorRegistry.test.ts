import { describe, expect, it } from 'vitest';
import { EFFECT_OPERATORS, getEffectOperator } from '../../src/services/operators/operatorRegistry';

describe('image operator registry', () => {
  it('reuses canonical source and scalar value operators', () => {
    expect(EFFECT_OPERATORS.filter(operator => operator.id === 'image.frame')).toHaveLength(1);
    expect(EFFECT_OPERATORS.filter(operator => operator.id === 'values.number')).toHaveLength(1);
  });

  it('publishes canonical stateless inline metadata for local image operators', () => {
    for (const id of ['vector.split.vec2', 'vector.split.vec3', 'vector.split.vec4', 'vector.combine.vec2', 'vector.combine.vec3', 'vector.combine.vec4',
      'convert.image-to-vec4', 'convert.vec4-to-image', 'math.subtract.scalar', 'math.subtract.rgb', 'convert.scalar-to-rgb', 'image.output']) {
      expect(getEffectOperator(id)).toMatchObject({ state: 'stateless', fusion: 'inline', version: 1 });
    }
    expect(getEffectOperator('vector.split.vec4')).toMatchObject({ family: 'vector.split', variant: 'vec4' });
    expect(getEffectOperator('vector.split.vec4')?.outputs.map(port => port.id)).toEqual(['x', 'y', 'z', 'w']);
  });
});
