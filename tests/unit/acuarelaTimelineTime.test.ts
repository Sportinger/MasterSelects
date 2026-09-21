import { describe, expect, it } from 'vitest';
import { acuarela } from '../../src/effects/stylize/acuarela';

describe('Acuarela timeline uniforms', () => {
  it('packs explicit composition time without changing parameter order or defaults', () => {
    expect(acuarela.packUniforms({}, 1920, 1080, 2.375)).toEqual(new Float32Array([
      1, .01, 4, 4, .32, 4, .3, .3, 1920, 1080, 2.375, 0,
    ]));
  });

  it('uses deterministic zero when composition time is omitted or non-finite', () => {
    expect(acuarela.packUniforms({}, 8, 6)?.[10]).toBe(0);
    expect(acuarela.packUniforms({}, 8, 6, Number.NaN)?.[10]).toBe(0);
  });
});
