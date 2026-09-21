import { describe, expect, it } from 'vitest';

import { kineticTrace } from '../../src/effects/tracking';

describe('tracking effect timeline clock', () => {
  it('packs explicit composition time and defaults missing or invalid time to zero', () => {
    const params = { amount: 0.8, speed: 1, color: '#36f59a' };
    expect(kineticTrace.packUniforms(params, 64, 36, 2.75)?.[3]).toBe(2.75);
    expect(kineticTrace.packUniforms(params, 64, 36)?.[3]).toBe(0);
    expect(kineticTrace.packUniforms(params, 64, 36, Number.NaN)?.[3]).toBe(0);
  });
});
