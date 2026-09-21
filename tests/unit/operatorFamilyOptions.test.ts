import { describe, expect, it } from 'vitest';
import { getEffectOperator } from '../../src/services/operators/operatorRegistry';
import { operatorFamilyOptions } from '../../src/components/panels/nodes/workspace/operatorFamilyOptions';

describe('adaptive operator family UI', () => {
  it.each(['vector.split.vec2', 'vector.combine.vec4'])('shows one typed choice per vector width for %s', id => {
    expect(operatorFamilyOptions(getEffectOperator(id)!)).toEqual([
      { value: id.startsWith('vector.split') ? 'vector.split.vec2' : 'vector.combine.vec2', label: 'VEC2' },
      { value: id.startsWith('vector.split') ? 'vector.split.vec3' : 'vector.combine.vec3', label: 'VEC3' },
      { value: id.startsWith('vector.split') ? 'vector.split.vec4' : 'vector.combine.vec4', label: 'VEC4' },
    ]);
  });

  it('does not invent variants for an operator without a family', () => {
    expect(operatorFamilyOptions(getEffectOperator('image.frame')!)).toEqual([]);
  });

  it('does not offer owner-only choices on ordinary values while retaining an existing choice node', () => {
    expect(operatorFamilyOptions(getEffectOperator('values.boolean')!).map(option => option.value)).not.toContain('values.choice');
    expect(operatorFamilyOptions(getEffectOperator('values.color')!).map(option => option.value)).not.toContain('values.choice');
    expect(operatorFamilyOptions(getEffectOperator('values.choice')!).map(option => option.value)).toContain('values.choice');
  });
});
