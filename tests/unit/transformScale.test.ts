import { describe, expect, it } from 'vitest';
import { getEffectiveCameraScale, getEffectiveScale, getScaleAll } from '../../src/utils/transformScale';

describe('transformScale helpers', () => {
  it('defaults scale.all to 1', () => {
    expect(getScaleAll(undefined)).toBe(1);
    expect(getScaleAll({ x: 2, y: 3 })).toBe(1);
  });

  it('applies scale.all on top of independent axis scale', () => {
    expect(getEffectiveScale({ all: 2, x: 1.5, y: 0.5, z: 3 })).toEqual({
      x: 3,
      y: 1,
      z: 6,
    });
  });

  it('does not multiply camera forward offset by zoom scale', () => {
    expect(getEffectiveCameraScale({ all: 2, x: 1.5, y: 0.5, z: 3 })).toEqual({
      x: 3,
      y: 1,
      z: 3,
    });
  });
});
